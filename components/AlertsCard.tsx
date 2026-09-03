'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useInterval } from '@/hooks/useInterval';
import { safeUrl } from '@/lib/safeUrl';

const REFRESH_MS = 20_000;

type ReasonItem = string | { text: string; link?: string };

interface AlertRow {
  id: string | number;
  asset: string;
  current_price: string | number;
  urgency: 'tinggi' | 'sedang' | 'rendah';
  bias: string;
  created_at: string;
  summary?: string | null;
  reasons?: ReasonItem[] | null;
}

const URGENCY_CLASS: Record<string, string> = {
  tinggi: 'urgency-high',
  sedang: 'urgency-mid',
  rendah: 'urgency-low',
};

// Urgensi tinggi ditaruh paling atas, baru urut dari yang terbaru per level
// urgensi yang sama — biar sinyal paling layak diperhatikan nggak ketimbun.
const URGENCY_PRIORITY: Record<string, number> = {
  tinggi: 0,
  sedang: 1,
  rendah: 2,
};

function Reason({ reason }: { reason: ReasonItem }) {
  if (typeof reason === 'string') return <li>{reason}</li>;
  const link = reason.link ? safeUrl(reason.link) : null;
  return (
    <li>
      {reason.text}
      {link && (
        <>
          {' '}
          <a href={link} target="_blank" rel="noopener noreferrer">
            baca sumber ↗
          </a>
        </>
      )}
    </li>
  );
}

export default function AlertsCard() {
  const [alerts, setAlerts] = useState<AlertRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!supabase) return;
    const { data, error: err } = await supabase
      .from('alerts')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(30);
    if (err) {
      setError(err.message);
      return;
    }
    setError(null);
    setAlerts((data as AlertRow[]) || []);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useInterval(refresh, REFRESH_MS);

  const sorted = alerts
    ? [...alerts].sort((a, b) => {
        const diff =
          (URGENCY_PRIORITY[a.urgency] ?? 2) -
          (URGENCY_PRIORITY[b.urgency] ?? 2);
        if (diff !== 0) return diff;
        return (
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
      })
    : null;

  const hasPriority = sorted?.some(
    (a) => a.urgency === 'tinggi' || a.urgency === 'sedang'
  );

  return (
    <div className="card">
      <h3>Alert Terbaru</h3>
      {!supabase && (
        <div className="placeholder-note">
          Isi env Supabase dulu untuk memuat alert dari poll-market Edge
          Function.
        </div>
      )}
      {error && <div className="error-inline">{error}</div>}
      {supabase && !error && sorted === null && (
        <div className="placeholder-note">Memuat…</div>
      )}
      {supabase && !error && sorted !== null && sorted.length === 0 && (
        <div className="placeholder-note">
          Belum ada alert tersimpan. Cek apakah Edge Function poll-market
          sudah dijadwalkan lewat pg_cron.
        </div>
      )}
      {supabase &&
        !error &&
        sorted !== null &&
        sorted.length > 0 &&
        !hasPriority && (
          <div className="placeholder-note">
            Belum ada sinyal urgensi tinggi/sedang saat ini — semua masih
            netral. Wajar, bukan berarti sistemnya nggak jalan.
          </div>
        )}
      {sorted &&
        sorted.map((a) => (
          <details
            className="alert-item"
            key={a.id}
            open={a.urgency === 'tinggi'}
          >
            <summary>
              <div className="asset">
                {a.asset} — ${a.current_price}{' '}
                <span className={`badge ${URGENCY_CLASS[a.urgency] ?? ''}`}>
                  ● {a.urgency}
                </span>
              </div>
              <div className="meta">
                {a.bias} · {new Date(a.created_at).toLocaleString('id-ID')}
              </div>
            </summary>
            {a.summary && <div className="summary-text">{a.summary}</div>}
            <ul className="alert-reasons">
              {(a.reasons ?? []).length > 0 ? (
                a.reasons!.map((r, i) => <Reason reason={r} key={i} />)
              ) : (
                <li>Tidak ada rincian tersimpan untuk alert ini.</li>
              )}
            </ul>
          </details>
        ))}
    </div>
  );
}
