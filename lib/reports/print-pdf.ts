import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { redactForLog } from '@/lib/api/sanitize';

const execFileAsync = promisify(execFile);

const EXECUTABLE_CANDIDATES = [
  process.env.BROWSER_PDF_EXECUTABLE,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
    : undefined,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe')
    : undefined,
].filter((candidate): candidate is string => Boolean(candidate));

function resolveBrowserExecutable(): string {
  const executable = EXECUTABLE_CANDIDATES.find((candidate) => existsSync(candidate));
  if (!executable) {
    throw new Error(
      'Browser PDF tidak ditemukan. Set BROWSER_PDF_EXECUTABLE ke file Microsoft Edge atau Chrome, lalu coba lagi.',
    );
  }
  return executable;
}

/**
 * Render laporan ke PDF via Chromium headless.
 *
 * P6-FIX / SEC-003: `origin` berasal dari APP_ORIGIN (server), bukan header
 * klien. `--no-sandbox` tidak lagi aktif secara default; hanya bisa dinyalakan
 * eksplisit lewat PDF_BROWSER_NO_SANDBOX=1 untuk container VPS terpercaya.
 */
export async function renderReportPdf(origin: string, reportId: string): Promise<Uint8Array<ArrayBuffer>> {
  const executable = resolveBrowserExecutable();
  // Encode id untuk mencegah path injection pada URL navigasi.
  const url = `${origin}/reports/${encodeURIComponent(reportId)}?print=1`;
  const stem = `tanyadata-report-${randomUUID()}`;
  const output = join(tmpdir(), `${stem}.pdf`);
  const profile = join(tmpdir(), `${stem}-profile`);
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    `--user-data-dir=${profile}`,
    '--virtual-time-budget=8000',
    '--no-pdf-header-footer',
    `--print-to-pdf=${output}`,
  ];
  if (process.env.PDF_BROWSER_NO_SANDBOX === '1') {
    args.push('--no-sandbox');
  }
  args.push(url);

  let browserStderr = '';
  try {
    try {
      const { stderr } = await execFileAsync(executable, args, { timeout: 30000 });
      browserStderr = String(stderr ?? '');
    } catch (error) {
      const details = error instanceof Error
        ? `${error.message}\nstderr=${(error as { stderr?: string }).stderr ?? ''}`
        : String(error);
      console.error('[print-pdf] browser failed:', redactForLog(details));
      throw error;
    }
    if (!existsSync(output)) {
      throw new Error(`Browser tidak menghasilkan berkas PDF. ${redactForLog(browserStderr).slice(0, 300)}`);
    }
    const buffer = await readFile(output);
    const bytes = new Uint8Array(buffer.byteLength);
    bytes.set(buffer);
    return bytes;
  } finally {
    await rm(output, { force: true });
    await rm(profile, { recursive: true, force: true });
  }
}
