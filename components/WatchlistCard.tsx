'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useInterval } from '@/hooks/useInterval';

// Sesuai WATCHED_ASSETS di config.py
const WATCHLIST = ['BTC', 'ETH', 'SOL', 'DOGE', 'BONK', 'PENGU'];
const REFRESH_MS = 20_000;

interface MarketSnapshotRow {
  asset: string;
  current_price: string | number;
  rsi: number | null;
  rsi_signal: 'oversold' | 'overbought' | 'netral' | null;
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

export default function WatchlistCard() {
  const [byAsset, setByAsset] = useState<Record<string, MarketSnapshotRow>>(
    {}
  );
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    refresh();
  }, [refresh]);

  useInterval(refresh, REFRESH_MS);

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

  return (
    <div className="card">
      <h3>Watchlist (dari config.py)</h3>
      {error && <div className="error-inline">{error}</div>}
      {sorted.map((a) => {
        const row = byAsset[a];
        return (
          <div className="list-row" key={a}>
            <span className="asset">{a}</span>
            <span className="val">
              {row ? (
                <>
                  ${row.current_price}{' '}
                  {row.rsi != null ? (
                    <>
                      · RSI {row.rsi}{' '}
                      <span className={signalClass(row.rsi_signal)}>
                        ({RSI_LABEL[row.rsi_signal ?? ''] ?? row.rsi_signal})
                      </span>
                    </>
                  ) : (
                    '· menunggu data'
                  )}
                </>
              ) : (
                'menunggu data'
              )}
            </span>
          </div>
        );
      })}
      <div className="placeholder-note">
        Auto-refresh tiap {REFRESH_MS / 1000} detik. Oversold/overbought
        ditaruh paling atas — itu titik RSI lagi di zona ekstrem (dipantau
        orang buat kemungkinan reversal), bukan sinyal beli/jual. Netral
        berarti belum ada yang menonjol.
      </div>
    </div>
  );
}
