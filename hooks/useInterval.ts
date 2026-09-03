import { useEffect, useRef } from 'react';

// Versi HTML lama cuma manggil loadAlerts()/loadTokenScreener()/renderWatchlist()
// sekali saat halaman dibuka — user harus manual refresh (F5) untuk data baru.
// Hook ini yang tadinya hilang, dipakai di semua card untuk polling berkala.
export function useInterval(callback: () => void, delayMs: number | null) {
  const savedCallback = useRef(callback);

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (delayMs === null) return;
    const id = setInterval(() => savedCallback.current(), delayMs);
    return () => clearInterval(id);
  }, [delayMs]);
}
