'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useInterval } from '@/hooks/useInterval';
import { safeUrl } from '@/lib/safeUrl';

const REFRESH_MS = 30_000;

type ReasonItem = string | { text: string; link?: string };

interface ScreenerRow {
  token_address: string;
  token_symbol: string | null;
  token_name: string | null;
  organic_score: number | null;
  mint_authority_renounced: boolean | null;
  freeze_authority_renounced: boolean | null;
  top_holder_pct: number | null;
  rugcheck_checked: boolean | null;
  rugcheck_rugged: boolean | null;
  rugcheck_score: number | null;
  momentum: string | null;
  price_change_24h_pct: number | string | null;
  created_at: string;
  reasons?: ReasonItem[] | null;
}

function dedupeLatestPerToken(rows: ScreenerRow[], limit: number) {
  const seen = new Set<string>();
  const out: ScreenerRow[] = [];
  for (const row of rows) {
    if (seen.has(row.token_address)) continue;
    seen.add(row.token_address);
    out.push(row);
    if (out.length >= limit) break;
  }
  return out;
}

function boolBadge(
  value: boolean | null,
  trueLabel: string,
  falseLabel: string,
  unknownLabel: string
) {
  if (value === true) return <span className="ok">✓ {trueLabel}</span>;
  if (value === false) return <span className="bad">✗ {falseLabel}</span>;
  return <span className="unknown">? {unknownLabel}</span>;
}

function reasonsFor(t: ScreenerRow): ReasonItem[] {
  if (Array.isArray(t.reasons) && t.reasons.length) return t.reasons;
  const fallback: ReasonItem[] = [];
  if (t.organic_score != null)
    fallback.push(`Organic Score ${Number(t.organic_score).toFixed(1)}.`);
  fallback.push(
    `Mint authority: ${
      t.mint_authority_renounced === true
        ? 'sudah di-renounce'
        : t.mint_authority_renounced === false
        ? 'BELUM di-renounce'
        : 'tidak diketahui'
    }.`
  );
  fallback.push(
    `Freeze authority: ${
      t.freeze_authority_renounced === true
        ? 'sudah di-renounce'
        : t.freeze_authority_renounced === false
        ? 'BELUM di-renounce'
        : 'tidak diketahui'
    }.`
  );
  if (t.top_holder_pct != null)
    fallback.push(`Top holder ${Number(t.top_holder_pct).toFixed(2)}% dari supply.`);
  if (t.rugcheck_checked === true) {
    fallback.push(
      `RugCheck: ${
        t.rugcheck_rugged === true
          ? 'ditandai rugged'
          : 'tidak ada risk level danger terdeteksi'
      }${t.rugcheck_score != null ? ` (score ${t.rugcheck_score})` : ''}.`
    );
  } else {
    fallback.push('RugCheck: gagal/timeout saat cek terakhir — verifikasi manual di rugcheck.xyz.');
  }
  if (t.momentum) fallback.push(`Momentum dibanding scan sebelumnya: ${t.momentum}.`);
  fallback.push('⚠️ LP lock/burn BELUM dijamin lengkap — verifikasi manual sebelum swap.');
  return fallback;
}

export default function ScreenerCard() {
  const [rows, setRows] = useState<ScreenerRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!supabase) return;
    const { data, error: err } = await supabase
      .from('token_screener_alerts')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);
    if (err) {
      setError(err.message);
      return;
    }
    setError(null);
    setRows(dedupeLatestPerToken((data as ScreenerRow[]) || [], 30));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useInterval(refresh, REFRESH_MS);

  return (
    <div className="card">
      <h3>Token Screener — Solana Baru (Jupiter organicScore)</h3>
      {!supabase && (
        <div className="placeholder-note">
          Isi env Supabase dulu untuk memuat hasil dari token-screener Edge
          Function.
        </div>
      )}
      {error && <div className="error-inline">{error}</div>}
      {supabase && !error && rows === null && (
        <div className="placeholder-note">Memuat…</div>
      )}
      {supabase && !error && rows !== null && rows.length === 0 && (
        <div className="placeholder-note">
          Belum ada token yang lolos filter. Cek apakah Edge Function
          token-screener sudah dijadwalkan lewat pg_cron.
        </div>
      )}
      {rows &&
        rows.map((t) => {
          const priceChange =
            t.price_change_24h_pct != null ? Number(t.price_change_24h_pct) : null;
          const dexUrl = safeUrl(
            `https://dexscreener.com/solana/${encodeURIComponent(t.token_address)}`
          );
          const rugcheckUrl = safeUrl(
            `https://rugcheck.xyz/tokens/${encodeURIComponent(t.token_address)}`
          );
          return (
            <details className="alert-item" key={t.token_address}>
              <summary>
                <div className="asset">
                  {t.token_symbol || '?'} — {t.token_name || 'nama tidak diketahui'}{' '}
                  <span
                    className={
                      priceChange == null
                        ? 'unknown'
                        : priceChange >= 0
                        ? 'ok'
                        : 'bad'
                    }
                    style={{ fontSize: 11 }}
                  >
                    ●{' '}
                    {priceChange == null
                      ? 'perubahan harga 24j tidak diketahui'
                      : `${priceChange >= 0 ? '+' : ''}${priceChange.toFixed(2)}% / 24j`}
                  </span>
                </div>
                <div className="meta">
                  Organic Score{' '}
                  {t.organic_score != null ? Number(t.organic_score).toFixed(1) : 'tidak diketahui'}
                  {' · '}
                  {boolBadge(t.mint_authority_renounced, 'mint renounced', 'mint AKTIF', 'mint ?')}
                  {' · '}
                  {boolBadge(t.freeze_authority_renounced, 'freeze renounced', 'freeze AKTIF', 'freeze ?')}
                  {' · '}
                  {t.created_at ? new Date(t.created_at).toLocaleString('id-ID') : ''}
                </div>
              </summary>
              <ul className="alert-reasons">
                {reasonsFor(t).map((r, i) =>
                  typeof r === 'string' ? (
                    <li key={i}>{r}</li>
                  ) : (
                    <li key={i}>
                      {r.text}
                      {r.link && safeUrl(r.link) && (
                        <>
                          {' '}
                          <a href={safeUrl(r.link)!} target="_blank" rel="noopener noreferrer">
                            baca sumber ↗
                          </a>
                        </>
                      )}
                    </li>
                  )
                )}
              </ul>
              <div className="links-row">
                {dexUrl && (
                  <a href={dexUrl} target="_blank" rel="noopener noreferrer">
                    Cek di DexScreener ↗
                  </a>
                )}
                {dexUrl && rugcheckUrl && ' · '}
                {rugcheckUrl && (
                  <a href={rugcheckUrl} target="_blank" rel="noopener noreferrer">
                    Cek di RugCheck ↗
                  </a>
                )}
              </div>
            </details>
          );
        })}
      <div className="placeholder-note">
        Filter ini cuma cek organicScore + mint/freeze authority + top holder
        % + RugCheck. LP lock/burn BELUM diverifikasi otomatis — selalu cek
        manual di DexScreener/rugcheck.xyz sebelum swap token manapun dari
        daftar ini. Ini daftar sinyal untuk kamu evaluasi sendiri, bukan
        rekomendasi beli/jual.
      </div>
    </div>
  );
}
