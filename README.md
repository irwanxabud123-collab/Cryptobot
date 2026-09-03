# Market Watch — React/Next.js

Migrasi dari `index.html` satu-file ke Next.js + Solana Wallet Adapter,
sesuai arsitektur yang tercatat di rencana proyek (React/Next.js di Netlify,
Wallet Adapter, Supabase).

## Setup

```bash
npm install
cp .env.local.example .env.local   # isi URL + anon key Supabase kamu
npm run dev
```

## Yang berubah dari versi HTML (dan kenapa)

1. **Vanilla JS → React/Next.js + Wallet Adapter.** Sebelumnya vanilla HTML
   dengan `window.solana` manual — sekarang pakai
   `@solana/wallet-adapter-react`, jadi auto-reconnect, dukungan multi-wallet,
   dan event disconnect ditangani library, bukan ditulis ulang manual.
2. **Saldo token SPL (`HoldingsCard.tsx`).** Versi lama cuma `getBalance`
   (SOL native). Sekarang ada `getParsedTokenAccountsByOwner` di
   `lib/rpc.ts` — kalau kamu swap ke token dari Token Screener, saldonya
   kelihatan di dashboard.
3. **Auto-refresh (`hooks/useInterval.ts`).** Watchlist, alert, dan screener
   polling tiap 20–30 detik. Sebelumnya cuma load sekali saat buka halaman.
4. **Key tidak lagi hardcode di source.** `SUPABASE_ANON_KEY` sekarang lewat
   `.env.local` (lihat poin RLS di bawah — ini bukan solusi keamanan, cuma
   kebersihan supaya key tidak ikut ter-commit ke git).

## Yang BELUM ditutup — wajib kamu kerjakan sendiri

- **Row Level Security (RLS).** Saya tidak punya `schema.sql` proyek kamu,
  jadi saya tidak bisa memverifikasi apakah tabel `alerts`,
  `market_snapshot`, `token_screener_alerts` benar-benar read-only untuk
  role `anon`. Anon key aman ditaruh di client HANYA kalau RLS-nya benar.
  Contoh policy read-only minimal per tabel:

  ```sql
  alter table alerts enable row level security;
  create policy "anon read only" on alerts
    for select using (true);
  -- JANGAN buat policy for insert/update/delete untuk role anon.
  ```

  Cek ini di Supabase dashboard sebelum deploy — kalau ada policy insert/
  update/delete yang kebuka untuk anon, siapa saja bisa menulis data alert
  palsu ke dashboard kamu pakai anon key ini (yang memang publik, ada di
  bundle JS manapun).

- **Eksekusi otomatis** masih sengaja belum ada (lihat `PositionsCard.tsx`)
  — alasannya sama seperti sebelumnya: API resmi Jupiter Perps belum siap,
  dan sinyal belum di-backtest.

- **Validasi winrate/expectancy sinyal** juga belum ada instrumentasinya di
  frontend ini — itu pekerjaan di sisi `signal_engine.py`/backend, bukan
  sesuatu yang bisa ditambal dari React.
