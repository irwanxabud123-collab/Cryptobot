'use client';

import { useCallback, useEffect, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { fetchTokenHoldings, TokenHolding } from '@/lib/rpc';
import { useInterval } from '@/hooks/useInterval';

const REFRESH_MS = 30_000;

function shortMint(mint: string) {
  return mint.slice(0, 4) + '…' + mint.slice(-4);
}

export default function HoldingsCard() {
  const { publicKey } = useWallet();
  const [holdings, setHoldings] = useState<TokenHolding[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!publicKey) return;
    try {
      const result = await fetchTokenHoldings(publicKey);
      setHoldings(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal ambil token');
    }
  }, [publicKey]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useInterval(refresh, publicKey ? REFRESH_MS : null);

  if (!publicKey) return null;

  return (
    <div className="card">
      <h3>Token SPL yang Dipegang</h3>
      {error && <div className="error-inline">{error}</div>}
      {!error && holdings === null && (
        <div className="placeholder-note">Memuat…</div>
      )}
      {!error && holdings !== null && holdings.length === 0 && (
        <div className="placeholder-note">
          Tidak ada token SPL dengan saldo &gt; 0 di wallet ini.
        </div>
      )}
      {holdings && holdings.length > 0 && (
        <div>
          {holdings.map((t) => (
            <div className="list-row" key={t.mint}>
              <span className="asset mono">{shortMint(t.mint)}</span>
              <span className="val">{t.amount.toLocaleString('id-ID')}</span>
            </div>
          ))}
        </div>
      )}
      <div className="placeholder-note">
        Ini saldo mentah on-chain (mint address, bukan simbol/nama) — belum
        di-resolve ke metadata token. Cek mint address di DexScreener kalau
        mau tahu token apa.
      </div>
    </div>
  );
}
