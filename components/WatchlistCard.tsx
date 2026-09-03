'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useInterval } from '@/hooks/useInterval';

// Sesuai WATCHED_ASSETS di config.py
const WATCHLIST = ['BTC', 'ETH', 'SOL', 'DOGE', 'BONK', 'PENGU'];
const REFRESH_MS = 20_000;

// Support/resistance & konfirmasi sinyal tidak perlu recompute tiap 20 detik —
// histori 100 titik terakhir cukup di-refresh tiap beberapa menit.
const HISTORY_REFRESH_MS = 5 * 60_000;
const HISTORY_LIMIT = 100;
const MIN_HISTORY_FOR_LEVELS = 10;
const TOUCH_TOLERANCE_PCT = 0.015; // ±1.5%
const MIN_TOUCHES_FOR_LEVEL = 2;
const VOLUME_TREND_WINDOW = 5; // rata-rata N snapshot sebelumnya utk bandingin volume terbaru

interface MarketSnapshotRow {
  asset: string;
  current_price: string | number;
  rsi: number | null;
  rsi_signal: 'oversold' | 'overbought' | 'netral' | null;
}

interface HistoryRow {
  asset: string;
  current_price: number;
  rsi: number | null;
  rsi_signal: string | null;
  macd: number | null;
  macd_signal: number | null;
  volume: number | null;
  snapshot_at: string;
}

interface PriceLevel {
  price: number;
  touches: number;
  lastTouchedAt: string;
}

interface SignalConfirmation {
  status: 'terkonfirmasi' | 'belum terkonfirmasi' | 'tidak berlaku';
  reason: string;
}

const RSI_LABEL: Record<string, string> = {
  oversold: 'oversold',
  overbought: 'overbought',
  netral: 'netral',
};

// Sinyal ekstrem (oversold/overbought) ditaruh di atas, netral di bawah —
// biar yang paling layak diperhatikan nggak kelewat di antara yang netral.
const SIGNAL_PRIORITY: Record<string, number> = {
  oversold: 0,
  overbought: 0,
  netral: 1,
};

function signalClass(signal: string | null | undefined) {
  if (signal === 'oversold') return 'ok';
  if (signal === 'overbought') return 'bad';
  return 'unknown';
}

function confirmationClass(status: SignalConfirmation['status']) {
  if (status === 'terkonfirmasi') return 'ok';
  return 'unknown';
}

function daysAgoLabel(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diffMs / 86_400_000);
  if (days <= 0) return 'hari ini';
  if (days === 1) return '1 hari lalu';
  return `${days} hari lalu`;
}

// Klasterisasi harga sederhana: gabungkan harga historis yang jaraknya
// dalam toleransi ±1.5% ke satu level, hitung berapa kali level itu
// "disentuh" dan kapan terakhir disentuh.
function clusterPriceLevels(points: { price: number; at: string }[]): PriceLevel[] {
  const sorted = [...points].sort((a, b) => a.price - b.price);
  const clusters: { sum: number; touches: { price: number; at: string }[] }[] = [];

  for (const p of sorted) {
    const target = clusters.find((c) => {
      const avg = c.sum / c.touches.length;
      return Math.abs(p.price - avg) / avg <= TOUCH_TOLERANCE_PCT;
    });
    if (target) {
      target.sum += p.price;
      target.touches.push(p);
    } else {
      clusters.push({ sum: p.price, touches: [p] });
    }
  }

  return clusters.map((c) => ({
    price: c.sum / c.touches.length,
    touches: c.touches.length,
    lastTouchedAt: c.touches.reduce((latest, t) => (t.at > latest ? t.at : latest), c.touches[0].at),
  }));
}

function findSupportResistance(
  history: HistoryRow[],
  currentPrice: number
): { support: PriceLevel | null; resistance: PriceLevel | null; enoughData: boolean } {
  if (history.length < MIN_HISTORY_FOR_LEVELS) {
    return { support: null, resistance: null, enoughData: false };
  }

  const points = history.map((h) => ({ price: h.current_price, at: h.snapshot_at }));
  const levels = clusterPriceLevels(points).filter((l) => l.touches >= MIN_TOUCHES_FOR_LEVEL);

  const belowCurrent = levels
    .filter((l) => l.price < currentPrice)
    .sort((a, b) => b.price - a.price); // paling dekat di bawah harga sekarang
  const aboveCurrent = levels
    .filter((l) => l.price > currentPrice)
    .sort((a, b) => a.price - b.price); // paling dekat di atas harga sekarang

  return {
    support: belowCurrent[0] ?? null,
    resistance: aboveCurrent[0] ?? null,
    enoughData: true,
  };
}

// Konfirmasi sinyal RSI oversold/overbought lewat arah MACD + tren volume.
// PENTING: macd/macd_signal/volume saat ini SELALU null di market_snapshot_history
// (lihat migration 0001) karena market_snapshot sumbernya tidak punya kolom itu.
// Fungsi ini sengaja tidak mengarang nilai — kalau datanya null, statusnya
// eksplisit "belum terkonfirmasi" dengan alasan data belum tersedia.
function confirmSignal(
  rsiSignal: string | null | undefined,
  history: HistoryRow[]
): SignalConfirmation {
  if (rsiSignal !== 'oversold' && rsiSignal !== 'overbought') {
    return { status: 'tidak berlaku', reason: 'RSI netral — tidak ada sinyal ekstrem untuk dikonfirmasi.' };
  }

  const latest = history[0];
  const hasMacd = latest?.macd != null && latest?.macd_signal != null;
  const recentVolumes = history.slice(0, VOLUME_TREND_WINDOW + 1).map((h) => h.volume);
  const hasVolume = recentVolumes.length > 1 && recentVolumes.every((v) => v != null);

  if (!hasMacd && !hasVolume) {
    return {
      status: 'belum terkonfirmasi',
      reason: `RSI ${rsiSignal}, tapi data MACD & volume belum tersedia dari sumber data — belum bisa dikonfirmasi.`,
    };
  }
  if (!hasMacd) {
    return {
      status: 'belum terkonfirmasi',
      reason: `RSI ${rsiSignal}, tapi data MACD belum tersedia dari sumber data — belum bisa dikonfirmasi.`,
    };
  }
  if (!hasVolume) {
    return {
      status: 'belum terkonfirmasi',
      reason: `RSI ${rsiSignal}, tapi data volume belum tersedia dari sumber data — belum bisa dikonfirmasi.`,
    };
  }

  const macdRising = latest.macd! > (history[1]?.macd ?? latest.macd!);
  const macdAboveSignal = latest.macd! > latest.macd_signal!;
  const latestVolume = recentVolumes[0] as number;
  const avgPriorVolume =
    (recentVolumes.slice(1) as number[]).reduce((s, v) => s + v, 0) / (recentVolumes.length - 1);
  const volumeRising = latestVolume > avgPriorVolume;

  if (rsiSignal === 'oversold') {
    if (macdRising && macdAboveSignal && volumeRising) {
      return {
        status: 'terkonfirmasi',
        reason: 'RSI oversold, MACD sudah cross ke atas dan volume naik — konsisten dengan reversal.',
      };
    }
    if (!macdRising) {
      return {
        status: 'belum terkonfirmasi',
        reason: 'RSI oversold, tapi MACD masih menurun — belum terkonfirmasi.',
      };
    }
    return {
      status: 'belum terkonfirmasi',
      reason: 'RSI oversold, MACD mulai naik tapi volume belum ikut naik — belum terkonfirmasi.',
    };
  }

  // overbought
  if (!macdRising && !macdAboveSignal && !volumeRising) {
    return {
      status: 'terkonfirmasi',
      reason: 'RSI overbought, MACD sudah cross ke bawah dan volume mengecil — konsisten dengan reversal.',
    };
  }
  if (macdRising || macdAboveSignal) {
    return {
      status: 'belum terkonfirmasi',
      reason: 'RSI overbought, tapi MACD masih menguat/di atas garis sinyal — belum terkonfirmasi.',
    };
  }
  return {
    status: 'belum terkonfirmasi',
    reason: 'RSI overbought, MACD mulai melemah tapi volume belum ikut turun — belum terkonfirmasi.',
  };
}

export default function WatchlistCard() {
  const [byAsset, setByAsset] = useState<Record<string, MarketSnapshotRow>>({});
  const [historyByAsset, setHistoryByAsset] = useState<Record<string, HistoryRow[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!supabase) return;
    const { data, error: err } = await supabase
      .from('market_snapshot')
      .select('*')
      .in('asset', WATCHLIST);
    if (err) {
      setError(err.message);
      return;
    }
    setError(null);
    const map: Record<string, MarketSnapshotRow> = {};
    (data || []).forEach((row) => {
      map[(row as MarketSnapshotRow).asset] = row as MarketSnapshotRow;
    });
    setByAsset(map);
  }, []);

  const refreshHistory = useCallback(async () => {
    if (!supabase) return;
    // market_snapshot_history mungkin belum ada (migration 0001 belum di-apply) —
    // gagal di sini tidak boleh mematikan harga terkini yang sudah tampil.
    const { data, error: err } = await supabase
      .from('market_snapshot_history')
      .select('asset, current_price, rsi, rsi_signal, macd, macd_signal, volume, snapshot_at')
      .in('asset', WATCHLIST)
      .order('snapshot_at', { ascending: false })
      .limit(HISTORY_LIMIT * WATCHLIST.length);
    if (err) {
      setHistoryError(err.message);
      return;
    }
    setHistoryError(null);
    const grouped: Record<string, HistoryRow[]> = {};
    (data || []).forEach((row) => {
      const r = row as HistoryRow;
      if (!grouped[r.asset]) grouped[r.asset] = [];
      if (grouped[r.asset].length < HISTORY_LIMIT) grouped[r.asset].push(r);
    });
    setHistoryByAsset(grouped);
  }, []);

  useEffect(() => {
    refresh();
    refreshHistory();
  }, [refresh, refreshHistory]);

  useInterval(refresh, REFRESH_MS);
  useInterval(refreshHistory, HISTORY_REFRESH_MS);

  if (!supabase) {
    return (
      <div className="card">
        <h3>Watchlist (dari config.py)</h3>
        <div className="placeholder-note">
          Isi NEXT_PUBLIC_SUPABASE_URL & NEXT_PUBLIC_SUPABASE_ANON_KEY di
          .env.local dulu.
        </div>
      </div>
    );
  }

  const sorted = [...WATCHLIST].sort((a, b) => {
    const sigA = byAsset[a]?.rsi_signal ?? 'netral';
    const sigB = byAsset[b]?.rsi_signal ?? 'netral';
    return (SIGNAL_PRIORITY[sigA] ?? 1) - (SIGNAL_PRIORITY[sigB] ?? 1);
  });

  // Detail lengkap (support/resistance + konfirmasi sinyal) cuma dihitung
  // untuk aset yang lagi dibuka — bukan untuk semua kartu di grid.
  const detailAsset = selected;
  const detailRow = detailAsset ? byAsset[detailAsset] : undefined;
  const detailHistory = detailAsset ? historyByAsset[detailAsset] ?? [] : [];
  const detailPrice = detailRow ? Number(detailRow.current_price) : null;
  const { support, resistance, enoughData } =
    detailPrice != null
      ? findSupportResistance(detailHistory, detailPrice)
      : { support: null, resistance: null, enoughData: false };
  const confirmation = confirmSignal(detailRow?.rsi_signal, detailHistory);
  const showConfirmation = confirmation.status !== 'tidak berlaku';

  return (
    <div className="card">
      <h3>Watchlist (dari config.py)</h3>
      {error && <div className="error-inline">{error}</div>}
      {historyError && (
        <div className="placeholder-note">
          Histori snapshot belum bisa dimuat ({historyError}). Support/resistance
          & konfirmasi sinyal butuh tabel market_snapshot_history — cek apakah
          migration &amp; Edge Function market-snapshot-history sudah dijalankan.
        </div>
      )}

      <div className="watchlist-grid">
        {sorted.map((a) => {
          const row = byAsset[a];
          const cls = signalClass(row?.rsi_signal);
          const isExtreme = row?.rsi_signal === 'oversold' || row?.rsi_signal === 'overbought';
          const isActive = selected === a;
          return (
            <button
              key={a}
              type="button"
              className={`watch-card watch-card--${cls}${isActive ? ' is-active' : ''}`}
              onClick={() => setSelected(isActive ? null : a)}
              aria-expanded={isActive}
            >
              <div className="watch-card-top">
                <span className="watch-card-asset">{a}</span>
                {isExtreme && (
                  <span className={`watch-card-badge ${cls}`}>
                    {RSI_LABEL[row!.rsi_signal ?? ''] ?? row!.rsi_signal}
                  </span>
                )}
              </div>
              <div className="watch-card-price">
                {row ? `$${row.current_price}` : '—'}
              </div>
              <div className="watch-card-rsi">
                {row?.rsi != null ? `RSI ${row.rsi}` : 'menunggu data'}
              </div>
            </button>
          );
        })}
      </div>

      {detailAsset && (
        <div className="watch-detail">
          <div className="watch-detail-head">
            <span className="watch-detail-asset">{detailAsset}</span>
            <button
              type="button"
              className="watch-detail-close"
              onClick={() => setSelected(null)}
            >
              Tutup ✕
            </button>
          </div>

          <div className="watch-detail-row">
            <span className="label">Harga</span>
            <span className="value">
              {detailRow ? `$${detailRow.current_price}` : 'menunggu data'}
            </span>
          </div>
          <div className="watch-detail-row">
            <span className="label">RSI</span>
            <span className={`value ${signalClass(detailRow?.rsi_signal)}`}>
              {detailRow?.rsi != null
                ? `${detailRow.rsi} (${RSI_LABEL[detailRow.rsi_signal ?? ''] ?? detailRow.rsi_signal})`
                : 'menunggu data'}
            </span>
          </div>
          {showConfirmation && (
            <div className="watch-detail-row">
              <span className="label">Konfirmasi MACD/volume</span>
              <span className={`value ${confirmationClass(confirmation.status)}`}>
                {confirmation.status}
              </span>
            </div>
          )}
          <div className="watch-detail-row">
            <span className="label">Support terdekat</span>
            <span className="value">
              {!enoughData
                ? 'data belum cukup'
                : support
                ? `$${support.price.toFixed(6)} (${support.touches}x, ${daysAgoLabel(support.lastTouchedAt)})`
                : 'belum ada level'}
            </span>
          </div>
          <div className="watch-detail-row">
            <span className="label">Resistance terdekat</span>
            <span className="value">
              {!enoughData
                ? 'data belum cukup'
                : resistance
                ? `$${resistance.price.toFixed(6)} (${resistance.touches}x, ${daysAgoLabel(resistance.lastTouchedAt)})`
                : 'belum ada level'}
            </span>
          </div>
          {showConfirmation && <div className="meta">{confirmation.reason}</div>}
        </div>
      )}

      <div className="placeholder-note">
        Auto-refresh harga tiap {REFRESH_MS / 1000} detik, histori tiap{' '}
        {HISTORY_REFRESH_MS / 60_000} menit. Oversold/overbought ditaruh
        paling atas — itu titik RSI lagi di zona ekstrem (dipantau orang buat
        kemungkinan reversal), bukan sinyal beli/jual. Klik kartu untuk lihat
        support/resistance & status konfirmasi — murni fakta dari histori
        harga, bukan rekomendasi transaksi.
      </div>
    </div>
  );
}
