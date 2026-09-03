// Backtest win-rate sinyal RSI oversold/overbought dari data market_snapshot_history.
//
// CATATAN JUJUR: ini HANYA menguji RSI sendirian. confirmSignal() di
// WatchlistCard.tsx tidak bisa diuji di sini karena macd/macd_signal/volume
// di tabel ini selalu NULL (lihat komentar baris 135 file itu) — belum ada
// datanya untuk dibacktest. Kalau nanti pipeline backend sudah mengisi
// kolom itu, tambahkan pengujian MACD+volume ke script ini.
//
// Cara pakai:
//   npm install @supabase/supabase-js dotenv
//   node scripts/backtest-rsi.mjs
//
// Env yang dibaca dari .env.local (sama seperti dipakai app Next.js-nya):
//   NEXT_PUBLIC_SUPABASE_URL
//   NEXT_PUBLIC_SUPABASE_ANON_KEY

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

function loadEnvLocal() {
  // Coba beberapa lokasi: sebelah file ini, satu folder di atas file ini,
  // dan folder tempat perintah dijalankan (cwd) — supaya tetap jalan
  // baik script ini ditaruh di root maupun di scripts/.
  const candidates = [
    new URL('./.env.local', import.meta.url),
    new URL('../.env.local', import.meta.url),
    new URL(`file://${process.cwd()}/.env.local`),
  ];
  for (const path of candidates) {
    try {
      const text = readFileSync(path, 'utf8');
      for (const line of text.split('\n')) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m) process.env[m[1]] = process.env[m[1]] ?? m[2].trim();
      }
      return;
    } catch {
      // coba lokasi berikutnya
    }
  }
  // Nggak ketemu di lokasi manapun, lanjut pakai process.env biasa (mungkin
  // sudah di-set lewat cara lain).
}
loadEnvLocal();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY belum ada. Isi .env.local dulu.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const WATCHLIST = ['BTC', 'ETH', 'SOL', 'DOGE', 'BONK', 'PENGU'];

// Berapa snapshot ke depan yang dianggap "hasil" dari sinyal. Snapshot
// history di-generate tiap 5 menit (lihat HISTORY_REFRESH_MS di WatchlistCard.tsx),
// jadi LOOKAHEAD=6 kira-kira 30 menit ke depan, LOOKAHEAD=24 kira-kira 2 jam.
const LOOKAHEAD_STEPS = [6, 12, 24];

// Berapa persen pergerakan minimal ke arah yang "benar" supaya dihitung menang.
// Di bawah ini dianggap noise/seri, bukan menang maupun kalah.
const WIN_THRESHOLD_PCT = 0.005; // 0.5%

const PAGE_SIZE = 1000;

async function fetchAllHistory(asset) {
  let rows = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('market_snapshot_history')
      .select('current_price, rsi, rsi_signal, snapshot_at')
      .eq('asset', asset)
      .order('snapshot_at', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`${asset}: ${error.message}`);
    if (!data || data.length === 0) break;
    rows = rows.concat(data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

function backtestAsset(asset, history) {
  // stats[lookahead] = { oversold: {win,lose,flat}, overbought: {win,lose,flat} }
  const stats = {};
  for (const step of LOOKAHEAD_STEPS) {
    stats[step] = {
      oversold: { win: 0, lose: 0, flat: 0 },
      overbought: { win: 0, lose: 0, flat: 0 },
    };
  }

  for (let i = 0; i < history.length; i++) {
    const row = history[i];
    const signal = row.rsi_signal;
    if (signal !== 'oversold' && signal !== 'overbought') continue;

    const priceNow = Number(row.current_price);
    for (const step of LOOKAHEAD_STEPS) {
      const future = history[i + step];
      if (!future) continue;
      const priceFuture = Number(future.current_price);
      const changePct = (priceFuture - priceNow) / priceNow;

      const bucket = stats[step][signal];
      if (signal === 'oversold') {
        if (changePct > WIN_THRESHOLD_PCT) bucket.win++;
        else if (changePct < -WIN_THRESHOLD_PCT) bucket.lose++;
        else bucket.flat++;
      } else {
        if (changePct < -WIN_THRESHOLD_PCT) bucket.win++;
        else if (changePct > WIN_THRESHOLD_PCT) bucket.lose++;
        else bucket.flat++;
      }
    }
  }

  return stats;
}

function pct(n, total) {
  if (total === 0) return '—';
  return `${((n / total) * 100).toFixed(1)}%`;
}

async function main() {
  console.log(`Backtest RSI oversold/overbought — ambang menang ±${WIN_THRESHOLD_PCT * 100}%\n`);

  const overall = {};
  for (const step of LOOKAHEAD_STEPS) {
    overall[step] = {
      oversold: { win: 0, lose: 0, flat: 0 },
      overbought: { win: 0, lose: 0, flat: 0 },
    };
  }

  for (const asset of WATCHLIST) {
    let history;
    try {
      history = await fetchAllHistory(asset);
    } catch (e) {
      console.log(`${asset}: gagal ambil data (${e.message})\n`);
      continue;
    }

    if (history.length < 30) {
      console.log(`${asset}: cuma ${history.length} baris histori — kurang untuk backtest yang berarti (kumpulkan data lebih lama dulu).\n`);
      continue;
    }

    const stats = backtestAsset(asset, history);
    console.log(`== ${asset} (${history.length} snapshot histori) ==`);
    for (const step of LOOKAHEAD_STEPS) {
      const os = stats[step].oversold;
      const ob = stats[step].overbought;
      const osTotal = os.win + os.lose + os.flat;
      const obTotal = ob.win + ob.lose + ob.flat;
      console.log(
        `  +${step} snapshot (~${Math.round((step * 5) / 60 * 10) / 10} jam): ` +
        `oversold→naik ${pct(os.win, osTotal)} menang / ${osTotal} kejadian` +
        (osTotal > 0 ? '' : ' (belum ada kejadian)') +
        `, overbought→turun ${pct(ob.win, obTotal)} menang / ${obTotal} kejadian` +
        (obTotal > 0 ? '' : ' (belum ada kejadian)')
      );
      overall[step].oversold.win += os.win;
      overall[step].oversold.lose += os.lose;
      overall[step].oversold.flat += os.flat;
      overall[step].overbought.win += ob.win;
      overall[step].overbought.lose += ob.lose;
      overall[step].overbought.flat += ob.flat;
    }
    console.log('');
  }

  console.log('== GABUNGAN SEMUA ASET ==');
  for (const step of LOOKAHEAD_STEPS) {
    const os = overall[step].oversold;
    const ob = overall[step].overbought;
    const osTotal = os.win + os.lose + os.flat;
    const obTotal = ob.win + ob.lose + ob.flat;
    console.log(
      `  +${step} snapshot: oversold→naik ${pct(os.win, osTotal)} (n=${osTotal}), ` +
      `overbought→turun ${pct(ob.win, obTotal)} (n=${obTotal})`
    );
  }

  console.log(
    '\nCatatan cara baca: kalau win-rate di kisaran ~50%, RSI sendirian di ' +
    'watchlist kamu nggak lebih baik dari lempar koin untuk keputusan entry — ' +
    'jangan dijadikan alasan tunggal buka posisi. Kalau konsisten di atas ~60% ' +
    'dengan n cukup besar (puluhan+ kejadian per baris), baru layak dipakai ' +
    'sebagai salah satu syarat, bukan syarat tunggal. n kecil = jangan simpulkan apa-apa dulu, kumpulkan data lebih lama.'
  );
}

main();
