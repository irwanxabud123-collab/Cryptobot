'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useInterval } from '@/hooks/useInterval';
import { safeUrl } from '@/lib/safeUrl';
import { buildVerdict, VerdictRole } from '@/lib/verdict';

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
const SPARKLINE_POINTS = 20; // berapa titik histori terakhir dipakai buat gambar garis kecil

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

type ReasonItem = string | { text: string; link?: string };

interface AssetAlertRow {
  id: string | number;
  current_price: string | number;
  created_at: string;
  summary?: string | null;
  reasons?: ReasonItem[] | null;
}

const ICON_COLOR_BY_ROLE: Record<VerdictRole, { bg: string; fg: string }> = {
  success: { bg: 'rgba(20, 241, 149, 0.14)', fg: 'var(--teal)' },
  danger: { bg: 'rgba(240, 84, 106, 0.14)', fg: 'var(--danger)' },
  warning: { bg: 'rgba(232, 179, 57, 0.14)', fg: 'var(--amber)' },
  muted: { bg: 'rgba(139, 146, 160, 0.14)', fg: 'var(--text-dim)' },
};

const VERDICT_BADGE_CLASS: Record<VerdictRole, string> = {
  success: 'verdict-badge verdict-kuat',
  danger: 'verdict-badge verdict-waspada',
  warning: 'verdict-badge verdict-netral',
  muted: 'verdict-badge verdict-unknown',
};

// Urutan tampil: yang butuh perhatian (Waspada/Kuat) duluan, Netral/Data
// kurang di belakang — biar yang paling layak dilihat nggak ketimbun.
const VERDICT_ROLE_PRIORITY: Record<VerdictRole, number> = {
  danger: 0,
  success: 0,
  warning: 1,
  muted: 2,
};

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

// Bikin titik-titik polyline SVG dari histori (terbaru dulu -> dibalik jadi
// lama ke baru), dinormalisasi ke lebar/tinggi kotak sparkline.
function buildSparkline(history: HistoryRow[]): { points: string; trendUp: boolean } | null {
  const prices = history
    .slice(0, SPARKLINE_POINTS)
    .map((h) => h.current_price)
    .reverse();
  if (prices.length < 2) return null;

  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const w = 140;
  const h = 28;

  const points = prices
    .map((p, i) => {
      const x = (i / (prices.length - 1)) * w;
      const y = h - ((p - min) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return { points, trendUp: prices[prices.length - 1] >= prices[0] };
}

function Reason({ reason }: { reason: ReasonItem }) {
  if (typeof reason === 'string') return <li>{reason}</li>;
  const link = reason.link ? safeUrl(reason.link) : null;
  return (
    <li>
      {reason.text}
      {link && (
        <>
          {' '}
          <a href={link} target="_blank" rel="noopener noreferrer">
            baca sumber ↗
          </a>
        </>
      )}
    </li>
  );
}

export default function WatchlistCard() {
  const [byAsset, setByAsset] = useState<Record<string, MarketSnapshotRow>>({});
  const [historyByAsset, setHistoryByAsset] = useState<Record<string, HistoryRow[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const [selectedAsset, setSelectedAsset] = useState<string | null>(null);
  const [assetAlerts, setAssetAlerts] = useState<AssetAlertRow[] | null>(null);
  const [assetAlertsError, setAssetAlertsError] = useState<string | null>(null);

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

  // Berita/fundamental khusus aset yang lagi dibuka — baru diambil pas kartu
  // diklik, bukan sekaligus semua aset tiap 20 detik (hemat query).
  const refreshAssetAlerts = useCallback(async (asset: string) => {
    if (!supabase) return;
    const { data, error: err } = await supabase
      .from('alerts')
      .select('id, current_price, created_at, summary, reasons')
      .eq('asset', asset)
      .order('created_at', { ascending: false })
      .limit(5);
    if (err) {
      setAssetAlertsError(err.message);
      return;
    }
    setAssetAlertsError(null);
    setAssetAlerts((data as AssetAlertRow[]) || []);
  }, []);

  useEffect(() => {
    if (!selectedAsset) return;
    setAssetAlerts(null);
    refreshAssetAlerts(selectedAsset);
  }, [selectedAsset, refreshAssetAlerts]);

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

  // Hitung kesimpulan tiap aset sekali di sini, dipakai buat urutan tampil
  // DAN buat tampilan grid/detail — biar konsisten satu sumber logika.
  const computed = WATCHLIST.map((a) => {
    const row = byAsset[a];
    const history = historyByAsset[a] ?? [];
    const currentPrice = row ? Number(row.current_price) : null;
    const { support, resistance, enoughData } =
      currentPrice != null
        ? findSupportResistance(history, currentPrice)
        : { support: null, resistance: null, enoughData: false };
    const confirmation = confirmSignal(row?.rsi_signal, history);
    const verdict = buildVerdict({
      rsi: row?.rsi,
      rsiSignal: row?.rsi_signal,
      confirmation,
      support,
      resistance,
      currentPrice,
      enoughData,
    });
    const sparkline = buildSparkline(history);
    return { asset: a, row, history, currentPrice, support, resistance, enoughData, confirmation, verdict, sparkline };
  });

  const sorted = [...computed].sort(
    (a, b) => (VERDICT_ROLE_PRIORITY[a.verdict.role] ?? 1) - (VERDICT_ROLE_PRIORITY[b.verdict.role] ?? 1)
  );

  const countByRole = computed.reduce<Record<VerdictRole, number>>(
    (acc, c) => {
      acc[c.verdict.role] = (acc[c.verdict.role] ?? 0) + 1;
      return acc;
    },
    { success: 0, danger: 0, warning: 0, muted: 0 }
  );
  const overallSummary = `${countByRole.danger} waspada · ${countByRole.success} kuat · ${countByRole.warning} netral${
    countByRole.muted ? ` · ${countByRole.muted} data kurang` : ''
  }`;

  const selected = selectedAsset ? computed.find((c) => c.asset === selectedAsset) : null;

  if (selected) {
    const { asset, row, support, resistance, verdict, confirmation, sparkline } = selected;
    const iconColors = ICON_COLOR_BY_ROLE[verdict.role];
    return (
      <div className="card">
        <div className="asset-detail-head">
          <button className="back-button" onClick={() => setSelectedAsset(null)}>
            ← kembali
          </button>
          <div
            className="watch-icon"
            style={{ background: iconColors.bg, color: iconColors.fg }}
          >
            {asset}
          </div>
          <div>
            <div className="asset-detail-title">{asset}</div>
            <div className="asset-detail-price">
              {row ? `$${row.current_price}` : 'menunggu data'}
            </div>
          </div>
          <span className={VERDICT_BADGE_CLASS[verdict.role]} style={{ marginLeft: 'auto' }}>
            {verdict.label}
          </span>
        </div>

        {sparkline && (
          <svg width="100%" height="50" viewBox="0 0 140 28" preserveAspectRatio="none">
            <polyline
              points={sparkline.points}
              fill="none"
              stroke={sparkline.trendUp ? 'var(--teal)' : 'var(--danger)'}
              strokeWidth="2"
            />
          </svg>
        )}

        <div className="detail-section-title">Analisa teknikal</div>
        <div className="detail-box">
          <div className="detail-row">
            <span className="label">RSI</span>
            <span>{row?.rsi != null ? row.rsi : 'menunggu data'}</span>
          </div>
          <div className="detail-row">
            <span className="label">Konfirmasi MACD/volume</span>
            <span>{confirmation.status}</span>
          </div>
          <div className="detail-row">
            <span className="label">Support terdekat</span>
            <span>
              {support
                ? `$${support.price.toFixed(6)} (${support.touches}x, ${daysAgoLabel(support.lastTouchedAt)})`
                : 'belum ada'}
            </span>
          </div>
          <div className="detail-row">
            <span className="label">Resistance terdekat</span>
            <span>
              {resistance
                ? `$${resistance.price.toFixed(6)} (${resistance.touches}x, ${daysAgoLabel(resistance.lastTouchedAt)})`
                : 'belum ada'}
            </span>
          </div>
        </div>
        <div className="meta" style={{ marginTop: 8 }}>{verdict.note}</div>

        <div className="detail-section-title">Analisa fundamental / berita</div>
        {assetAlertsError && <div className="error-inline">{assetAlertsError}</div>}
        {!assetAlertsError && assetAlerts === null && (
          <div className="placeholder-note">Memuat…</div>
        )}
        {!assetAlertsError && assetAlerts !== null && assetAlerts.length === 0 && (
          <div className="placeholder-note">Belum ada catatan berita/fundamental untuk {asset}.</div>
        )}
        {assetAlerts && assetAlerts.length > 0 && (
          <div className="detail-box">
            {assetAlerts.map((a) => (
              <div className="fundamental-item" key={a.id}>
                {a.summary && <div>{a.summary}</div>}
                {(a.reasons ?? []).length > 0 ? (
                  <ul className="alert-reasons">
                    {a.reasons!.map((r, i) => (
                      <Reason reason={r} key={i} />
                    ))}
                  </ul>
                ) : (
                  !a.summary && <div>Tidak ada rincian tersimpan.</div>
                )}
                <div className="meta">{new Date(a.created_at).toLocaleString('id-ID')}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

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
      <div className="watch-summary">{overallSummary}</div>
      <div className="watch-grid">
        {sorted.map(({ asset, row, verdict, sparkline }) => {
          const iconColors = ICON_COLOR_BY_ROLE[verdict.role];
          return (
            <button
              key={asset}
              className="watch-card"
              onClick={() => setSelectedAsset(asset)}
            >
              <div className="watch-card-head">
                <div
                  className="watch-icon"
                  style={{ background: iconColors.bg, color: iconColors.fg }}
                >
                  {asset}
                </div>
                <div className="watch-name">{asset}</div>
              </div>
              {sparkline ? (
                <svg width="100%" height="28" viewBox="0 0 140 28" preserveAspectRatio="none">
                  <polyline
                    points={sparkline.points}
                    fill="none"
                    stroke={sparkline.trendUp ? 'var(--teal)' : 'var(--danger)'}
                    strokeWidth="2"
                  />
                </svg>
              ) : (
                <div className="watch-reason">belum ada histori cukup</div>
              )}
              <div className="watch-price">{row ? `$${row.current_price}` : 'menunggu data'}</div>
              <span className={VERDICT_BADGE_CLASS[verdict.role]}>{verdict.label}</span>
              <div className="watch-reason">{verdict.note}</div>
            </button>
          );
        })}
      </div>
      <div className="placeholder-note">
        Auto-refresh harga tiap {REFRESH_MS / 1000} detik, histori tiap{' '}
        {HISTORY_REFRESH_MS / 60_000} menit. Klik salah satu kartu buat lihat
        analisa teknikal & fundamental lengkap khusus aset itu. Kesimpulan di
        atas dirangkum dari RSI, konfirmasi MACD/volume (kalau tersedia), dan
        posisi harga ke support/resistance — bukan rekomendasi transaksi.
      </div>
    </div>
  );
}
