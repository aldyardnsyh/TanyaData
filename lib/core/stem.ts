/**
 * Stemming bahasa Indonesia ringan — fallback Sastrawi untuk FTS5 BM25.
 *
 * Kenapa bukan paket `sastrawi`: paket tersebut TIDAK tersedia di registry npm
 * (npm view sastrawi → 404 E404, terukur 2026-11-20). Engine OCR/ML berat juga
 * dilarang oleh kontrak resource (VPS 2 vCPU / 2 GB). Implementasi ini murni
 * regex, 0 dependency, 0 RAM tambahan signifikan.
 *
 * Keterbatasan yang jujur:
 * - Bukan morfologi penuh Sastrawi. Aturan pe-/me-/ber-/ter-/di- + -an/-i/-kan
 *   diterapkan dangkal; tidak menangani semua pengecualian (mis. "pendidikan"
 *   menjadi "pendidik", bukan "didik"; "membaca" → "baca" hanya bila pola
 *   me- + akar cocok).
 * - Kata < 4 karakter tidak di-stem agar tidak merusak token pendek.
 * - Karena indexing FTS5 memakai trigger bawaan, query memakai DUA bentuk
 *   (asli + stem) sehingga retrieval tetap kompatibel dengan teks mentah.
 *   Lihat `searchTerms()` di lib/core/store.ts.
 */

const PREFIXES = [
  'peny', 'pem', 'pen', 'meny', 'mem', 'men', 'met', 'me',
  'ber', 'ter', 'pen', 'pe', 'di', 'ka', 'pa',
];

const SUFFIXES = ['nya', 'kah', 'lah', 'pun', 'kan', 'i', 'an'];

/** Stem satu token. Input diasumsikan sudah huruf kecil. */
export function stemIndonesian(word: string): string {
  let w = String(word ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
  if (w.length < 4) return w;

  // Reduplikasi sederhana: "kata-kata" sudah dipisah pemanggil; "katakata" → "kata".
  if (w.length % 2 === 0) {
    const half = w.slice(0, w.length / 2);
    if (half === w.slice(w.length / 2) && half.length >= 3) w = half;
  }

  for (const suffix of SUFFIXES) {
    if (w.length - suffix.length >= 3 && w.endsWith(suffix)) {
      w = w.slice(0, -suffix.length);
      break;
    }
  }
  for (const prefix of PREFIXES) {
    if (w.length - prefix.length >= 3 && w.startsWith(prefix)) {
      w = w.slice(prefix.length);
      // "meng-" = me- + g- sebelum akar vokal: mengatur → atur.
      if (prefix === 'men' && w.startsWith('g')) w = w.slice(1);
      break;
    }
  }
  return w.length >= 3 ? w : String(word ?? '').toLowerCase();
}

/**
 * Normalisasi teks untuk indexing FTS5: hanya bagian huruf yang di-stem,
 * tanda baca/angka dipertahankan agar sitasi "Pasal 20/Ayat (1)" tetap utuh.
 */
export function normalizeForFts(text: string): string {
  return String(text ?? '')
    .split(/([^\p{L}\p{N}]+)/u)
    .map((part) => (/^\p{L}+$/u.test(part) ? stemIndonesian(part) : part))
    .join('');
}
