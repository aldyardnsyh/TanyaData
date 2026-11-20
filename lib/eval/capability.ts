/**
 * CORE V2 capability eval — 11 eval_case from docs/CORE_V2_SPEC.md §10.
 *
 * This is deliberately SEPARATE from the legacy 12-case harness: the legacy
 * eight stage metrics stay computed from the legacy cases only, so adding new
 * cases cannot silently move the 8/8 baseline. Capability cases exercise the
 * AI-lane deterministic functions directly with inline inputs — no network,
 * no model, no local model weights, no extra memory.
 *
 * FR-A and FR-E cases validate the AI-lane CONTRACT surface (evidence
 * planning, unreadable-page notice, citation validity inside a share
 * snapshot). Full OCR/share behaviour remains backend/frontend lane and is
 * verified manually in P5 — this report does not claim otherwise.
 */
import fs from 'node:fs';

import { detectReadjustment, type ReadjustmentOp } from '../ai/readjustment';
import {
  buildCitationDeepLink, validateCitationDeepLink, planOcrPages,
  numericChecksum, stitchPageTexts, contentHash,
  type CitationRegistry,
} from '../ai/retrieval';
import { validateShareCitations } from '../ai/output';
import { checkAttachmentScope, unreadablePageNotice } from '../ai/guardrails';

type Json = Record<string, any>;

export type CapabilityCaseResult = {
  id: string;
  fr: string;
  capability: string;
  question: string;
  pass: boolean;
  detail: string;
  observed: Json;
};

export type CapabilityReport = {
  generatedAt: string;
  cases: CapabilityCaseResult[];
  passed: number;
  total: number;
  byFr: Record<string, { cases: number; passed: number }>;
  /** Task gate: at least 8 of the 11 new cases must pass. */
  overallPass: boolean;
  notes: string[];
};

type Grade = { pass: boolean; detail: string; observed: Json };

function projectOps(ops: ReadjustmentOp[]): Json[] {
  return ops.map((o) => ({
    op_type: o.op_type,
    resolved_filters: o.resolved_filters ?? null,
    resolved_columns: o.resolved_columns ?? null,
    categories: o.categories ?? null,
    needs_clarification: o.needs_clarification === true,
    source: o.source ?? null,
  }));
}

function gradeReadjustment(testCase: Json): Grade {
  const input = testCase.input ?? {};
  const expected = testCase.expected ?? {};
  const registry = input.registry ?? { columns: [], sectionPaths: [], docIds: [] };
  const plan = detectReadjustment(input.question ?? '', registry);
  const observed: Json = {
    ops: projectOps(plan.ops),
    needs_clarification: plan.needs_clarification,
  };
  let pass = JSON.stringify(observed.ops) === JSON.stringify(expected.ops ?? [])
    && observed.needs_clarification === (expected.needs_clarification ?? false);
  let detail = `ops=${JSON.stringify(observed.ops)} clarification=${observed.needs_clarification}`;

  // AC-B.1.4: an unknown column must be refused with the valid list, never
  // invented. Encoded as a second question inside the same eval_case.
  if (input.question_invalid) {
    const bad = detectReadjustment(input.question_invalid, registry);
    observed.invalid_ops = projectOps(bad.ops);
    const okBad = JSON.stringify(observed.invalid_ops) === JSON.stringify(expected.invalid_ops ?? []);
    pass = pass && okBad;
    detail += ` | invalid=${JSON.stringify(observed.invalid_ops)}`;
  }
  return { pass, detail, observed };
}

function gradeCitation(testCase: Json): Grade {
  const input = testCase.input ?? {};
  const expected = testCase.expected ?? {};
  const registry: CitationRegistry = input.registry ?? { documents: {}, chunks: {} };
  const items: Json[] = input.cases ?? [];
  const results = items.map((it) => {
    const link = buildCitationDeepLink(it.parts ?? {});
    const verdict = link
      ? validateCitationDeepLink(link, registry, it.quote ?? null)
      : { valid: false, reason: 'MISSING_CHUNK' };
    return { valid: verdict.valid, reason: verdict.reason, link };
  });
  const exp: Json[] = expected.results ?? [];
  const pass = results.length === exp.length && results.every((r, i) =>
    r.valid === exp[i].valid && (!exp[i].reason || r.reason === exp[i].reason));
  return {
    pass,
    detail: results.map((r) => `${r.valid ? 'valid' : `rejected:${r.reason}`}`).join(' | '),
    observed: { results },
  };
}

function gradeScope(testCase: Json): Grade {
  const input = testCase.input ?? {};
  const expected = testCase.expected ?? {};
  const r = checkAttachmentScope({
    question: input.question ?? '',
    active: input.active ?? null,
    attachments: input.attachments ?? [],
    evidence: input.evidence ?? [],
  });
  const observed: Json = { allowed: r.allowed, type: r.type, violations: r.violations, message: r.message };
  const pass = r.allowed === expected.allowed
    && (!expected.type || r.type === expected.type)
    && (!expected.violations || JSON.stringify(r.violations) === JSON.stringify(expected.violations));
  return { pass, detail: `allowed=${r.allowed} type=${r.type ?? 'none'} violations=${JSON.stringify(r.violations)}`, observed };
}

function gradeIngest(testCase: Json): Grade {
  const input = testCase.input ?? {};
  const expected = testCase.expected ?? {};
  const mode = input.mode;

  if (mode === 'ocr_plan') {
    const plan = planOcrPages(input.pages ?? []);
    const observed: Json = { ...plan };
    let pass = JSON.stringify(plan.ocr_pages) === JSON.stringify(expected.ocr_pages ?? [])
      && JSON.stringify(plan.unreadable_pages) === JSON.stringify(expected.unreadable_pages ?? [])
      && plan.ocrUsed === (expected.ocrUsed ?? false);
    let detail = `ocr_pages=${JSON.stringify(plan.ocr_pages)} unreadable=${JSON.stringify(plan.unreadable_pages)} ocrUsed=${plan.ocrUsed}`;

    if (expected.notice_contains) {
      const notice = unreadablePageNotice(expected.notice_page ?? 1, 'id');
      observed.notice = notice;
      const ok = notice.includes(expected.notice_contains);
      pass = pass && ok;
      detail += ` | notice_ok=${ok}`;
    }
    if (expected.numeric_preserved !== undefined) {
      const ok = numericChecksum(input.numbers_before ?? []) === numericChecksum(input.numbers_after ?? []);
      observed.numeric_ok = ok;
      pass = pass && ok;
      detail += ` | numeric_ok=${ok}`;
    }
    return { pass, detail, observed };
  }

  if (mode === 'stitch') {
    const chunks = stitchPageTexts(input.pages ?? []);
    const hashes = chunks.map((c) => contentHash(c.text));
    const unique = new Set(hashes).size === hashes.length;
    const spans = chunks.map((c) => c.page_span);
    const observed: Json = {
      chunks: chunks.length, unique, spans, stitched: chunks.filter((c) => c.stitched).length,
    };
    const pass = chunks.length === (expected.chunk_count ?? 0) && unique
      && JSON.stringify(spans) === JSON.stringify(expected.page_spans ?? []);
    return { pass, detail: `chunks=${chunks.length} unique=${unique} spans=${JSON.stringify(spans)}`, observed };
  }

  return { pass: false, detail: `unknown ingest mode: ${String(mode)}`, observed: {} };
}

function gradeShare(testCase: Json): Grade {
  const input = testCase.input ?? {};
  const expected = testCase.expected ?? {};
  const registry: CitationRegistry = input.registry ?? { documents: {}, chunks: {} };
  const scenarios: Json[] = input.scenarios ?? [];
  const exp: Json[] = expected.results ?? [];

  const results = scenarios.map((s) => {
    const r = validateShareCitations(s.citations ?? [], registry);
    const snap = s.snapshot ?? {};
    return {
      citations_valid: r.valid,
      rejected: r.rejected.length,
      link_created: snap.link_created === true,
      self_contained: snap.self_contained === true,
      requires_login: snap.requires_login === true,
      id: snap.id ?? null,
    };
  });

  const pass = results.length === exp.length && results.every((r, i) => {
    const e = exp[i];
    return r.citations_valid === e.citations_valid
      && (e.rejected === undefined || r.rejected === e.rejected)
      && (e.link_created === undefined || r.link_created === e.link_created)
      && (e.self_contained === undefined || r.self_contained === e.self_contained)
      && (e.requires_login === undefined || r.requires_login === e.requires_login)
      && (!e.id_pattern || (typeof r.id === 'string' && new RegExp(e.id_pattern).test(r.id)));
  });

  return {
    pass,
    detail: results.map((r, i) => `scenario${i + 1}:citations=${r.citations_valid},link=${r.link_created},self=${r.self_contained}`).join(' | '),
    observed: { results },
  };
}

const GRADERS: Record<string, (c: Json) => Grade> = {
  readjustment: gradeReadjustment,
  citation: gradeCitation,
  scope: gradeScope,
  ingest: gradeIngest,
  share: gradeShare,
};

export function runCapabilityEval(casesFile: string): CapabilityReport {
  const data = JSON.parse(fs.readFileSync(casesFile, 'utf8')) as Json;
  const selected: Json[] = (data.cases ?? []).filter((c: Json) => Boolean(c.capability) && !c.suite);
  const cases: CapabilityCaseResult[] = selected.map((c) => {
    const grader = GRADERS[String(c.capability)];
    const grade = grader
      ? grader(c)
      : { pass: false, detail: `unknown capability: ${String(c.capability)}`, observed: {} };
    return {
      id: String(c.id),
      fr: String(c.fr ?? ''),
      capability: String(c.capability ?? ''),
      question: String(c.question ?? ''),
      pass: grade.pass,
      detail: grade.detail,
      observed: grade.observed,
    };
  });

  const byFr: Record<string, { cases: number; passed: number }> = {};
  for (const c of cases) {
    const bucket = byFr[c.fr] ?? { cases: 0, passed: 0 };
    bucket.cases += 1;
    bucket.passed += c.pass ? 1 : 0;
    byFr[c.fr] = bucket;
  }
  const passed = cases.filter((c) => c.pass).length;

  return {
    generatedAt: new Date().toISOString(),
    cases,
    passed,
    total: cases.length,
    byFr,
    overallPass: cases.length === 11 && passed >= 8,
    notes: [
      '11 eval_case baru dari docs/CORE_V2_SPEC.md §10 (EV-A01…EV-E02).',
      'FR-A/FR-E dinilai pada permukaan kontrak AI-lane; OCR penuh & share UI tetap lane backend/frontend (P5 manual).',
      'Tidak ada model lokal, tidak ada jaringan, tidak ada retry; deterministik dan bisa diulang.',
    ],
  };
}
