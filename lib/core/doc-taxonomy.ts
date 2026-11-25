/**
 * TAKSONOMI DOKUMEN TUNGGAL (epik ADAPT / WS-A).
 *
 * Sebelum file ini ada, ada TIGA definisi `DocType` yang saling bertentangan:
 *  - `lib/core/contracts.ts`  : legal | technical_report | financial | general | unknown
 *  - `lib/ai/types.ts`        : legal | technical_report | financial | general
 *  - `lib/core/doc-analytics.ts`: financial-report | incident-report | general
 *
 * Registry di bawah adalah satu-satunya sumber kebenaran untuk **grup** dan
 * **jenis** dokumen. Ketiga modul di atas kini memakai tipe `DocType` dari
 * sini (lihat re-export), sehingga tidak ada lagi daftar nilai yang berbeda.
 *
 * CATATAN PENTING TENTANG `DocType` (terbuka, bukan union tertutup):
 * `lib/ai/classifier.ts` (lane aiml) memakai `Record<DocType, ...>` yang
 * exhaustif untuk 4 id klasifikasi lama. Menambah id baru (identity, sop, ...)
 * ke sebuah union tertutup akan membuat modul itu gagal typecheck — dan tiket
 * ini dilarang menyentuhnya. Karena itu `DocType` sengaja didefinisikan sebagai
 * `string` agar kode lama (termasuk pembandingan `=== 'unknown'` di adapter)
 * tetap kompilasi, sementara himpunan nilai yang SAH dan lengkap hidup di
 * `DOC_TYPES` / `DocTypeId`. Kode baru sebaiknya memakai `DocTypeId` dan
 * `normalizeDocType()`; nilai tak dikenal dinormalisasi ke `unknown` (grup
 * `general`), bukan dibuang.
 *
 * Tidak ada dependensi runtime di file ini supaya aman dimuat oleh eval
 * harness Node type-stripping maupun Next.js.
 */

/* ------------------------------------------------------------------- types */

export type DocGroup = 'finance' | 'sop' | 'technical' | 'identity' | 'general';

/**
 * Himpunan tertutup id jenis dokumen yang dikenal registry.
 *
 * Id lama (`legal`, `technical_report`, `financial`, `general`, `unknown`)
 * dipertahankan apa adanya karena sudah tersimpan di DB, fixture eval, dan
 * kontrak API. Id baru ditambahkan tanpa mengubah yang lama.
 */
export type DocTypeId =
  // --- id lama (stabil; jangan diganti) ---
  | 'legal'
  | 'technical_report'
  | 'financial'
  | 'general'
  | 'unknown'
  // --- SOP / prosedur ---
  | 'sop'
  // --- identity / KYC ---
  | 'ktp'
  | 'paspor'
  | 'sim'
  | 'kartu_keluarga'
  | 'npwp'
  | 'tagihan_utilitas'
  | 'rekening_koran';

/**
 * Tipe dokumen yang dipakai lintas modul. Terbuka dengan sengaja — lihat
 * catatan modul di atas. Nilai sah = `DocTypeId` (registry `DOC_TYPES`).
 */
export type DocType = string;

export interface DocGroupDefinition {
  id: DocGroup;
  label: string;
  labelEn: string;
  /** Alias yang diterima saat membaca grup dari data lama / input luar. */
  aliases: readonly string[];
}

export interface DocTypeDefinition {
  id: DocTypeId;
  group: DocGroup;
  /** Label Bahasa Indonesia (dipakai UI/eval). */
  label: string;
  labelEn: string;
  /**
   * Alias kompatibilitas: nilai lama / ejaan lain yang harus tetap terbaca.
   * Contoh: `financial-report` (doc-analytics lama), `incident-report`, `kk`.
   */
  aliases: readonly string[];
}

/* ---------------------------------------------------------------- registry */

export const DOC_GROUPS: readonly DocGroupDefinition[] = [
  {
    id: 'finance',
    label: 'Keuangan',
    labelEn: 'Finance',
    aliases: ['financial', 'keuangan', 'finansial'],
  },
  {
    id: 'sop',
    label: 'SOP / Legal',
    labelEn: 'SOP / Legal',
    aliases: ['legal', 'sop_legal', 'prosedur', 'hukum', 'regulasi'],
  },
  {
    id: 'technical',
    label: 'Teknis',
    labelEn: 'Technical',
    aliases: ['technical_report', 'teknis', 'technical'],
  },
  {
    id: 'identity',
    label: 'Identitas',
    labelEn: 'Identity',
    aliases: ['identitas', 'kyc', 'id', 'personal'],
  },
  {
    id: 'general',
    label: 'Umum',
    labelEn: 'General',
    aliases: ['umum', 'other', 'lainnya'],
  },
];

export const DOC_TYPES: readonly DocTypeDefinition[] = [
  /* ---------------------------------------------------------------- finance */
  {
    id: 'financial',
    group: 'finance',
    label: 'Laporan keuangan',
    labelEn: 'Financial report',
    aliases: [
      'financial-report',
      'financial_report',
      'finance',
      'keuangan',
      'laporan_keuangan',
      'laporan-keuangan',
      'income_statement',
      'balance_sheet',
    ],
  },

  /* ------------------------------------------------------------- sop/legal */
  {
    id: 'legal',
    group: 'sop',
    label: 'Legal / Regulasi',
    labelEn: 'Legal / Regulation',
    aliases: [
      'legal_document',
      'hukum',
      'peraturan',
      'undang_undang',
      'undang-undang',
      'regulasi',
      'uu',
      'perpres',
    ],
  },
  {
    id: 'sop',
    group: 'sop',
    label: 'SOP / Prosedur',
    labelEn: 'SOP / Procedure',
    aliases: [
      'prosedur',
      'sop_dokumen',
      'standard_operating_procedure',
      'work_instruction',
      'instruksi_kerja',
    ],
  },

  /* --------------------------------------------------------------- technical */
  {
    id: 'technical_report',
    group: 'technical',
    label: 'Laporan teknis',
    labelEn: 'Technical report',
    aliases: [
      'technical-report',
      'technical',
      'teknis',
      'laporan_teknis',
      'incident-report',
      'incident_report',
      'insiden',
      'laporan_insiden',
      'failure_report',
    ],
  },

  /* ---------------------------------------------------------------- identity */
  {
    id: 'ktp',
    group: 'identity',
    label: 'KTP',
    labelEn: 'National ID card',
    aliases: ['kartu_tanda_penduduk', 'ktp_el', 'e_ktp', 'nik', 'id_card', 'identity_card'],
  },
  {
    id: 'paspor',
    group: 'identity',
    label: 'Paspor',
    labelEn: 'Passport',
    aliases: ['passport', 'passport_number', 'paspor_ri'],
  },
  {
    id: 'sim',
    group: 'identity',
    label: 'SIM',
    labelEn: "Driver's licence",
    aliases: ['surat_izin_mengemudi', 'driver_license', 'sim_a', 'sim_c'],
  },
  {
    id: 'kartu_keluarga',
    group: 'identity',
    label: 'Kartu Keluarga',
    labelEn: 'Family card',
    aliases: ['kk', 'family_card', 'kartu-keluarga'],
  },
  {
    id: 'npwp',
    group: 'identity',
    label: 'NPWP',
    labelEn: 'Tax ID',
    aliases: ['nomor_pokok_wajib_pajak', 'tax_id', 'npwp_badan', 'npwp_pribadi'],
  },
  {
    id: 'tagihan_utilitas',
    group: 'identity',
    label: 'Tagihan utilitas',
    labelEn: 'Utility bill',
    aliases: ['tagihan', 'utility_bill', 'bill', 'tagihan_listrik', 'tagihan_air', 'pln', 'pdam'],
  },
  {
    id: 'rekening_koran',
    group: 'identity',
    label: 'Rekening koran',
    labelEn: 'Bank statement',
    aliases: ['bank_statement', 'statement', 'mutasi_rekening', 'rekening-koran', 'account_statement'],
  },

  /* ----------------------------------------------------------------- general */
  {
    id: 'general',
    group: 'general',
    label: 'Dokumen umum',
    labelEn: 'General document',
    aliases: ['umum', 'other', 'lainnya', 'document', 'dokumen'],
  },
  {
    id: 'unknown',
    group: 'general',
    label: 'Belum terklasifikasi',
    labelEn: 'Unclassified',
    aliases: ['unclassified', 'belum_terklasifikasi', 'none'],
  },
];

/* --------------------------------------------------------------- normalisasi */

/**
 * Kunci pencarian: huruf kecil, spasi/titik/strip -> underscore, underscore
 * berulang dipadatkan. Membuat `financial-report`, `Financial Report`, dan
 * `financial_report` setara tanpa mengubah nilai yang disimpan.
 */
function normalizeKey(raw: string | null | undefined): string {
  if (raw == null) return '';
  return String(raw)
    .trim()
    .toLowerCase()
    .replace(/[\s\-./]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

const TYPE_BY_KEY = new Map<string, DocTypeDefinition>();
const TYPE_BY_ID = new Map<string, DocTypeDefinition>();
for (const def of DOC_TYPES) {
  TYPE_BY_ID.set(normalizeKey(def.id), def);
  TYPE_BY_KEY.set(normalizeKey(def.id), def);
  for (const alias of def.aliases) TYPE_BY_KEY.set(normalizeKey(alias), def);
}

const GROUP_BY_KEY = new Map<string, DocGroupDefinition>();
for (const def of DOC_GROUPS) {
  GROUP_BY_KEY.set(normalizeKey(def.id), def);
  for (const alias of def.aliases) GROUP_BY_KEY.set(normalizeKey(alias), def);
}

/**
 * Mapping kompatibilitas nilai lama -> id kanonik. Diturunkan dari alias di
 * `DOC_TYPES`, jadi tidak ada daftar kedua yang bisa melenceng.
 */
export const LEGACY_DOC_TYPE_ALIASES: Readonly<Record<string, DocTypeId>> = Object.freeze(
  DOC_TYPES.reduce<Record<string, DocTypeId>>((acc, def) => {
    for (const alias of def.aliases) {
      const key = normalizeKey(alias);
      if (key && key !== normalizeKey(def.id)) acc[alias] = def.id;
    }
    return acc;
  }, {}),
);

/* -------------------------------------------------------------------- API */

/** Definisi jenis dokumen untuk nilai apa pun (termasuk alias lama). */
export function getDocTypeDefinition(raw: string | null | undefined): DocTypeDefinition | null {
  const key = normalizeKey(raw);
  if (!key) return null;
  return TYPE_BY_KEY.get(key) ?? null;
}

/** True hanya untuk id kanonik (`DocTypeId`), bukan alias. */
export function isDocTypeId(raw: string | null | undefined): raw is DocTypeId {
  const key = normalizeKey(raw);
  return Boolean(key) && TYPE_BY_ID.has(key);
}

/**
 * Normalisasi nilai dokumen apa pun menjadi id kanonik. Nilai kosong atau tak
 * dikenal -> `unknown` (grup `general`) supaya alur ingest tidak pernah gagal
 * hanya karena tipe belum dikenal.
 */
export function normalizeDocType(raw: string | null | undefined): DocTypeId {
  return getDocTypeDefinition(raw)?.id ?? 'unknown';
}

/** Grup dari nilai jenis dokumen (alias lama ikut dikenali). */
export function docGroupOf(raw: string | null | undefined): DocGroup {
  return getDocTypeDefinition(raw)?.group ?? 'general';
}

/** Validasi/normalisasi nilai grup; `null` bila bukan grup yang dikenal. */
export function normalizeDocGroup(raw: string | null | undefined): DocGroup | null {
  const key = normalizeKey(raw);
  if (!key) return null;
  return GROUP_BY_KEY.get(key)?.id ?? null;
}

export function isDocGroup(raw: string | null | undefined): raw is DocGroup {
  return normalizeDocGroup(raw) !== null;
}

export function getDocGroupDefinition(raw: string | null | undefined): DocGroupDefinition | null {
  const key = normalizeKey(raw);
  if (!key) return null;
  return GROUP_BY_KEY.get(key) ?? null;
}

/** Label jenis dokumen; fallback jujur ke nilai mentah atau "Belum terklasifikasi". */
export function docTypeLabel(raw: string | null | undefined, lang: 'id' | 'en' = 'id'): string {
  const def = getDocTypeDefinition(raw);
  if (def) return lang === 'en' ? def.labelEn : def.label;
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  return trimmed || (lang === 'en' ? 'Unclassified' : 'Belum terklasifikasi');
}

/** Label grup dokumen. */
export function docGroupLabel(group: DocGroup | string | null | undefined, lang: 'id' | 'en' = 'id'): string {
  const def = getDocGroupDefinition(group);
  if (def) return lang === 'en' ? def.labelEn : def.label;
  return lang === 'en' ? 'General' : 'Umum';
}

/** Daftar jenis dokumen, opsional difilter per grup. */
export function listDocTypes(group?: DocGroup | null): readonly DocTypeDefinition[] {
  return group ? DOC_TYPES.filter((def) => def.group === group) : DOC_TYPES;
}

/** Daftar grup dokumen. */
export function listDocGroups(): readonly DocGroupDefinition[] {
  return DOC_GROUPS;
}
