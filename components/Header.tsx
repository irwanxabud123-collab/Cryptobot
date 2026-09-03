'use client';

import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';

export default function Header() {
  return (
    <header className="header">
      <div className="brand">
        <span className="brand-dot" />
        Market Watch
        <span className="stage-tag">Tahap 2 — React, saldo penuh, auto-refresh</span>
      </div>
      <WalletMultiButton />
    </header>
  );
}
