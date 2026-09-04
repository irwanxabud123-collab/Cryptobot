// Menggabungkan RSI + status konfirmasi + posisi harga terhadap support/resistance
// jadi SATU kesimpulan yang gampang dibaca sekilas, alih-alih user harus baca
// tiap angka terpisah lalu narik kesimpulan sendiri.
//
// PENTING soal jujur ke data: kesimpulan ini murni pola dari data yang SUDAH
// dihitung di tempat lain (rsiSignal, confirmSignal, support/resistance) —
// tidak menambah indikator baru, tidak mengarang angka. Kalau datanya kurang
// (enoughData=false) atau RSI belum ada, kesimpulannya eksplisit "Data kurang",
// bukan ditebak jadi netral.

export type VerdictRole = 'success' | 'danger' | 'warning' | 'muted';

export interface Verdict {
  label: string;
  role: VerdictRole;
  note: string;
}

interface PriceLevelLike {
  price: number;
}

interface ConfirmationLike {
  status: 'terkonfirmasi' | 'belum terkonfirmasi' | 'tidak berlaku';
  reason: string;
}

const NEAR_LEVEL_PCT = 0.01; // ±1% dianggap "mendekati" level

export function buildVerdict(params: {
  rsi: number | null | undefined;
  rsiSignal: string | null | undefined;
  confirmation: ConfirmationLike;
  support: PriceLevelLike | null;
  resistance: PriceLevelLike | null;
  currentPrice: number | null;
  enoughData: boolean;
}): Verdict {
  const { rsi, rsiSignal, confirmation, support, resistance, currentPrice, enoughData } = params;

  if (rsi == null || rsiSignal == null) {
    return { label: 'Menunggu data', role: 'muted', note: 'Data harga/RSI belum masuk.' };
  }

  if (!enoughData) {
    return {
      label: 'Data kurang',
      role: 'muted',
      note: 'Histori harga belum cukup untuk hitung support/resistance — belum bisa disimpulkan.',
    };
  }

  if (rsiSignal === 'overbought') {
    if (confirmation.status === 'terkonfirmasi') {
      return { label: 'Waspada', role: 'danger', note: confirmation.reason };
    }
    return {
      label: 'Waspada',
      role: 'danger',
      note: 'RSI overbought (jenuh beli) — potensi koreksi, tapi belum terkonfirmasi MACD/volume.',
    };
  }

  if (rsiSignal === 'oversold') {
    if (confirmation.status === 'terkonfirmasi') {
      return { label: 'Kuat', role: 'success', note: confirmation.reason };
    }
    return {
      label: 'Netral',
      role: 'warning',
      note: 'RSI oversold (jenuh jual) — potensi rebound, tapi belum terkonfirmasi MACD/volume.',
    };
  }

  // RSI netral: lihat posisi harga relatif ke support/resistance terdekat.
  if (currentPrice != null && resistance) {
    const distToResistance = Math.abs(currentPrice - resistance.price) / resistance.price;
    if (distToResistance <= NEAR_LEVEL_PCT) {
      return {
        label: 'Waspada',
        role: 'danger',
        note: `Harga mendekati resistance $${resistance.price.toFixed(6)} — perhatikan kalau breakout atau ditolak balik.`,
      };
    }
  }
  if (currentPrice != null && support) {
    const distToSupport = Math.abs(currentPrice - support.price) / support.price;
    if (distToSupport <= NEAR_LEVEL_PCT) {
      return {
        label: 'Kuat',
        role: 'success',
        note: `Harga mendekati support $${support.price.toFixed(6)} — perhatikan apakah bertahan atau jebol.`,
      };
    }
  }

  return {
    label: 'Netral',
    role: 'warning',
    note: 'RSI netral, harga di tengah range — belum ada sinyal kuat ke arah manapun.',
  };
}
