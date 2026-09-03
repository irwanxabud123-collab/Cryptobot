// React otomatis escape teks di JSX, jadi escapeHtml() manual dari versi HTML
// lama tidak perlu lagi. TAPI itu tidak berlaku untuk atribut href yang kita
// bangun sendiri dari data eksternal (token_address dari Jupiter, link RSS) —
// itu masih perlu divalidasi protokolnya manual, kalau tidak bisa jadi celah
// javascript: URL persis seperti di versi HTML.
export function safeUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.href;
  } catch {
    /* bukan URL valid, abaikan */
  }
  return null;
}
