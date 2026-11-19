/**
 * TanyaData AI — adapter LLM opsional (lib/ai/llm.ts).
 *
 * Baca env: LLM_MODE, LLM_BASE_URL, LLM_API_KEY, LLM_MODEL, LLM_TIMEOUT_MS,
 * LLM_MAX_OUTPUT_TOKENS. Endpoint OpenAI-compatible chat completions via fetch.
 * Tidak ada nama model/provider di kode/UI/docs; kunci hanya dari process.env.
 *
 * Aturan grounding: LLM HANYA boleh merapikan narasi. Setiap token numerik di
 * output LLM harus cocok dengan himpunan angka evidence (hasil SQL/dokumen).
 * Bila ada angka asing, output tidak valid, timeout, atau HTTP error →
 * fallback deterministik + meta.fallbackReason.
 */
import { z } from 'zod';
import type { Lang } from '@/lib/contracts/http';
import type { DraftResult } from '@/lib/ai/compose';

export type LlmMode = 'off' | 'assist' | 'full';
export type LlmFallbackReason = 'llm_timeout' | 'llm_error' | 'llm_invalid';

export type LlmRefineOutcome = {
  draft: DraftResult | null;
  reason?: LlmFallbackReason;
};

export function llmMode(): LlmMode {
  const v = process.env.LLM_MODE;
  if (v === 'assist' || v === 'full') return v;
  return 'off';
}

export function llmAvailable(): boolean {
  const mode = llmMode();
  return mode !== 'off' && Boolean(process.env.LLM_BASE_URL) && Boolean(process.env.LLM_MODEL);
}

export function llmTimeout(): number {
  const v = Number(process.env.LLM_TIMEOUT_MS);
  return Number.isFinite(v) && v > 0 ? v : 12000;
}

export function llmMaxTokens(): number {
  const v = Number(process.env.LLM_MAX_OUTPUT_TOKENS);
  return Number.isFinite(v) && v > 0 ? v : 900;
}

/* ---------------------------------------------------- grounding angka */

const NUMBER_TOKEN_RE = /\d+(?:[.,]\d+)*/g;

function numberTokens(text: string): string[] {
  return text.match(NUMBER_TOKEN_RE) ?? [];
}

/** Interpretasi ganda (locale id: "8.125"=8125, "92,76"=92.76; en kebalikan). */
function interpretations(token: string): number[] {
  const out = new Set<number>();
  // id-style: titik = pemisah ribuan bila pola 1-3 digit + kelompok 3 digit
  if (/^\d{1,3}(\.\d{3})+$/.test(token)) {
    out.add(Number(token.replace(/\./g, '')));
  } else {
    const idDecimal = Number(token.replace(',', '.'));
    if (Number.isFinite(idDecimal)) out.add(idDecimal);
  }
  // en-style: koma = pemisah ribuan
  if (/^\d{1,3}(,\d{3})+$/.test(token)) {
    out.add(Number(token.replace(/,/g, '')));
  } else {
    const enDecimal = Number(token);
    if (Number.isFinite(enDecimal)) out.add(enDecimal);
  }
  return [...out];
}

function collectTextNumbers(text: string, into: Set<number>): void {
  for (const token of numberTokens(text)) {
    for (const n of interpretations(token)) into.add(n);
  }
}

/**
 * Himpunan angka yang boleh muncul di narasi LLM: nilai mentah dari tabel &
 * visual (hasil query), plus angka yang sudah tertulis di draft deterministik
 * (termasuk tanggal/tahun yang disebut).
 */
export function buildAllowNums(draft: DraftResult, sqlRows: unknown[][] = []): number[] {
  const nums = new Set<number>();
  const addRaw = (v: unknown) => {
    if (typeof v === 'number' && Number.isFinite(v)) nums.add(v);
  };
  for (const row of sqlRows) for (const cell of row) addRaw(cell);
  if (draft.supportingTable) {
    for (const row of draft.supportingTable.rows) for (const v of Object.values(row)) addRaw(v);
  }
  for (const viz of draft.visualizations) {
    for (const row of viz.rows) for (const v of Object.values(row)) addRaw(v);
  }
  collectTextNumbers(draft.answer, nums);
  for (const k of draft.keyFindings) collectTextNumbers(k.text, nums);
  for (const f of draft.followUps) collectTextNumbers(f, nums);
  return [...nums];
}

function numbersGrounded(text: string, allowed: number[]): boolean {
  for (const token of numberTokens(text)) {
    const candidates = interpretations(token);
    const ok = candidates.some((c) => allowed.some((a) => Math.abs(a - c) < 0.011));
    if (!ok) return false;
  }
  return true;
}

/* ---------------------------------------------------- adapter HTTP */

const ChatCompletionSchema = z.object({
  choices: z
    .array(z.object({ message: z.object({ content: z.string() }) }))
    .min(1),
});

const MAX_ANSWER_WORDS = 120;

/**
 * Refine narasi saja. keyFindings/followUps/supportingTable/sql/sources tetap
 * dari jalur deterministik agar angka & sitasi tidak pernah diubah LLM.
 */
export async function llmRefine(
  mode: LlmMode,
  draft: DraftResult,
  lang: Lang,
  allowedNumbers: number[],
): Promise<LlmRefineOutcome> {
  if (mode === 'off') return { draft: null };
  if (allowedNumbers.length === 0) return { draft: null };

  const baseUrl = process.env.LLM_BASE_URL;
  const model = process.env.LLM_MODEL;
  const apiKey = process.env.LLM_API_KEY;
  if (!baseUrl || !model) return { draft: null, reason: 'llm_error' };

  const system = [
    lang === 'id'
      ? 'Anda merapikan jawaban analitik transaksi menjadi Bahasa Indonesia formal yang lancar dan ringkas (maksimal 3 kalimat).'
      : 'You polish a transaction-analytics answer into fluent, concise formal English (at most 3 sentences).',
    lang === 'id'
      ? 'ATURAN MUTLAK: pertahankan SEMUA angka persis seperti aslinya; jangan menambah, mengubah, membulatkan ulang, atau menghilangkan angka apa pun; jangan menambah fakta, sebab, atau klaim baru.'
      : 'ABSOLUTE RULES: keep EVERY number exactly as given; do not add, change, re-round, or drop any number; do not add new facts, causes, or claims.',
    lang === 'id'
      ? 'Bedakan indikasi (korelasi data) dari sebab terbukti (pernyataan dokumen). Jangan menyebut nama model atau penyedia.'
      : 'Distinguish indication (data correlation) from proven cause (document statement). Never mention model or provider names.',
    lang === 'id'
      ? `Himpunan angka yang diizinkan: ${allowedNumbers.join(', ')}.`
      : `Allowed number set: ${allowedNumbers.join(', ')}.`,
  ].join('\n');

  const user = [
    `${lang === 'id' ? 'Pertanyaan pengguna' : 'User question'}: ${draft.answer ? '' : ''}`,
    `${lang === 'id' ? 'Jawaban deterministik yang harus dirapikan' : 'Deterministic answer to polish'}:`,
    draft.answer,
    '',
    `${lang === 'id' ? 'Temuan utama (konteks, jangan diubah angkanya)' : 'Key findings (context, do not change numbers)'}:`,
    ...draft.keyFindings.map((k) => `- ${k.text}`),
  ].join('\n');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), llmTimeout());
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      signal: controller.signal,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0,
        max_tokens: llmMaxTokens(),
      }),
    });
    if (!response.ok) return { draft: null, reason: 'llm_error' };

    const raw: unknown = await response.json();
    const parsed = ChatCompletionSchema.safeParse(raw);
    if (!parsed.success) return { draft: null, reason: 'llm_invalid' };

    const text = parsed.data.choices[0].message.content.trim();
    if (!text) return { draft: null, reason: 'llm_invalid' };
    if (text.split(/\s+/).length > MAX_ANSWER_WORDS) return { draft: null, reason: 'llm_invalid' };
    if (!numbersGrounded(text, allowedNumbers)) return { draft: null, reason: 'llm_invalid' };

    return {
      draft: {
        ...draft,
        answer: text,
        keyFindings: draft.keyFindings.slice(0, 4),
        followUps: draft.followUps.slice(0, 4),
      },
    };
  } catch (error) {
    const aborted = error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
    return { draft: null, reason: aborted ? 'llm_timeout' : 'llm_error' };
  } finally {
    clearTimeout(timer);
  }
}
