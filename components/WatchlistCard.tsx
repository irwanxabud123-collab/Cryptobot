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

  return (
    <div className="card">
      <h3>Watchlist (dari config.py)</h3>
      {error && <div className="error-inline">{error}</div>}
      {WATCHLIST.map((a) => {
        const row = byAsset[a];
        return (
          <div className="list-row" key={a}>
            <span className="asset">{a}</span>
            <span className="val">
              {row
                ? `$${row.current_price} · ${
                    row.rsi != null
                      ? `RSI ${row.rsi} (${
                          RSI_LABEL[row.rsi_signal ?? ''] ?? row.rsi_signal
                        })`
                      : 'menunggu data'
                  }`
                : 'menunggu data'}
            </span>
          </div>
        );
      })}
      <div className="placeholder-note">
        Auto-refresh tiap {REFRESH_MS / 1000} detik — tidak perlu reload
        manual lagi.
      </div>
    </div>
  );
}
