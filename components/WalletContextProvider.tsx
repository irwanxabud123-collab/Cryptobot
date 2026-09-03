'use client';

import { useMemo } from 'react';
import {
  ConnectionProvider,
  WalletProvider,
} from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-wallets';

import '@solana/wallet-adapter-react-ui/styles.css';

const PRIMARY_ENDPOINT =
  process.env.NEXT_PUBLIC_RPC_URL_PRIMARY ||
  'https://api.mainnet-beta.solana.com';

export default function WalletContextProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  // Wallet Adapter menangani auto-reconnect ("onlyIfTrusted"), event disconnect,
  // dan dukungan multi-wallet (Phantom, Solflare, dst) tanpa kita tulis ulang
  // logic window.solana manual seperti di versi HTML — itu salah satu alasan
  // utama migrasi ke React.
  const wallets = useMemo(() => [new PhantomWalletAdapter()], []);

  return (
    <ConnectionProvider endpoint={PRIMARY_ENDPOINT}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
