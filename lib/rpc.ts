import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';

const TOKEN_PROGRAM_ID = new PublicKey(
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
);

const FALLBACK_RPC_ENDPOINTS = [
  process.env.NEXT_PUBLIC_RPC_URL_PRIMARY,
  'https://api.mainnet-beta.solana.com',
  'https://solana-rpc.publicnode.com',
  'https://rpc.ankr.com/solana',
].filter((v): v is string => Boolean(v));

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Coba tiap endpoint di FALLBACK_RPC_ENDPOINTS secara berurutan, dengan retry
// sekali per endpoint kalau kena rate limit (429). RPC publik dipakai bersama
// semua orang yang belum set RPC sendiri, jadi 429 itu wajar di jam sibuk —
// bukan berarti wallet/koneksinya rusak.
async function withRpcFallback<T>(
  fn: (connection: Connection) => Promise<T>
): Promise<T> {
  let lastErr: unknown = null;
  for (const endpoint of FALLBACK_RPC_ENDPOINTS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const connection = new Connection(endpoint, 'confirmed');
        return await fn(connection);
      } catch (err) {
        lastErr = err;
        const isRateLimit =
          err instanceof Error && /429|rate.?limit/i.test(err.message);
        if (isRateLimit && attempt === 0) {
          await sleep(800);
          continue;
        }
        break; // endpoint ini gagal → coba endpoint berikutnya
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Semua RPC gagal');
}

export async function fetchSolBalance(owner: PublicKey): Promise<number> {
  return withRpcFallback(async (connection) => {
    const lamports = await connection.getBalance(owner, 'confirmed');
    return lamports / LAMPORTS_PER_SOL;
  });
}

export interface TokenHolding {
  mint: string;
  amount: number;
  decimals: number;
}

// Perbaikan poin #2 dari review: dashboard versi HTML lama cuma nampilin saldo
// SOL native, padahal token screener aktif nyaranin swap ke token SPL baru.
// Ini yang tadinya hilang — daftar semua saldo token SPL yang dipegang wallet.
export async function fetchTokenHoldings(
  owner: PublicKey
): Promise<TokenHolding[]> {
  return withRpcFallback(async (connection) => {
    const resp = await connection.getParsedTokenAccountsByOwner(owner, {
      programId: TOKEN_PROGRAM_ID,
    });
    return resp.value
      .map((acc) => {
        const info = acc.account.data.parsed.info;
        const amount = info.tokenAmount;
        return {
          mint: info.mint as string,
          amount: Number(amount.uiAmountString ?? amount.uiAmount ?? 0),
          decimals: amount.decimals as number,
        };
      })
      .filter((t) => t.amount > 0)
      .sort((a, b) => b.amount - a.amount);
  });
}
