'use client';

import { useWallet } from '@solana/wallet-adapter-react';
import Header from '@/components/Header';
import BalanceCard from '@/components/BalanceCard';
import HoldingsCard from '@/components/HoldingsCard';
import WatchlistCard from '@/components/WatchlistCard';
import AlertsCard from '@/components/AlertsCard';
import ScreenerCard from '@/components/ScreenerCard';
import PositionsCard from '@/components/PositionsCard';

export default function Home() {
  const { connected } = useWallet();

  return (
    <>
      <Header />
      <main>
        {!connected && (
          <div className="hero">
            <h1>Belum terhubung ke wallet</h1>
            <p>
              Klik &quot;Select Wallet&quot; di kanan atas untuk lihat saldo
              SOL dan token kamu. Aplikasi ini tidak pernah menyimpan atau
              meminta private key — semua transaksi tetap kamu yang approve
              manual di wallet.
            </p>
          </div>
        )}

        {connected && (
          <div className="grid">
            <BalanceCard />
            <HoldingsCard />
          </div>
        )}

        <WatchlistCard />

        <div className="row-2">
          <AlertsCard />
          <ScreenerCard />
        </div>

        <PositionsCard />
      </main>
    </>
  );
}
