import { AppError, unprocessable } from '@/lib/errors';

export type SourceKind = 'dataset' | 'document';

const DATASET_EXT = new Set(['csv', 'xlsx']);
const DOC_EXT = new Set(['pdf', 'docx', 'txt', 'md']);

const MIME_BY_EXT: Record<string, string[]> = {
  csv: ['text/csv', 'application/csv', 'application/vnd.ms-excel', 'text/plain', 'application/octet-stream'],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/zip', 'application/octet-stream'],
  pdf: ['application/pdf', 'application/octet-stream'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/zip', 'application/octet-stream'],
  txt: ['text/plain', 'application/octet-stream'],
  md: ['text/markdown', 'text/plain', 'application/octet-stream'],
};

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export function fileExtension(filename: string): string {
  const clean = filename.toLowerCase().replace(/\\/g, '/');
  if (clean.includes('/') || clean.includes('..')) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Nama file tidak valid');
  }
  const at = clean.lastIndexOf('.');
  return at >= 0 ? clean.slice(at + 1) : '';
}

export function detectFormat(kind: SourceKind, filename: string, mime: string, buffer: Buffer): string {
  const ext = fileExtension(filename);
  const allowed = kind === 'dataset' ? DATASET_EXT : DOC_EXT;
  if (!ext || !allowed.has(ext)) {
    throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', `Format .${ext || '?'} tidak didukung untuk ${kind}`, {
      allowed: [...allowed],
    });
  }
  const type = (mime || '').split(';')[0].trim().toLowerCase();
  if (type && !MIME_BY_EXT[ext].includes(type)) {
    throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', `MIME ${type} tidak cocok dengan .${ext}`);
  }
  if (ext === 'pdf' && buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw unprocessable('File PDF tidak valid (magic bytes tidak cocok)');
  }
  if ((ext === 'xlsx' || ext === 'docx') && buffer.subarray(0, 4).toString('latin1') !== 'PK\u0003\u0004') {
    throw unprocessable(`File .${ext} rusak atau bukan arsip ZIP`);
  }
  return ext;
}

export function sanitizeFilename(name: string): string {
  const base = name.replace(/\\/g, '/').split('/').pop() ?? 'upload';
  return base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'upload';
}

/* ------------------------------------------------------------- canonical */

export const CANONICAL_COLUMNS = [
  'transaction_id',
  'created_at',
  'transaction_date',
  'merchant_id',
  'channel_id',
  'channel_name',
  'category',
  'amount',
  'fee',
  'status',
  'failure_code',
  'processing_time_ms',
  'device_type',
  'customer_region',
] as const;

export type CanonicalColumn = (typeof CANONICAL_COLUMNS)[number];

const ALIASES: Record<CanonicalColumn, string[]> = {
  transaction_id: ['transaction_id', 'transactionid', 'trx_id', 'id_transaksi', 'order_id'],
  created_at: ['created_at', 'created', 'timestamp', 'waktu_transaksi', 'datetime'],
  transaction_date: ['transaction_date', 'date', 'tanggal', 'transaction_date_'],
  merchant_id: ['merchant_id', 'merchantid', 'merchant'],
  channel_id: ['channel_id', 'channelid'],
  channel_name: ['channel_name', 'channel', 'kanal'],
  category: ['category', 'kategori'],
  amount: ['amount', 'nominal', 'nilai', 'total_amount', 'gross_amount'],
  fee: ['fee', 'biaya'],
  status: ['status', 'transaction_status', 'state'],
  failure_code: ['failure_code', 'failurecode', 'kode_kegagalan', 'error_code'],
  processing_time_ms: ['processing_time_ms', 'processing_time', 'duration_ms', 'latency_ms'],
  device_type: ['device_type', 'device'],
  customer_region: ['customer_region', 'region', 'wilayah'],
};

function normHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export type ColumnMapping = Partial<Record<CanonicalColumn, string>>;

export function mapColumns(headers: string[]): { mapping: ColumnMapping; missing: string[]; unknown: string[] } {
  const normalized = headers.map((h) => ({ raw: h, key: normHeader(h) }));
  const used = new Set<string>();
  const mapping: ColumnMapping = {};

  for (const column of CANONICAL_COLUMNS) {
    for (const alias of ALIASES[column]) {
      const found = normalized.find((h) => h.key === alias && !used.has(h.raw));
      if (found) {
        mapping[column] = found.raw;
        used.add(found.raw);
        break;
      }
    }
  }

  // transaction_date dapat diturunkan dari created_at.
  if (!mapping.transaction_date && mapping.created_at) {
    mapping.transaction_date = mapping.created_at;
  }

  const missing: string[] = [];
  if (!mapping.transaction_date) missing.push('transaction_date');
  if (!mapping.status) missing.push('status');

  const unknown = unknownHeaders(headers, used);
  return { mapping, missing, unknown };
}

export function unknownHeaders(headers: string[], used: Set<string>): string[] {
  return headers.filter((h) => !used.has(h) && h.trim().length > 0);
}

export function normalizeDate(value: string): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/.exec(raw);
  if (dmy) {
    const day = dmy[1].padStart(2, '0');
    const month = dmy[2].padStart(2, '0');
    return `${dmy[3]}-${month}-${day}`;
  }
  const d = new Date(raw);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

export function normalizeStatus(value: string): string {
  const status = (value ?? '').trim().toUpperCase();
  return ['SUCCESS', 'FAILED', 'PENDING', 'EXPIRED', 'REFUNDED'].includes(status) ? status : 'PENDING';
}

export function normalizeAmount(value: string): number | null {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  let text = raw.replace(/[^0-9.,-]/g, '');
  if (text.includes(',') && text.includes('.')) {
    text = text.lastIndexOf(',') > text.lastIndexOf('.')
      ? text.replace(/\./g, '').replace(',', '.')
      : text.replace(/,/g, '');
  } else if (text.includes(',')) {
    text = text.replace(',', '.');
  }
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}
