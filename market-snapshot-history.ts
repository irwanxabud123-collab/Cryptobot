// market-snapshot-history
//
// market_snapshot adalah tabel upsert satu-baris-per-asset yang diisi oleh
// backend lain (config.py, di luar repo ini) — TIDAK ADA histori di sana.
// Fungsi ini TIDAK menghitung harga/RSI apapun sendiri; ia murni membaca apa
// yang SUDAH ada di market_snapshot pada saat fungsi ini dijalankan, dan
// menyalinnya sebagai satu baris baru ke market_snapshot_history. Ini sengaja
// dibuat terpisah dari proses yang mengisi market_snapshot, supaya tidak
// perlu tahu/menebak logika price-fetching backend itu.
//
// Jadwalkan lewat pg_cron, misal tiap 15 menit — sama seperti pola
// token-screener yang sudah ada di project ini (tiap 30 menit):
//
//   select cron.schedule(
//     'market-snapshot-history-15m',
//     '*/15 * * * *',
//     $$
//     select net.http_post(
//       url := '<PROJECT_URL>/functions/v1/market-snapshot-history',
//       headers := jsonb_build_object('Authorization', 'Bearer <SERVICE_ROLE_OR_ANON_KEY>')
//     );
//     $$
//   );
//
// Kolom macd/macd_signal/volume di market_snapshot_history akan selalu NULL
// lewat fungsi ini, karena market_snapshot sumbernya juga tidak punya kolom
// itu. Isi kolom itu HANYA kalau ada sumber data harga+volume yang sudah
// diputuskan dan diverifikasi — jangan diisi dengan nilai perkiraan.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async () => {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: rows, error: readError } = await supabase
    .from('market_snapshot')
    .select('asset, current_price, rsi, rsi_signal');

  if (readError) {
    return new Response(
      JSON.stringify({ ok: false, step: 'read market_snapshot', error: readError.message }),
      { status: 500, headers: { 'content-type': 'application/json' } }
    );
  }

  if (!rows || rows.length === 0) {
    return new Response(
      JSON.stringify({ ok: true, inserted: 0, note: 'market_snapshot kosong saat ini' }),
      { headers: { 'content-type': 'application/json' } }
    );
  }

  const snapshotAt = new Date().toISOString();
  const toInsert = rows.map((r) => ({
    asset: r.asset,
    current_price: r.current_price,
    rsi: r.rsi,
    rsi_signal: r.rsi_signal,
    // macd / macd_signal / volume sengaja tidak diisi — lihat catatan di atas.
    snapshot_at: snapshotAt,
  }));

  const { error: insertError } = await supabase
    .from('market_snapshot_history')
    .insert(toInsert);

  if (insertError) {
    return new Response(
      JSON.stringify({ ok: false, step: 'insert market_snapshot_history', error: insertError.message }),
      { status: 500, headers: { 'content-type': 'application/json' } }
    );
  }

  return new Response(
    JSON.stringify({ ok: true, inserted: toInsert.length, snapshot_at: snapshotAt }),
    { headers: { 'content-type': 'application/json' } }
  );
});
