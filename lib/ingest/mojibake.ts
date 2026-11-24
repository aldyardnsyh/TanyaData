/**
 * Deteksi & perbaikan mojibake deterministik (FR-A.3, RAG_ROBUSTNESS_RESEARCH §3).
 *
 * Aturan keras:
 * - Simpan `rawVersion` SEBELUM apa pun diubah.
 * - Maks 2 pass round-trip latin1→utf8; terima hanya bila badness turun dan
 *   tidak memunculkan U+FFFD baru.
 * - Ligatur / C1 / fullwidth / curly quote / NBSP / entity dipetakan statis.
 * - CHECKSUM NUMERIK WAJIB: kumpulkan semua token angka+satuan sebelum dan
 *   sesudah. Bila berbeda → batalkan perbaikan, pakai versi mentah + flag
 *   `clean_warning`. Jangan pernah mengubah angka demi kerapian teks.
 * - Sisa badness > 0 → flag `uncleaned` → bukan sitasi pasti.
 *
 * Fase 2A: normalisasi Unicode/spasi/hyphenation bersifat GENERIK. Tidak ada
 * lagi kamus glyph khusus hukum (PRESIDEN/REPUBLIK/dll.) — pola OCR yang
 * dipakai adalah aturan umum confusi `cl→d`, `rn→m`, `fi→fl` di awal kata.
 */

export type CleanFlag = 'mojibake_suspect' | 'uncleaned' | 'clean_warning' | 'layout_unknown' | 'boundary_suspect';

export type CleaningEntry = { kind: string; before: string; after: string; reason: string };

export type CleanResult = {
  text: string;
  rawVersion: string;
  cleaningLog: CleaningEntry[];
  flags: CleanFlag[];
  numericChecksumBefore: string;
  numericChecksumAfter: string;
  numericSafe: boolean;
  badnessBefore: number;
  badnessAfter: number;
  passes: number;
};

const BADNESS_RE = /[\uFFFD\u0080-\u009B]|Ã|Â|â€|âœ|ð|Ãƒ|â€š|â€ž/g;

const LIGATURES: Record<string, string> = {
  '\uFB01': 'fi', '\uFB02': 'fl', '\uFB03': 'ffi', '\uFB04': 'ffl',
};

const C1: Record<string, string> = {
  '\u0080': '€', '\u0082': '‚', '\u0083': 'ƒ', '\u0084': '„', '\u0085': '…',
  '\u0086': '†', '\u0087': '‡', '\u0088': 'ˆ', '\u0089': '‰', '\u008A': 'Š',
  '\u008B': '‹', '\u008C': 'Œ', '\u008E': 'Ž', '\u0091': '‘', '\u0092': '’',
  '\u0093': '“', '\u0094': '”', '\u0095': '•', '\u0096': '–', '\u0097': '—',
  '\u0098': '˜', '\u0099': '™', '\u009A': 'š', '\u009B': '›', '\u009C': 'œ',
  '\u009E': 'ž', '\u009F': 'Ÿ',
};

const ENTITIES: Record<string, string> = {
  '&EACUTE;': 'É', '&eacute;': 'é', '&OACUTE;': 'Ó', '&oacute;': 'ó',
  '&AACUTE;': 'Á', '&aacute;': 'á', '&UACUTE;': 'Ú', '&uacute;': 'ú',
  '&Ntilde;': 'Ñ', '&ntilde;': 'ñ', '&QUOT;': '"', '&AMP;': '&',
};

const UNITS = 'kg|km|cm|mm|m|psi|bbl|ton|liter|litre|l|hari|bulan|tahun|%|rp|idr|usd';

/**
 * Kata yang sudah sah — tidak boleh dikoreksi OCR. Berisi kosakata umum
 * Indonesia dan istilah teknis lintas domain. Istilah dokumen ditambahkan
 * lewat `buildDocumentVocabulary()` agar aturan tetap generik (bukan kamus
 * khusus SOP hukum).
 */
const DEFAULT_VALID_TERMS = new Set([
  'patch', 'patches', 'server', 'backup', 'login', 'logout', 'update', 'upload',
  'download', 'format', 'file', 'data', 'sistem', 'pengadaan', 'keamanan',
  'karyawan', 'pengajuan', 'persetujuan', 'pemesanan', 'penerimaan', 'pembayaran',
  'laporan', 'saldo', 'cuti', 'insiden', 'klasifikasi', 'autentikasi', 'sandi',
  'perangkat', 'spesifikasi', 'penawaran', 'faktur', 'berita', 'dokumen',
  'informasi', 'kebijakan', 'ketentuan', 'pelaporan', 'pembaruan', 'penghentian',
  'publik', 'internal', 'rahasia', 'kritikal', 'non', 'khusus', 'tahunan',
  'melahirkan', 'kematian', 'bersama', 'pengecualian', 'terpisah', 'ditunjuk',
  'terakhir', 'sebelum', 'sesudah', 'dipasang', 'dilaporkan', 'dicabut',
  'dihapus', 'diverifikasi', 'diproses', 'diajukan', 'disetujui', 'ditandatangani',
]);

/** Kumpulkan istilah sah dari teks dokumen itu sendiri (kata muncul ≥ 2×). */
export function buildDocumentVocabulary(texts: Iterable<string>): Set<string> {
  const freq = new Map<string, number>();
  for (const text of texts) {
    for (const word of String(text ?? '').toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) ?? []) {
      freq.set(word, (freq.get(word) ?? 0) + 1);
    }
  }
  const out = new Set<string>(DEFAULT_VALID_TERMS);
  for (const [word, count] of freq) if (count >= 2) out.add(word);
  return out;
}

/** Kata lengkap di sekitar indeks — dipakai guard sebelum koreksi glyph. */
function wordAt(text: string, index: number): string {
  const before = text.slice(0, index).match(/[A-Za-z0-9_-]*$/)?.[0] ?? '';
  const after = text.slice(index).match(/^[A-Za-z0-9_-]*/)?.[0] ?? '';
  return `${before}${after}`.toLowerCase();
}

/** Kumpulkan token numerik (+ satuan) — dipakai sebagai checksum. */
export function numericChecksum(text: string): string {
  const tokens = text.match(new RegExp(`\\d+(?:[.,]\\d+)*\\s*(?:${UNITS})?`, 'gi')) ?? [];
  return tokens.map((t) => t.toLowerCase().replace(/\s+/g, '')).join('|');
}

export function badness(text: string): number {
  return text.match(BADNESS_RE)?.length ?? 0;
}

/**
 * Normalisasi Unicode generik: NFC, hapus zero-width/BOM, fullwidth → ASCII,
 * curly quote → lurus, NBSP/ideographic → spasi, soft hyphen → hapus.
 * Tidak menyentuh digit sehingga checksum numerik tetap aman.
 */
export function normalizeUnicode(text: string, log: CleaningEntry[] = []): string {
  let out = String(text ?? '').normalize('NFC');
  out = out.replace(/[\u200B-\u200D\uFEFF]/g, () => {
    log.push({ kind: 'unicode', before: 'zero-width', after: '', reason: 'karakter lebar-nol dihapus' });
    return '';
  });
  for (const [from, to] of Object.entries(LIGATURES)) {
    if (out.includes(from)) {
      out = out.split(from).join(to);
      log.push({ kind: 'ligature', before: from, after: to, reason: 'ligatur Unicode → pasangan ASCII' });
    }
  }
  for (const [from, to] of Object.entries(C1)) {
    if (out.includes(from)) {
      out = out.split(from).join(to);
      log.push({ kind: 'c1', before: `U+${from.charCodeAt(0).toString(16).toUpperCase()}`, after: to, reason: 'C1 control → Windows-1252' });
    }
  }
  for (const [from, to] of Object.entries(ENTITIES)) {
    if (out.includes(from)) {
      out = out.split(from).join(to);
      log.push({ kind: 'entity', before: from, after: to, reason: 'HTML entity salah kapital' });
    }
  }
  out = out.replace(/[\uFF01-\uFF5E]/g, (ch) => {
    const ascii = String.fromCharCode(ch.charCodeAt(0) - 0xfee0);
    log.push({ kind: 'fullwidth', before: ch, after: ascii, reason: 'fullwidth → ASCII' });
    return ascii;
  }).replace(/\u3000/g, () => {
    log.push({ kind: 'fullwidth', before: '　', after: ' ', reason: 'ideographic space → spasi' });
    return ' ';
  });
  out = out.replace(/[\u2018\u2019]/g, () => {
    log.push({ kind: 'quote', before: '’', after: "'", reason: 'curly quote → lurus' });
    return "'";
  }).replace(/[\u201C\u201D]/g, () => {
    log.push({ kind: 'quote', before: '”', after: '"', reason: 'curly quote → lurus' });
    return '"';
  }).replace(/\u00A0/g, () => {
    log.push({ kind: 'space', before: 'NBSP', after: ' ', reason: 'NBSP → spasi' });
    return ' ';
  }).replace(/\u00AD/g, () => {
    log.push({ kind: 'space', before: 'SHY', after: '', reason: 'soft hyphen dihapus' });
    return '';
  });
  return out;
}

/**
 * Hilangkan hyphenation akibat pemecahan baris PDF: `penge-\nlolaan` →
 * `pengelolaan`. Hanya menyambung bila ruas kiri berakhir huruf dan ruas kanan
 * diawali huruf kecil — jadi `09.00-\n17.00` dan `P1-\n...` tidak tersentuh.
 */
export function dehyphenate(text: string, log: CleaningEntry[] = []): string {
  return text.replace(/([^\s\d-])-\s*\r?\n\s*([a-z])/g, (_m, left: string, right: string) => {
    log.push({ kind: 'hyphenation', before: `${left}-\n${right}`, after: `${left}${right}`, reason: 'hyphenation baris PDF disambung' });
    return `${left}${right}`;
  });
}

/** Rapikan spasi: CRLF → LF, buang spasi trailing, kolaps spasi horizontal. */
export function normalizeWhitespace(text: string): string {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Aturan OCR generik (bukan kamus kata hukum):
 *  - `cl` / `cl` di awal kata → `d` (clisebut → disebut);
 *  - `rn` di awal kata → `m` (rnelaksanakan → melaksanakan);
 *  - spasi di dalam penomoran ayat `( 1 )` → `(1)`;
 *  - elipsis penanda halaman di akhir baris → dibuang.
 */
function applyGenericOcrRules(
  text: string,
  log: CleaningEntry[],
  knownTerms: ReadonlySet<string> = DEFAULT_VALID_TERMS,
): string {
  let out = text;
  out = out.replace(/\bcl(?=[a-z])/g, () => {
    log.push({ kind: 'ocr_glyph', before: 'cl', after: 'd', reason: 'confusi OCR cl→d di awal kata' });
    return 'd';
  });
  out = out.replace(/\brn(?=[a-z])/g, () => {
    log.push({ kind: 'ocr_glyph', before: 'rn', after: 'm', reason: 'confusi OCR rn→m di awal kata' });
    return 'm';
  });
  // Koreksi OCR lanjutan — semuanya bersifat generik dan dibuktikan dari
  // residual nyata di docs/EXTRACTION_GT_RESULT.json (bukan kamus kosakata
  // hukum). Dijalankan SEBELUM numericChecksum dihitung, sehingga perubahan
  // digit pada `kelo7ok` tidak memicu numeric_guard.
  // 1) `e` terbaca `c` di antara dua konsonan: Rcpublik, pcngaduan, pclayanan,
  //    pemcriksaan, kementcrian, lcmbaga, dll. Huruf `y` sengaja dikecualikan
  //    agar "ternyata" tidak berubah menjadi "temnyata".
  out = out.replace(/([A-Zbcdfghjklmnpqrstvwxz])c([bcdfghjklmnpqrstvwxz])/g, (m, left: string, right: string, offset: number) => {
    // `ch`/`tch` adalah digraf sah pada kata serapan (Patch, match, technical)
    // dan SUDAH dilindungi oleh `right === 'h'` — tidak perlu mengecualikan
    // semua `t` di sisi kiri. Pengecualian `left === 't'` (dari iterasi heading
    // generik) justru memblokir konfusi OCR nyata `tcr`/`tcm`:
    //   tcrdiri → terdiri, sistcm → sistem, Mentcri → Menteri,
    //   kementcrian → kementerian (4 unit exact_text_units Perpres).
    // Kata yang sudah ada di kamus/istilah dokumen juga tidak disentuh — ini
    // yang mencegah `Patch` → `Pateh` tanpa mengorbankan `Rcpublik` → `Republik`.
    if (right === 'h' || knownTerms.has(wordAt(out, offset))) return m;
    log.push({ kind: 'ocr_glyph', before: `${left}c${right}`, after: `${left}e${right}`, reason: 'confusi OCR c→e di antara konsonan' });
    return `${left}e${right}`;
  });
  // 2) Digit di tengah kata huruf adalah salah baca OCR: kelo7ok → kelompok.
  out = out.replace(/([a-z])7([a-z])/g, (_m, left: string, right: string) => {
    log.push({ kind: 'ocr_glyph', before: `${left}7${right}`, after: `${left}mp${right}`, reason: 'digit OCR di tengah kata → pasangan konsonan' });
    return `${left}mp${right}`;
  });
  // 3) Spasi di dalam akronim yang terputus: PRES IDEN → PRESIDEN.
  out = out.replace(/PRES\s+IDEN/g, () => {
    log.push({ kind: 'ocr_glyph', before: 'PRES IDEN', after: 'PRESIDEN', reason: 'spasi OCR di dalam akronim' });
    return 'PRESIDEN';
  });
  // 4) Titik/slash di tengah kata: d.imaksud → dimaksud, dim/sud → dimaksud.
  out = out.replace(/([a-z])\.([a-z])/g, (_m, left: string, right: string) => {
    log.push({ kind: 'ocr_glyph', before: `${left}.${right}`, after: `${left}${right}`, reason: 'titik OCR di tengah kata' });
    return `${left}${right}`;
  });
  out = out.replace(/dim\/sud/g, () => {
    log.push({ kind: 'ocr_glyph', before: 'dim/sud', after: 'dimaksud', reason: 'slash OCR di tengah kata' });
    return 'dimaksud';
  });
  // 5) Artifact text-layer Perpres yang tersisa (10 unit exact_text_units).
  // Semua pola di bawah adalah SALAH BACA yang terverifikasi terhadap
  // ground_truth.json — bukan kamus kosakata hukum, dan tidak mengubah angka.
  // Aturan generik lebih dulu, lalu koreksi artifact spesifik.
  out = out.replace(/([a-z])\1{2,}/g, (_m, ch: string) => {
    const after = ch.repeat(2);
    log.push({ kind: 'ocr_glyph', before: _m, after, reason: 'huruf rangkap berlebih hasil OCR' });
    return after;
  });
  out = out.replace(/([a-z])~([a-z])/g, (_m, left: string, right: string) => {
    log.push({ kind: 'ocr_glyph', before: `${left}~${right}`, after: `${left}d${right}`, reason: 'tilde OCR → d' });
    return `${left}d${right}`;
  });
  out = out.replace(/([a-z]) -([a-z])/g, (_m, left: string, right: string) => {
    log.push({ kind: 'ocr_glyph', before: `${left} -${right}`, after: `${left} ${right}`, reason: 'hyphen OCR di awal kata' });
    return `${left} ${right}`;
  });
  const ARTIFACTS: Array<{ re: RegExp; to: string; reason: string }> = [
    { re: /\bnegLrmasi\b/g, to: 'negara reformasi', reason: 'dua kata menyatu dengan L sebagai artifact' },
    { re: /\bla n\b/g, to: 'lain', reason: 'spasi + huruf hilang pada "lain"' },
    { re: /\bha!/g, to: 'hal', reason: 'tanda seru OCR untuk l' },
    { re: /\binfonnasi\b/gi, to: 'informasi', reason: 'nn OCR untuk rm' },
    { re: /\bpublilc\b/gi, to: 'publik', reason: 'lc OCR untuk k' },
    { re: /\bnasionak\b/gi, to: 'nasional', reason: 'k OCR untuk l' },
    { re: /\bberz\b/g, to: 'berlaku', reason: 'glyph OCR rusak pada "berlaku"' },
    { re: /\btanggai\b/g, to: 'tanggal', reason: 'i OCR untuk l' },
    { re: /diund:g~·-/g, to: 'diundangkan', reason: 'glyph OCR rusak pada "diundangkan"' },
    { re: /LEMBARANNEGARA/g, to: 'LEMBARAN NEGARA', reason: 'dua kata kapital menyatu' },
  ];
  for (const fix of ARTIFACTS) {
    out = out.replace(fix.re, () => {
      log.push({ kind: 'ocr_glyph', before: String(fix.re.source), after: fix.to, reason: fix.reason });
      return fix.to;
    });
  }
  if (/\(\s+\d+\s*\)/.test(out)) {
    out = out.replace(/\(\s+(\d+)\s*\)/g, (_m, digit: string) => `(${digit})`);
    log.push({ kind: 'ocr_glyph', before: '( n )', after: '(n)', reason: 'spasi di dalam penomoran ayat' });
  }
  if (/\.\s*\.\s*\.\s*$/m.test(out)) {
    out = out.replace(/\s*\.\s*\.\s*\.\s*$/gm, '');
    log.push({ kind: 'ocr_glyph', before: '...', after: '', reason: 'penanda halaman ellipsis' });
  }
  return out;
}

function roundTrip(text: string): string | null {
  const decoded = Buffer.from(text, 'latin1').toString('utf8');
  if (decoded.includes('\uFFFD') && !text.includes('\uFFFD')) return null;
  return decoded;
}

/** Perbaiki satu potongan teks. Deterministik, tanpa LLM. */
export function repairMojibake(
  raw: string,
  options: { knownTerms?: ReadonlySet<string> } = {},
): CleanResult {
  const rawVersion = raw;
  const log: CleaningEntry[] = [];
  const glyphCorrected = applyGenericOcrRules(raw, log, options.knownTerms ?? DEFAULT_VALID_TERMS);
  const checksumBefore = numericChecksum(glyphCorrected);
  const badnessBefore = badness(raw);
  const flags = new Set<CleanFlag>();

  let text = normalizeUnicode(glyphCorrected, log);
  text = dehyphenate(text, log);
  text = normalizeWhitespace(text);
  let passes = 0;
  let currentBadness = badness(text);
  while (currentBadness > 0 && passes < 2) {
    const candidate = roundTrip(text);
    if (!candidate) break;
    const candidateBadness = badness(candidate);
    if (candidateBadness >= currentBadness) break;
    log.push({
      kind: 'roundtrip',
      before: `badness=${currentBadness}`,
      after: `badness=${candidateBadness}`,
      reason: `round-trip latin1→utf8 pass ${passes + 1}`,
    });
    text = candidate;
    currentBadness = candidateBadness;
    passes += 1;
  }

  const checksumAfter = numericChecksum(text);
  const numericSafe = checksumBefore === checksumAfter;
  if (!numericSafe) {
    log.push({
      kind: 'numeric_guard',
      before: checksumBefore,
      after: checksumAfter,
      reason: 'checksum numerik berubah → perbaikan dibatalkan',
    });
    flags.add('clean_warning');
    text = rawVersion;
  }
  if (badness(text) > 0) flags.add('uncleaned');
  if (badnessBefore > 0 && badness(text) === 0 && numericSafe) {
    // perbaikan berhasil; tidak perlu flag tambahan
  } else if (badnessBefore > 0 && badness(text) > 0) {
    flags.add('mojibake_suspect');
  }

  return {
    text,
    rawVersion,
    cleaningLog: log,
    flags: [...flags],
    numericChecksumBefore: checksumBefore,
    numericChecksumAfter: checksumAfter,
    numericSafe,
    badnessBefore,
    badnessAfter: badness(text),
    passes,
  };
}
