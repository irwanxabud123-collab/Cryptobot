'use client';

export default function PositionsCard() {
  return (
    <div className="card">
      <h3>Posisi & Eksekusi</h3>
      <div className="placeholder-note">
        Eksekusi otomatis (buka posisi langsung dari sini tanpa approve
        manual per-instruksi) <strong>belum tersedia</strong>, dan sengaja
        begitu untuk sekarang:
        <ul>
          <li>
            API resmi Jupiter Perps masih <em>work in progress</em> — belum
            ada endpoint publik untuk build transaksi &quot;buka posisi&quot;
            tinggal tanda tangan. Jalur yang ada sekarang adalah parsing
            Anchor IDL program on-chain-nya langsung lewat{' '}
            <code>@solana/web3.js</code> + <code>@coral-xyz/anchor</code> —
            baru masuk akal dikerjakan sekarang karena project ini sudah
            React dengan build step, tapi belum dikerjakan di rilis ini
            karena risiko salah derive account/PDA dengan duit sungguhan,
            leverage pula.
          </li>
          <li>
            Sinyal dari signal_engine juga belum divalidasi lewat backtest
            (winrate/expectancy), jadi belum pantas dijadikan pemicu order
            otomatis.
          </li>
        </ul>
        Sambil dua hal itu belum kelar, tombol di bawah cuma membuka Jupiter
        Perps resmi di tab baru — kamu tetap yang pilih market, leverage, dan
        approve transaksi sendiri di sana. Tidak ada kunci atau instruksi
        transaksi yang dikirim dari dashboard ini.
      </div>
      <a
        className="cta-button"
        href="https://jup.ag/perps"
        target="_blank"
        rel="noopener noreferrer"
      >
        Buka Jupiter Perps ↗
      </a>
    </div>
  );
}
