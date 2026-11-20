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

/** Kumpulkan token numerik (+ satuan) — dipakai sebagai checksum. */
export function numericChecksum(text: string): string {
  const tokens = text.match(new RegExp(`\\d+(?:[.,]\\d+)*\\s*(?:${UNITS})?`, 'gi')) ?? [];
  return tokens.map((t) => t.toLowerCase().replace(/\s+/g, '')).join('|');
}

export function badness(text: string): number {
  return text.match(BADNESS_RE)?.length ?? 0;
}

function mapStatic(text: string, log: CleaningEntry[]): string {
  let out = text;
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
  // Fullwidth ASCII range + ideographic space.
  out = out.replace(/[\uFF01-\uFF5E]/g, (ch) => {
    const ascii = String.fromCharCode(ch.charCodeAt(0) - 0xfee0);
    log.push({ kind: 'fullwidth', before: ch, after: ascii, reason: 'fullwidth → ASCII' });
    return ascii;
  }).replace(/\u3000/g, () => {
    log.push({ kind: 'fullwidth', before: '　', after: ' ', reason: 'ideographic space → spasi' });
    return ' ';
  });
  // Curly quote → lurus; NBSP → spasi; soft hyphen → hapus.
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

function roundTrip(text: string): string | null {
  const decoded = Buffer.from(text, 'latin1').toString('utf8');
  if (decoded.includes('\uFFFD') && !text.includes('\uFFFD')) return null;
  return decoded;
}

/** Perbaiki satu potongan teks. Deterministik, tanpa LLM. */
export function repairMojibake(raw: string): CleanResult {
  const rawVersion = raw;
  const checksumBefore = numericChecksum(raw);
  const badnessBefore = badness(raw);
  const log: CleaningEntry[] = [];
  const flags = new Set<CleanFlag>();

  let text = mapStatic(raw, log);
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
