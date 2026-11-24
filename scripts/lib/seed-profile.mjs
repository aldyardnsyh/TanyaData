/**
 * Profil seed TanyaData — SATU sumber kebenaran untuk semua script.
 *
 *   none (default) → produksi bersih: tanpa PDF KB-SOP, Perpres, analytics
 *                    dummy, dan tanpa dokumen di FTS5/Qdrant.
 *   demo           → seed R&D untuk development (4 KB-SOP + Perpres + 46.952
 *                    transaksi). TIDAK dipakai oleh deploy produksi.
 *
 * Fail-closed: nilai selain `none`/`demo` ditolak, bukan diam-diam jatuh ke
 * `none`. Ini mencegah typo (mis. `dem0`) menghasilkan image produksi yang
 * salah tanpa ada yang menyadarinya.
 */

const VALID_PROFILES = Object.freeze(['none', 'demo']);

export function readSeedProfile() {
  const raw = String(process.env.SEED_PROFILE ?? 'none').trim().toLowerCase();
  if (!VALID_PROFILES.includes(raw)) {
    throw new Error(
      `SEED_PROFILE tidak valid: "${raw}". Nilai yang diizinkan: ${VALID_PROFILES.join(' | ')}.`,
    );
  }
  return raw;
}

export function isDemoSeed() {
  return readSeedProfile() === 'demo';
}

export function seedProfileLabel(profile = readSeedProfile()) {
  return profile === 'demo' ? 'demo (R&D)' : 'none (produksi bersih)';
}
