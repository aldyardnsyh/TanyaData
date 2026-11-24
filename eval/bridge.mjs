#!/usr/bin/env node
/**
 * QA baseline bridge — FASE 1A.
 *
 * Menjalankan JALUR PRODUKSI tanyadata (bukan dev server, bukan HTTP) untuk
 * seluruh 139 soal GT, lalu membuang data mentah yang dibutuhkan harness
 * Python (eval/run_eval.py + eval/run_stage_checks.py):
 *
 *   - teks/struktur ekstraksi per KB (chunk, section_path, urutan)
 *   - chunk → GT section mapping
 *   - retrieval per soal: RAW (tanpa rewrite/rerank), REWRITTEN, PRODUCTION
 *   - jawaban + sitasi + keputusan abstain + latensi per soal
 *   - self-retrieval & alias-retrieval untuk metrik indexing
 *
 * Mode deterministik: LLM_MODE=off, RETRIEVAL_MODE=fts5, tanpa jaringan.
 * Satu-satunya pelanggaran aturan yang sengaja DIPERTAHANKAN pada baseline ini
 * adalah `gt_text_fallback` untuk KB01/KB04 (PDF image-only, OCR offline tidak
 * tersedia). Ditandai KNOWN_BASELINE_VIOLATION di output — tidak disembunyikan,
 * tidak diperbaiki di Fase 1A (perbaikan = Fase 2, lane owner).
 *
 * TIDAK mengubah kode aplikasi. Patch runtime hanya untuk SyntaxError Node 22
 * type-stripping yang sudah ada di scripts/eval-kb-ground-truth.mjs.
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
    ? process.argv[i + 1]
    : fallback;
}

const KB_DIR = path.resolve(repoRoot, arg('--kb-dir', 'ai_chatbot_testdata/ai_chatbot_testdata/Knowledge Base'));
const gtDirArg = arg('--gt-dir', null);
const GT_DIR = gtDirArg ? path.resolve(repoRoot, gtDirArg) : path.join(KB_DIR, 'GroundTruth Knowledge Based');
const gtCountExpected = Number(arg('--gt-count', '4'));
const questionsArg = arg('--questions', null);
const QUESTIONS_FILE = questionsArg ? path.resolve(repoRoot, questionsArg) : null;
const ingestKbArg = arg('--ingest-kb', null);
const evalKbArg = arg('--eval-kb', null);
const INGEST_KB = ingestKbArg ? new Set(ingestKbArg.split(',').map((s) => s.trim()).filter(Boolean)) : null;
const EVAL_KB = evalKbArg ? new Set(evalKbArg.split(',').map((s) => s.trim()).filter(Boolean)) : null;
const RUN_LABEL = arg('--label', 'baseline');
const SOP_FILE = path.resolve(repoRoot, arg('--sop', 'ai_chatbot_testdata/ai_chatbot_testdata/Knowledge Base/Tuningan Knowledge/knowledge_tuning_sop.json'));
const outFile = path.resolve(repoRoot, arg('--out', 'tanyadata/eval/results/bridge_raw.json'));
const timeoutMs = Number(process.env.EVAL_TIMEOUT_MS || arg('--timeout', '540000'));

/* ---------------------------------------------------------- temp workspace */
const runId = `${process.pid}-${Date.now()}`;
const baseDir = path.join(os.tmpdir(), 'opencode', `qa-baseline-${runId}`);
const DATA_DIR = path.join(baseDir, 'data');
const WORKSPACE_DIR = path.join(baseDir, 'workspace');
const KB_COPY_DIR = path.join(DATA_DIR, 'kb');
fs.mkdirSync(KB_COPY_DIR, { recursive: true });
fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
process.env.DATA_DIR = DATA_DIR;
process.env.WORKSPACE_DIR = WORKSPACE_DIR;

// SEMANTIC COMPOSITION V2 — bridge harus bisa menjalankan ablasi LLM_MODE
// off/full dari env. Sebelumnya mode selalu dipaksa 'off' dan kredensial
// dihapus, sehingga jalur LLM tidak pernah teruji. Default tetap 'off'
// supaya artefak lama reproducible; tidak ada kunci yang pernah dicetak.
function loadDotEnvIfPresent() {
  const envPath = path.join(root, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i.exec(line);
    if (!m || m[2].startsWith('#')) continue;
    if (process.env[m[1]] == null) process.env[m[1]] = m[2];
  }
}
// Selalu muat kredensial dari .env; fungsi di atas tidak menimpa env yang
// sudah diset eksplisit, jadi LLM_MODE dari CLI tetap menang.
loadDotEnvIfPresent();
const llmModeArg = arg('--llm-mode', null);
if (llmModeArg === 'off' || llmModeArg === 'full' || llmModeArg === 'assist') {
  process.env.LLM_MODE = llmModeArg;
} else if (!process.env.LLM_MODE) {
  process.env.LLM_MODE = 'off';
}
// FASE 3: mode retrieval bisa dioverride untuk ablasi yang didukung flag.
// Default tetap 'fts5' agar semua artefak lama reproducible.
process.env.RETRIEVAL_MODE = arg('--retrieval-mode', 'fts5');
process.env.QDRANT_MODE = 'off';
process.env.EMBEDDING_PROVIDER = 'off';
if (process.env.LLM_MODE === 'off') {
  delete process.env.LLM_API_KEY;
  delete process.env.LLM_BASE_URL;
}

/* ------------------------------------------- runtime-only syntax shim (NO source edit) */
const ingestSourcePath = path.join(root, 'lib/core/ingest.ts');
const ingestPatchedPath = path.join(baseDir, 'ingest.runtime-patch.ts');
{
  const src = fs.readFileSync(ingestSourcePath, 'utf8');
  const needle = "await mark('indexing', () => {";
  const patched = src.includes(needle)
    ? src.replace(needle, "await mark('indexing', async () => {")
    : src;
  fs.writeFileSync(ingestPatchedPath, patched, 'utf8');
}
const runtimePatched = fs.readFileSync(ingestPatchedPath, 'utf8') !== fs.readFileSync(ingestSourcePath, 'utf8');

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) {
      const abs = path.join(root, specifier.slice(2)) + '.ts';
      if (path.resolve(abs) === ingestSourcePath && runtimePatched) {
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

/* ------------------------------------------------------------------ helpers */
function norm(s) {
  return String(s ?? '')
    .toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function contains(hay, needle) {
  const n = norm(needle);
  return n.length > 0 && norm(hay).includes(n);
}
function uniq(list) { return [...new Set(list.filter(Boolean))]; }

const Database = (await import(pathToFileURL(path.join(root, 'node_modules/better-sqlite3/lib/index.js')).href)).default;
const { CORE_SCHEMA_SQL, WORKSPACE_DB } = await import(pathToFileURL(path.join(root, 'lib/db/paths.ts')).href);
const { validateUpload, ingestIntoDataset } = await import(pathToFileURL(runtimePatched ? ingestPatchedPath : ingestSourcePath).href);
const { createDataset } = await import(pathToFileURL(path.join(root, 'lib/core/registry.ts')).href);
const { answerQuestion } = await import(pathToFileURL(path.join(root, 'lib/core/query.ts')).href);
const { createCorePorts, buildAiPortContext } = await import(pathToFileURL(path.join(root, 'lib/ai/adapter.ts')).href);
const { searchChunks } = await import(pathToFileURL(path.join(root, 'lib/core/store.ts')).href);
const { retrieveWithEntityBoost } = await import(pathToFileURL(path.join(root, 'lib/ai/retrieval.ts')).href);
const { correctQueryWithVocabulary } = await import(pathToFileURL(path.join(root, 'lib/core/query-rewrite.ts')).href);

const timer = setTimeout(() => {
  console.error(`QA_BRIDGE_TIMEOUT after ${timeoutMs}ms`);
  try { fs.rmSync(baseDir, { recursive: true, force: true }); } catch { /* best effort */ }
  process.exit(1);
}, timeoutMs);

try {
  /* ------------------------------------------------------------- load GT/SOP */
  const gtFiles = fs.readdirSync(GT_DIR)
    .filter((f) => /^ground_truth_KB0\d_.*\.json$/i.test(f)).sort();
  if (gtFiles.length !== gtCountExpected) {
    throw new Error(`Harus ${gtCountExpected} file GT, ditemukan ${gtFiles.length} di ${GT_DIR}`);
  }
  const sop = JSON.parse(fs.readFileSync(SOP_FILE, 'utf8'));

  const corpora = gtFiles.map((file) => {
    const json = JSON.parse(fs.readFileSync(path.join(GT_DIR, file), 'utf8'));
    const pdfName = String(json.metadata?.document ?? '');
    const key = (pdfName.match(/KB_0(\d)/) ?? [])[1] ?? file.slice(13, 15);
    return {
      file, key: `KB0${key}`, pdfName, json,
      corpusSections: json.corpus_sections ?? [],
      abstainReference: String(json.metadata?.abstain_reference ?? ''),
    };
  });

  const allQuestions = [];
  for (const c of corpora) {
    for (const q of c.json.questions ?? []) {
      allQuestions.push({ ...q, caseKey: `${c.key}:${q.id}`, kbKey: c.key, gtFile: c.file, corpusSections: c.corpusSections });
    }
  }

  // FASE 3: set soal eksternal (transfer set / general questions). Index TETAP
  // berasal dari PDF di KB_DIR — file soal hanya dipakai sebagai daftar tanya +
  // label GT untuk metrik, bukan sebagai teks korpus.
  if (QUESTIONS_FILE) {
    const custom = JSON.parse(fs.readFileSync(QUESTIONS_FILE, 'utf8'));
    const list = Array.isArray(custom) ? custom : (custom.questions ?? []);
    allQuestions.length = 0;
    for (const q of list) {
      const kbKey = String(q.kb ?? q.kbKey ?? (q.documents_involved ?? [])[0] ?? 'KB01');
      allQuestions.push({
        ...q,
        caseKey: `${kbKey}:${q.id}`,
        kbKey,
        gtFile: path.basename(QUESTIONS_FILE),
        corpusSections: [],
        source_sections: q.source_sections ?? q.expected_sections ?? [],
        key_facts: q.key_facts ?? [],
        evidence_spans: q.evidence_spans ?? [],
        evidence_text: q.evidence_text ?? [],
        split: q.split ?? 'custom',
        scope: q.scope ?? 'single_doc',
        answerability: q.answerability ?? 'full',
        expected_behavior: q.expected_behavior ?? 'answer',
      });
    }
  }

  // FASE 3: LODO — indeks dari 3 dokumen, soal dari dokumen ke-4.
  const questionsToRun = EVAL_KB ? allQuestions.filter((q) => EVAL_KB.has(q.kbKey)) : allQuestions;
  if (!questionsToRun.length) throw new Error('Tidak ada soal setelah filter --eval-kb');

  /* ------------------------------------------------------------ open DB */
  fs.mkdirSync(path.dirname(WORKSPACE_DB), { recursive: true });
  const db = new Database(WORKSPACE_DB);
  db.pragma('journal_mode = DELETE');
  db.exec(fs.readFileSync(CORE_SCHEMA_SQL, 'utf8'));

  /* ------------------------------------------------------------ ingest */
  const datasetById = new Map();
  const ingestRecords = [];
  const violations = [];
  const corporaToIngest = INGEST_KB ? corpora.filter((c) => INGEST_KB.has(c.key)) : corpora;
  if (!corporaToIngest.length) throw new Error('Tidak ada dokumen setelah filter --ingest-kb');
  for (const c of corporaToIngest) {
    const src = path.join(KB_DIR, c.pdfName);
    if (!fs.existsSync(src)) throw new Error(`PDF tidak ditemukan: ${src}`);
    const buffer = fs.readFileSync(src);
    fs.copyFileSync(src, path.join(KB_COPY_DIR, c.pdfName));

    let validated = validateUpload({ filename: c.pdfName, mime: 'application/pdf', size: buffer.length, buffer });
    let ingestBuffer = buffer;
    let ingestName = c.pdfName;
    let ingestMode = 'pdf';
    let fallbackReason = null;

    let dataset = createDataset(db, {
      name: c.pdfName.replace(/\.pdf$/i, ''), kind: 'document', source_type: 'pdf',
      doc_type: 'general', status: 'UPLOADED', size_bytes: buffer.length, sha256: validated.sha256,
    });
    try {
      await ingestIntoDataset(db, {
        dataset, buffer, format: 'pdf', originalName: validated.originalName,
        storagePath: path.join(KB_COPY_DIR, c.pdfName),
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      if (!/NO_TEXT_LAYER|text layer/i.test(reason)) throw err;
      fallbackReason = reason;
      ingestMode = 'gt_text_fallback';
      // Pelanggaran aturan user: korpus direkonstruksi dari corpus_sections GT.
      // SENGAJA dipertahankan pada baseline Fase 1A, dilaporkan — bukan diperbaiki.
      violations.push({
        id: 'KNOWN_BASELINE_VIOLATION',
        kb: c.key, pdf: c.pdfName,
        rule: 'Korpus evaluasi tidak boleh berasal dari ground truth',
        detail: 'PDF image-only tanpa text layer; OCR offline tidak tersedia. Teks diambil dari corpus_sections GT.',
        reason,
        phase_to_fix: 'Fase 2 (owner lane)',
      });
      const md = c.corpusSections.map((s) => `${s.number}. ${s.title}\n${s.text}`).join('\n\n');
      ingestBuffer = Buffer.from(md, 'utf8');
      ingestName = `${c.key}_${c.pdfName.replace(/\.pdf$/i, '')}.md`;
      fs.writeFileSync(path.join(KB_COPY_DIR, ingestName), ingestBuffer);
      validated = validateUpload({ filename: ingestName, mime: 'text/markdown', size: ingestBuffer.length, buffer: ingestBuffer });
      dataset = createDataset(db, {
        name: c.pdfName.replace(/\.pdf$/i, ''), kind: 'document', source_type: 'md',
        doc_type: 'general', status: 'UPLOADED', size_bytes: ingestBuffer.length, sha256: validated.sha256,
      });
      await ingestIntoDataset(db, {
        dataset, buffer: ingestBuffer, format: 'md', originalName: validated.originalName,
        storagePath: path.join(KB_COPY_DIR, ingestName),
      });
    }
    datasetById.set(c.key, dataset.id);
    ingestRecords.push({
      kb: c.key, pdf: c.pdfName, ingestMode, fallbackReason,
      datasetId: dataset.id, sha256: validated.sha256,
    });
  }

  /* ------------------------------------------ chunk rows + GT section map */
  const chunkTextById = new Map();
  const chunkMetaById = new Map();
  const chunkToSection = new Map();
  const corpus = {};
  for (const c of corporaToIngest) {
    const datasetId = datasetById.get(c.key);
    const rows = db
      .prepare('SELECT id, document_id, dataset_id, section_path, page, text, token_count, char_count, level, parent_id, page_span FROM core_chunks WHERE dataset_id = ? ORDER BY id')
      .all(datasetId);
    const sectionOrder = [];
    const sectionMap = new Map();
    for (const row of rows) {
      const id = String(row.id);
      const text = String(row.text ?? '');
      chunkTextById.set(id, text);
      // chunk → GT section (text anchor, sama seperti eval aiml existing)
      let matched = null;
      const nt = norm(text);
      for (const s of c.corpusSections) {
        const ns = norm(s.text);
        const needle = nt.slice(0, 90);
        const tail = nt.slice(-90);
        if ((needle && ns.includes(needle)) || (tail && ns.includes(tail))) { matched = s.section_id; break; }
      }
      if (!matched) {
        const sp = norm(row.section_path);
        const byTitle = c.corpusSections.find((s) => sp && sp === norm(s.title));
        if (byTitle) matched = byTitle.section_id;
      }
      if (matched) chunkToSection.set(id, matched);
      chunkMetaById.set(id, {
        id, kb: c.key, dataset_id: String(row.dataset_id), document_id: String(row.document_id),
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
    corpus[c.key] = {
      kb: c.key, pdf: c.pdfName, gtFile: c.file,
      ingest: ingestRecords.find((r) => r.kb === c.key),
      gt_sections: c.corpusSections,
      extracted_sections: sectionOrder.map((k) => sectionMap.get(k)),
      chunk_count: rows.length,
    };
  }

  const allIds = corporaToIngest.map((c) => datasetById.get(c.key)).filter(Boolean);

  /* ------------------------------------------------ retrieval helper */
  function packCitations(citations) {
    return (citations ?? []).map((c, i) => {
      const id = String(c.chunk_id ?? '');
      return {
        rank: i + 1,
        chunk_id: c.chunk_id ?? null,
        gt_section: chunkToSection.get(id) ?? null,
        section_path: String(c.section_path ?? ''),
        document_id: String(c.document_id ?? ''),
        page: c.page ?? null,
        score: typeof c.score === 'number' ? c.score : null,
        quote: String(c.quote ?? '').slice(0, 500),
      };
    });
  }

  /* ------------------------------------------------ indexing: self-retrieval */
  const selfRetrieval = [];
  for (const c of corporaToIngest) {
    for (const s of c.corpusSections) {
      const query = String(s.text ?? '').slice(0, 220);
      const ranked = packCitations(searchChunks(db, { datasetId: allIds, question: query, limit: 5 }));
      const ranks = ranked.filter((r) => r.gt_section === s.section_id).map((r) => r.rank);
      selfRetrieval.push({
        section_id: s.section_id, kb: c.key, title: s.title,
        ingestMode: corpus[c.key].ingest.ingestMode,
        query: query.slice(0, 120), ranks, hit_at_1: ranks.includes(1), hit_at_5: ranks.length > 0,
        top1_gt_section: ranked[0]?.gt_section ?? null,
      });
    }
  }

  /* ------------------------------------------------ indexing: alias-retrieval */
  const aliasRetrieval = [];
  for (const entry of sop.topic_aliases ?? []) {
    const target = String(entry.section_id ?? '');
    for (const alias of entry.aliases ?? []) {
      const ranked = packCitations(searchChunks(db, { datasetId: allIds, question: alias, limit: 5 }));
      const ranks = ranked.filter((r) => r.gt_section === target).map((r) => r.rank);
      const kb = target.slice(0, 4);
      aliasRetrieval.push({
        section_id: target, kb, ingestMode: corpus[kb]?.ingest?.ingestMode ?? 'unknown',
        alias, ranks, hit_at_1: ranks.includes(1), hit_at_3: ranks.some((r) => r <= 3), hit_at_5: ranks.length > 0,
        top1_gt_section: ranked[0]?.gt_section ?? null,
      });
    }
  }

  /* ------------------------------------------------ per-question pipeline */
  const ABSTAIN_RE = /(tidak ditemukan|tidak dapat dijawab|tidak ada bukti|di luar cakupan|tidak akan mengarang|belum tersedia|belum diatur)/i;
  function didAbstain(result) {
    if (result.guardrail && result.guardrail.type) return true;
    const meta = result.meta ?? {};
    if (meta.confidenceLevel === 'refused' || meta.fallbackReason === 'guardrail') return true;
    return ABSTAIN_RE.test(String(result.answer ?? ''));
  }

  const cases = [];
  for (let i = 0; i < questionsToRun.length; i += 1) {
    const q = questionsToRun[i];
    // LODO: soal berasal dari dokumen yang sengaja TIDAK diindeks. datasetId
    // aktif dipakai default ke dokumen pertama yang tersedia; retrieval tetap
    // memakai retrievalDatasetIds=allIds (3 dokumen training).
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
      ground_truth_answer: q.ground_truth_answer, key_facts: q.key_facts ?? [],
      forbidden_claims: q.forbidden_claims ?? [], source_sections: q.source_sections ?? [],
      evidence_spans: q.evidence_spans ?? [], evidence_text: q.evidence_text ?? [],
      ingestMode: corpus[q.kbKey]?.ingest?.ingestMode ?? 'not_ingested',
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
    if ((i + 1) % 20 === 0 || i + 1 === questionsToRun.length) console.error(`  bridge progress ${i + 1}/${questionsToRun.length}`);
  }
  db.close();

  const report = {
    generatedAt: new Date().toISOString(),
    role: 'qa', phase: 'P3-FASE3', harness: 'eval/bridge.mjs',
    deterministic: true,
    config: {
      label: RUN_LABEL,
      questionsFile: QUESTIONS_FILE ? path.relative(repoRoot, QUESTIONS_FILE) : null,
      ingestKb: INGEST_KB ? [...INGEST_KB] : corporaToIngest.map((c) => c.key),
      evalKb: EVAL_KB ? [...EVAL_KB] : corpora.map((c) => c.key),
      llmMode: process.env.LLM_MODE, retrievalMode: process.env.RETRIEVAL_MODE,
      qdrantMode: process.env.QDRANT_MODE, embeddingProvider: process.env.EMBEDDING_PROVIDER,
      runtimePatchApplied: runtimePatched,
      pipeline: [
        'validateUpload → ingestIntoDataset (PDF; image-only → gt_text_fallback, DILAPORKAN)',
        'sectionsFromPages → cleanSections → chunkDocument → core_chunks + FTS5',
        'searchChunks (raw) / correctQueryWithVocabulary+searchChunks (rewritten) / retrieveWithEntityBoost (production)',
        'buildAiPortContext → answerQuestion(..., createCorePorts) — jalur produksi',
      ],
    },
    paths: { kbDir: KB_DIR, gtDir: GT_DIR, sopFile: SOP_FILE, workspace: baseDir },
    corpus,
    known_violations: violations,
    gt_summary: {
      files: gtFiles, total_questions: questionsToRun.length,
      dev: questionsToRun.filter((q) => q.split === 'dev').length,
      holdout: questionsToRun.filter((q) => q.split === 'holdout').length,
      sections: corporaToIngest.reduce((n, c) => n + c.corpusSections.length, 0),
    },
    chunks_by_id: Object.fromEntries(chunkMetaById),
    indexing: { self_retrieval: selfRetrieval, alias_retrieval: aliasRetrieval },
    cases,
  };

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`QA_BRIDGE_OK cases=${cases.length} sections=${report.gt_summary.sections} aliases=${aliasRetrieval.length} violations=${violations.length} out=${path.relative(repoRoot, outFile)}`);
  try { fs.rmSync(baseDir, { recursive: true, force: true }); } catch { /* best effort */ }
  clearTimeout(timer);
  process.exit(0);
} catch (error) {
  clearTimeout(timer);
  console.error('QA_BRIDGE_ERROR', error instanceof Error ? error.stack : String(error));
  try { fs.rmSync(baseDir, { recursive: true, force: true }); } catch { /* best effort */ }
  process.exit(1);
}
