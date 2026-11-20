/**
 * Watchdog memori ingest — plafon RSS 1,2 GB (CORE_V2_ARCHITECTURE §2/§6).
 *
 * Dipanggil sebelum render/OCR tiap halaman. Bila RSS sudah melewati batas,
 * pemanggil wajib membatalkan ingest dan melepas buffer — jangan menunggu OOM.
 */

export const RSS_LIMIT_BYTES = 1_200 * 1024 * 1024;

export type RssSample = { rssBytes: number; limitBytes: number; exceeded: boolean };

export function sampleRss(): RssSample {
  const rssBytes = process.memoryUsage().rss;
  return { rssBytes, limitBytes: RSS_LIMIT_BYTES, exceeded: rssBytes > RSS_LIMIT_BYTES };
}

export class MemoryLimitError extends Error {
  readonly sample: RssSample;
  constructor(sample: RssSample) {
    super(`Watchdog RSS: ${(sample.rssBytes / 1024 / 1024).toFixed(0)} MB melebihi batas ${(sample.limitBytes / 1024 / 1024).toFixed(0)} MB`);
    this.name = 'MemoryLimitError';
    this.sample = sample;
  }
}

/** Lempar MemoryLimitError bila RSS > batas. Tidak ada retry, tidak ada tunggu. */
export function assertMemoryOk(): RssSample {
  const sample = sampleRss();
  if (sample.exceeded) throw new MemoryLimitError(sample);
  return sample;
}
