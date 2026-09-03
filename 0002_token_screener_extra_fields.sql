-- Field tambahan dari Jupiter Tokens API v2 (dikonfirmasi ada di skema resmi
-- endpoint /search dan /recent; endpoint yang dipakai project ini,
-- /tokens/v2/toporganicscore/{interval}, kemungkinan besar memakai bentuk
-- objek token yang sama karena satu keluarga API — tapi ini belum diverifikasi
-- langsung dari response toporganicscore itu sendiri, jadi Edge Function di
-- bawah WAJIB defensif kalau field ternyata tidak ada di respons itu).
--
-- "Deskripsi" token TIDAK ada di skema Jupiter manapun yang saya temukan —
-- jangan tambahkan kolom untuk itu, tampilkan "tidak tersedia dari sumber
-- data" di frontend apa adanya.

alter table public.token_screener_alerts
  add column if not exists token_website text,
  add column if not exists token_twitter text,
  add column if not exists token_tags text[],
  add column if not exists token_created_at timestamptz;

comment on column public.token_screener_alerts.token_website is
  'Dari field "website" respons Jupiter Tokens API v2. NULL kalau token tidak mencantumkannya.';
comment on column public.token_screener_alerts.token_twitter is
  'Dari field "twitter" respons Jupiter Tokens API v2. NULL kalau token tidak mencantumkannya.';
comment on column public.token_screener_alerts.token_tags is
  'Dari field "tags" respons Jupiter Tokens API v2 (mis. community, strict, verified) — bukan deskripsi bebas.';
comment on column public.token_screener_alerts.token_created_at is
  'Dari field "createdAt" (mint creation) respons Jupiter Tokens API v2. Beda dengan pair_created_at yang sudah ada (itu firstPool.createdAt / tanggal pool dibuat, bukan tanggal mint token).';
