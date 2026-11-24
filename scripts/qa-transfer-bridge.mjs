#!/usr/bin/env node
/**
 * QA ONLY — bridge for the 66 transfer QA against the SEPARATE, PDF-indexed
 * workspace produced by qa-transfer-ingest.mjs. No core source is edited.
 *
 * Run (via safe_exec.py, timeout 600):
 *   node tanyadata/scripts/qa-transfer-bridge.mjs --out <raw.json>
 *
 * The raw artifact has the SAME shape as eval/bridge.mjs output so that
 * eval/run_eval.py + eval/run_stage_checks.py compute identical metrics.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(root, '..');
function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1] : fallback;
}
const ws = path.resolve(process.env.QA_TRANSFER_WS
  || path.join(os.tmpdir(), 'opencode', 'tanyadata-transfer-ws'));
const DATA_DIR = path.join(ws, 'data');
const outFile = path.resolve(repoRoot, arg('--out', 'tanyadata/eval/results/_transfer_indexed_raw.json'));
const timeoutMs = Number(arg('--timeout', '540000'));

process.env.DATA_DIR = DATA_DIR;
process.env.WORKSPACE_DIR = ws;
process.env.LLM_MODE = 'off';
process.env.RETRIEVAL_MODE = 'fts5';
process.env.QDRANT_MODE = 'off';
process.env.EMBEDDING_PROVIDER = 'off';
delete process.env.LLM_API_KEY;
delete process.env.LLM_BASE_URL;

/* runtime-only syntax shim — identical to eval/bridge.mjs, NO source edit */
const ingestSourcePath = path.join(root, 'lib/core/ingest.ts');
const ingestPatchedPath = path.join(ws, 'ingest.runtime-patch.ts');
if (fs.existsSync(ingestPatchedPath)) {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.startsWith('@/')) {
        const abs = path.join(root, specifier.slice(2)) + '.ts';
        if (path.resolve(abs) === ingestSourcePath) {
          return nextResolve(pathToFileURL(ingestPatchedPath).href, context);
        }
        return nextResolve(pathToFileURL(abs).href, context);
      }
      if (specifier.startsWith('.') && !/\.[a-z0-9]+$/i.test(specifier)) {
        try { return nextResolve(specifier + '.ts', context); } catch { /* fall through */ }
      }
      return nextResolve(specifier, context);
    },
  });
} else {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.startsWith('@/')) {
        return nextResolve(pathToFileURL(path.join(root, specifier.slice(2)) + '.ts').href, context);
      }
      if (specifier.startsWith('.') && !/\.[a-z0-9]+$/i.test(specifier)) {
        try { return nextResolve(specifier + '.ts', context); } catch { /* fall through */ }
      }
      return nextResolve(specifier, context);
    },
  });
}

const Database = (await import(pathToFileURL(path.join(root, 'node_modules/better-sqlite3/lib/index.js')).href)).default;
const { WORKSPACE_DB } = await import(pathToFileURL(path.join(root, 'lib/db/paths.ts')).href);
const { answerQuestion } = await import(pathToFileURL(path.join(root, 'lib/core/query.ts')).href);
const { createCorePorts, buildAiPortContext } = await import(pathToFileURL(path.join(root, 'lib/ai/adapter.ts')).href);
const { searchChunks } = await import(pathToFileURL(path.join(root, 'lib/core/store.ts')).href);
const { retrieveWithEntityBoost } = await import(pathToFileURL(path.join(root, 'lib/ai/retrieval.ts')).href);
const { correctQueryWithVocabulary } = await import(pathToFileURL(path.join(root, 'lib/core/query-rewrite.ts')).href);
const { getDocumentProxy } = await import(pathToFileURL(path.join(root, 'node_modules/unpdf/dist/index.mjs')).href);
const { layoutAwarePdfTexts } = await import(pathToFileURL(path.join(root, 'lib/ingest/extract.ts')).href);

const timer = setTimeout(() => {
  console.error(`QA_TRANSFER_BRIDGE_TIMEOUT after ${timeoutMs}ms`);
  process.exit(1);
}, timeoutMs);

function norm(s) {
  return String(s ?? '')
    .toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** GT sections derived from the PDF TEXT LAYER only (never from *_qa.json). */
function sectionsFromPdfLines(lines, key) {
  const out = [];
  let current = null;
  const push = () => { if (current) { current.text = current.lines.join('\n'); delete current.lines; out.push(current); } };
  for (const raw of lines) {
    const line = String(raw).trim();
    if (!line) continue;
    let m = null;
    if (key === 'CUTI') m = line.match(/^(CUTI#(\d+))\s+([^:]+):\s*(.*)$/);
    else if (key === 'TI') m = line.match(/^(TI#(\d+))\s+([^|]+)\|\s*(.*)$/);
    else m = line.match(/^(\d+(?:\.\d+)*)\.\s+([^:]+):\s*(.*)$/);
    if (m) {
      push();
      if (key === 'PD') {
        const ordinal = out.length + 1;
        current = { section_id: `PD#${ordinal}`, number: ordinal, printed_number: m[1], title: m[2].trim(), lines: [line] };
      } else {
        current = { section_id: m[1], number: Number(m[2]), title: m[3].trim(), lines: [line] };
      }
    } else if (current) {
      // Skip repeated header/footer; they are not section content.
      if (/^PENGADAAN BARANG - DOKUMEN INTERNAL$/i.test(line) || /^Halaman \d+ dari \d+$/i.test(line)) continue;
      current.lines.push(line);
    }
  }
  push();
  return out;
}

try {
  const manifestPath = path.join(ws, 'qa-transfer-ingest-manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error(`Manifest tidak ada: ${manifestPath} — jalankan qa-transfer-ingest.mjs dulu`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const docs = manifest.documents;
  if (docs.some((d) => d.ingestMode !== 'pdf')) throw new Error('Ada dokumen yang tidak ter-ingest dari PDF — hentikan pengukuran');

  const transferDir = path.join(repoRoot, 'tanyadata', 'eval', 'transfer_set');
  const qaFiles = ['kebijakan_cuti_qa.json', 'keamanan_ti_qa.json', 'pengadaan_barang_qa.json'];
  const questions = [];
  for (const file of qaFiles) {
    const json = JSON.parse(fs.readFileSync(path.join(transferDir, file), 'utf8'));
    const key = path.basename(file, '_qa.json') === 'kebijakan_cuti' ? 'CUTI'
      : path.basename(file, '_qa.json') === 'keamanan_ti' ? 'TI' : 'PD';
    for (const q of json.questions) {
      questions.push({
        ...q, caseKey: `${key}:${q.id}`, kbKey: key, gtFile: file,
        source_sections: q.source_sections ?? [],
        evidence_spans: q.evidence_spans ?? [], evidence_text: [],
        key_facts: [], // transfer QA has no key_facts field — reported NOT_MEASURED downstream
        split: 'transfer', scope: 'single_doc',
      });
    }
  }
  if (questions.length !== 66) throw new Error(`Harus 66 soal transfer, ditemukan ${questions.length}`);

  const db = new Database(WORKSPACE_DB);
  db.pragma('journal_mode = DELETE');
  const datasetById = new Map(docs.map((d) => [d.key, d.datasetId]));
  const allIds = docs.map((d) => d.datasetId);

  /* ---------- PDF-derived GT sections + production extracted sections ---------- */
  const chunkTextById = new Map();
  const chunkMetaById = new Map();
  const chunkToSection = new Map();
  const corpus = {};
  for (const d of docs) {
    const pdf = await getDocumentProxy(new Uint8Array(fs.readFileSync(path.join(transferDir, d.pdf))));
    const items = [];
    for (let i = 1; i <= pdf.numPages; i += 1) {
      const content = await (await pdf.getPage(i)).getTextContent();
      items.push(content.items);
    }
    const pages = layoutAwarePdfTexts(items);
    const gtSections = sectionsFromPdfLines(pages.flatMap((p) => p.readingOrder), d.key);

    const rows = db.prepare(
      'SELECT id, document_id, dataset_id, section_path, page, text, token_count, char_count, level, parent_id, page_span FROM core_chunks WHERE dataset_id = ? ORDER BY id',
    ).all(d.datasetId);
    const sectionOrder = [];
    const sectionMap = new Map();
    for (const row of rows) {
      const id = String(row.id);
      const text = String(row.text ?? '');
      chunkTextById.set(id, text);
      // SAME chunk→GT-section anchor rule as eval/bridge.mjs
      let matched = null;
      const nt = norm(text);
      for (const s of gtSections) {
        const ns = norm(s.text);
        const needle = nt.slice(0, 90);
        const tail = nt.slice(-90);
        if ((needle && ns.includes(needle)) || (tail && ns.includes(tail))) { matched = s.section_id; break; }
      }
      if (!matched) {
        const sp = norm(row.section_path);
        const byTitle = gtSections.find((s) => sp && sp === norm(s.title));
        if (byTitle) matched = byTitle.section_id;
      }
      if (matched) chunkToSection.set(id, matched);
      chunkMetaById.set(id, {
        id, kb: d.key, dataset_id: String(row.dataset_id), document_id: String(row.document_id),
        section_path: String(row.section_path ?? ''), page: row.page ?? null,
        level: String(row.level ?? ''), parent_id: row.parent_id == null ? null : String(row.parent_id),
        token_count: row.token_count ?? 0, char_count: row.char_count ?? 0,
        page_span: row.page_span ?? null, gt_section: matched, text,
      });
      if (row.level !== 'child') continue;
      const key = String(row.section_path ?? '').trim();
      if (!key) continue;
      if (!sectionMap.has(key)) {
        sectionMap.set(key, { section_path: key, page: row.page ?? null, text: '', chunk_ids: [], first_id: row.id });
        sectionOrder.push(key);
      }
      const sec = sectionMap.get(key);
      sec.chunk_ids.push(id);
      if (!sec.text.includes(text)) sec.text += (sec.text ? '\n' : '') + text;
    }
    corpus[d.key] = {
      kb: d.key, pdf: d.pdf, gtFile: `${d.key}_qa.json`,
      ingest: { kb: d.key, pdf: d.pdf, ingestMode: d.ingestMode, fallbackReason: null,
        datasetId: d.datasetId, sha256: d.sha256, chunkCount: d.chunkCount },
      gt_sections: gtSections,
      extracted_sections: sectionOrder.map((k) => sectionMap.get(k)),
      chunk_count: rows.length,
      layout: d.layout, pageStats: d.pageStats,
    };
    console.error(`[bridge] ${d.key}: gt_sections=${gtSections.length} extracted=${sectionOrder.length} chunks=${rows.length} aligned=${gtSections.filter((s) => [...chunkToSection.values()].includes(s.section_id)).length}`);
  }

  function packCitations(citations) {
    return (citations ?? []).map((c, i) => {
      const id = String(c.chunk_id ?? '');
      return {
        rank: i + 1, chunk_id: c.chunk_id ?? null,
        gt_section: chunkToSection.get(id) ?? null,
        section_path: String(c.section_path ?? ''), document_id: String(c.document_id ?? ''),
        page: c.page ?? null, score: typeof c.score === 'number' ? c.score : null,
        quote: String(c.quote ?? '').slice(0, 500),
      };
    });
  }

  /* ---------- self-retrieval (query = first 220 chars of PDF-derived section) ---------- */
  const selfRetrieval = [];
  for (const d of docs) {
    for (const s of corpus[d.key].gt_sections) {
      const query = String(s.text ?? '').slice(0, 220);
      const ranked = packCitations(searchChunks(db, { datasetId: allIds, question: query, limit: 5 }));
      const ranks = ranked.filter((r) => r.gt_section === s.section_id).map((r) => r.rank);
      selfRetrieval.push({
        section_id: s.section_id, kb: d.key, title: s.title, ingestMode: 'pdf',
        query: query.slice(0, 120), ranks, hit_at_1: ranks.includes(1), hit_at_5: ranks.length > 0,
        top1_gt_section: ranked[0]?.gt_section ?? null,
      });
    }
  }

  /* ---------- per-question production pipeline ---------- */
  const ABSTAIN_RE = /(tidak ditemukan|tidak dapat dijawab|tidak ada bukti|di luar cakupan|tidak akan mengarang|belum tersedia|belum diatur)/i;
  function didAbstain(result) {
    if (result.guardrail && result.guardrail.type) return true;
    const meta = result.meta ?? {};
    if (meta.confidenceLevel === 'refused' || meta.fallbackReason === 'guardrail') return true;
    return ABSTAIN_RE.test(String(result.answer ?? ''));
  }

  const cases = [];
  for (let i = 0; i < questions.length; i += 1) {
    const q = questions[i];
    const primary = datasetById.get(q.kbKey) ?? allIds[0];
    const corrected = correctQueryWithVocabulary(db, allIds, q.question);
    const retrievalRaw = packCitations(searchChunks(db, { datasetId: allIds, question: q.question, limit: 20 }));
    const retrievalRewritten = packCitations(searchChunks(db, { datasetId: allIds, question: corrected, limit: 20 }));
    const retrievalProduction = packCitations(retrieveWithEntityBoost(db, allIds, q.question, 20));
    let answerResult;
    try {
      const aiCtx = buildAiPortContext(db, { datasetIds: allIds });
      answerResult = await answerQuestion(db, {
        datasetId: primary, question: q.question, lang: 'id', context: null, evaluate: true,
        ...aiCtx, retrievalDatasetIds: allIds,
      }, createCorePorts(db));
    } catch (err) {
      answerResult = {
        answer: '', citations: [], guardrail: null, mode: 'error', evaluation: null,
        duration_ms: 0, meta: { error: err instanceof Error ? err.message : String(err) },
      };
    }
    cases.push({
      caseKey: q.caseKey, id: q.id, kb: q.kbKey, split: q.split, scope: q.scope,
      question: q.question, answerability: q.answerability, expected_behavior: q.expected_behavior,
      ground_truth_answer: q.ground_truth_answer, key_facts: [],
      forbidden_claims: [], source_sections: q.source_sections ?? [],
      evidence_spans: q.evidence_spans ?? [], evidence_text: [],
      ingestMode: 'pdf',
      answer: String(answerResult.answer ?? ''),
      citations: (answerResult.citations ?? []).map((c) => ({
        chunk_id: c.chunk_id ?? null, document_id: c.document_id ?? null,
        section_path: c.section_path ?? null, page: c.page ?? null,
        score: typeof c.score === 'number' ? c.score : null,
        quote: String(c.quote ?? ''), gt_section: chunkToSection.get(String(c.chunk_id ?? '')) ?? null,
      })),
      guardrail: answerResult.guardrail?.type ?? null,
      meta: answerResult.meta ?? {}, mode: answerResult.mode ?? null,
      evaluation: answerResult.evaluation ?? null,
      latencyMs: answerResult.duration_ms ?? 0,
      abstain: didAbstain(answerResult),
      retrieval: { raw: retrievalRaw, rewritten: retrievalRewritten, production: retrievalProduction },
      corrected_question: corrected === q.question ? null : corrected,
    });
    if ((i + 1) % 20 === 0 || i + 1 === questions.length) console.error(`  bridge progress ${i + 1}/${questions.length}`);
  }
  db.close();

  const report = {
    generatedAt: new Date().toISOString(),
    role: 'qa', phase: 'P4', harness: 'scripts/qa-transfer-bridge.mjs',
    deterministic: true,
    config: {
      label: 'transfer_indexed', questionsFile: 'tanyadata/eval/transfer_set/*_qa.json (3 files, 66 QA)',
      ingestKb: docs.map((d) => d.key), evalKb: docs.map((d) => d.key),
      llmMode: process.env.LLM_MODE, retrievalMode: process.env.RETRIEVAL_MODE,
      qdrantMode: process.env.QDRANT_MODE, embeddingProvider: process.env.EMBEDDING_PROVIDER,
      runtimePatchApplied: fs.existsSync(ingestPatchedPath),
      workspace: ws, corpusSource: 'PDF text layer only; NO gt_text_fallback, NO QA text in index',
      pipeline: [
        'validateUpload → ingestIntoDataset (PDF text layer; OCR not triggered)',
        'layoutAwarePdfTexts → sectionsFromPages → cleanSections → chunkDocument → core_chunks + FTS5',
        'searchChunks (raw) / correctQueryWithVocabulary+searchChunks (rewritten) / retrieveWithEntityBoost (production)',
        'buildAiPortContext → answerQuestion(..., createCorePorts) — jalur produksi',
      ],
    },
    paths: { transferDir, workspace: ws, manifest: manifestPath },
    corpus,
    known_violations: [{
      id: 'TRANSFER_PDF_ONLY', status: 'COMPLIANT',
      rule: 'Korpus evaluasi tidak boleh berasal dari ground truth',
      detail: 'Ketiga PDF diindeks dari bytes PDF via pipeline produksi. Tidak ada gt_text_fallback; *_qa.json hanya dipakai sebagai daftar soal + label metrik.',
    }],
    gt_summary: {
      files: qaFiles, total_questions: cases.length,
      dev: cases.filter((q) => q.split === 'dev').length,
      holdout: cases.filter((q) => q.split === 'holdout').length,
      sections: docs.reduce((n, d) => n + corpus[d.key].gt_sections.length, 0),
    },
    chunks_by_id: Object.fromEntries(chunkMetaById),
    indexing: {
      self_retrieval: selfRetrieval,
      alias_retrieval: [],
      alias_note: 'NOT_MEASURED: knowledge_tuning_sop.json aliases target KB01–KB04, tidak ada alias untuk domain transfer (CUTI/TI/PD).',
    },
    cases,
  };
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`QA_TRANSFER_BRIDGE_OK cases=${cases.length} sections=${report.gt_summary.sections} out=${path.relative(repoRoot, outFile)}`);
  clearTimeout(timer);
  process.exit(0);
} catch (error) {
  clearTimeout(timer);
  console.error('QA_TRANSFER_BRIDGE_ERROR', error instanceof Error ? error.stack : String(error));
  process.exit(1);
}
