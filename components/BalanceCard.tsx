'use client';

import { useCallback, useEffect, useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { fetchSolBalance } from '@/lib/rpc';
import { useInterval } from '@/hooks/useInterval';

const REFRESH_MS = 30_000;

export default function BalanceCard() {
  const { publicKey } = useWallet();
  const [balance, setBalance] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!publicKey) return;
    try {
      const sol = await fetchSolBalance(publicKey);
      setBalance(sol);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal ambil saldo');
    }
  }, [publicKey]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useInterval(refresh, publicKey ? REFRESH_MS : null);

  if (!publicKey) return null;

  return (
    <div className="card">
      <h3>Saldo Wallet</h3>
      <div className="balance-row">
        <span className="balance-num">
          {balance !== null ? balance.toFixed(4) : '—'}
        </span>
        <span className="balance-unit">SOL</span>
      </div>
      <div className="balance-sub">{publicKey.toBase58()}</div>
      {error && <div className="error-inline">{error}</div>}
    </div>
  );
}
