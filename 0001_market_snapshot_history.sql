-- market_snapshot saat ini adalah tabel upsert satu-baris-per-asset (kolom:
-- asset, current_price, rsi, rsi_signal, updated_at) — TIDAK ADA histori sama
-- sekali, karena setiap refresh backend (config.py) menimpa baris yang sama.
--
-- Tabel ini menampung histori append-only, diisi oleh Edge Function
-- market-snapshot-history (lihat supabase/functions/market-snapshot-history)
-- yang membaca market_snapshot secara periodik dan menyimpan salinannya di sini.
--
-- Kolom macd/macd_signal/volume sengaja dibuat NULLABLE dan TIDAK diisi oleh
-- Edge Function ini, karena market_snapshot sendiri tidak punya data itu.
-- Sampai ada keputusan sumber data harga+volume untuk BTC/ETH vs SOL/DOGE/
-- BONK/PENGU, kolom ini akan selalu NULL — jangan diisi dengan nilai
-- karangan di sisi manapun.

create table if not exists public.market_snapshot_history (
  id bigint generated always as identity primary key,
  asset text not null,
  current_price numeric not null,
  rsi numeric,
  rsi_signal text,
  macd numeric,
  macd_signal numeric,
  volume numeric,
  snapshot_at timestamptz not null default now()
);

create index if not exists market_snapshot_history_asset_snapshot_at_idx
  on public.market_snapshot_history (asset, snapshot_at desc);

alter table public.market_snapshot_history enable row level security;

-- Read-only untuk anon, sama seperti pola RLS market_snapshot yang sudah ada
-- (lihat README bagian RLS di project ini). Sesuaikan nama policy kalau
-- konvensi penamaan project berbeda.
create policy "market_snapshot_history_select_anon"
  on public.market_snapshot_history
  for select
  to anon
  using (true);
