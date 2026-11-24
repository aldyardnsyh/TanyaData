#!/usr/bin/env python3
"""
QA baseline harness — FASE 1A (role: qa).

Menjalankan SATU baseline deterministik terhadap pipeline produksi tanyadata
lewat eval/bridge.mjs (Node subprocess, TANPA dev server / HTTP), lalu
menggabungkan:

  * stage checks dari eval/run_stage_checks.py
  * metrik end-to-end (abstain, faithfulness, key-fact, style, anomaly)
  * metrik sitasi (inline, uncited claim, attribution, quote, span-F1, ...)

menjadi eval/results/baseline.json — satu artefak tunggal yang bisa diaudit.

Aturan pelanggaran baseline (gt_text_fallback untuk KB01/KB04) TIDAK
disembunyikan dan TIDAK diperbaiki di fase ini; dicatat sebagai
KNOWN_BASELINE_VIOLATION di dalam output.

Jalankan (timeout wajib, lewat wrapper global):
  python "C:\\Users\\aldya\\.config\\opencode\\scripts\\safe_exec.py" --timeout 600 -- \
    python "tanyadata\\eval\\run_eval.py"
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import unicodedata
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(HERE)
SAFE_EXEC = r"C:\Users\aldya\.config\opencode\scripts\safe_exec.py"
BRIDGE = os.path.join(HERE, "bridge.mjs")
RESULTS_DIR = os.path.join(HERE, "results")
RAW_FILE = os.path.join(RESULTS_DIR, "bridge_raw.json")
BASELINE_FILE = os.path.join(RESULTS_DIR, "baseline.json")

sys.path.insert(0, HERE)
from run_stage_checks import (  # noqa: E402
    contains, mean, metric, not_measured, norm, ratio, run_all_stage_checks, token_set,
)


# --------------------------------------------------------------------------- #
# text helpers                                                                 #
# --------------------------------------------------------------------------- #
INLINE_RE = re.compile(r"\[(\d{1,2})\]")
SENT_SPLIT_RE = re.compile(r"(?<=[.!?])\s+|\n+")
NUM_RE = re.compile(r"\d+(?:[.,]\d+)?")
MOJIBAKE_RE = re.compile(r"\uFFFD|Ã©|â€|\u009d|\u0093|\u0094")
SLOP_OPENERS = (
    "dalam dunia yang", "berikut adalah data live", "pada dasarnya",
    "dalam rangka", "sebagai informasi tambahan", "perlu dicatat bahwa",
)
CAVEAT_RE = re.compile(
    r"tidak disebut|tidak disebutkan|tidak ada|belum diatur|belum tersedia|"
    r"sebagian|hanya|terbatas|tidak tercantum|tidak memuat|tidak dinyatakan",
    re.IGNORECASE,
)
FACT_STOP = {
    "yang", "dan", "atau", "dalam", "untuk", "dengan", "pada", "dari", "tidak",
    "ini", "itu", "adalah", "wajib", "setiap", "semua", "jika", "bila", "saat",
    "setelah", "sebelum", "oleh", "kepada", "sebagai", "harus", "dapat", "akan",
    "sudah", "belum", "lebih", "kurang", "sampai", "antara", "karena", "agar",
    "supaya", "bahwa", "dokumen", "informasi", "petugas", "pelanggan", "tiket",
    "insiden", "layanan", "caveat", "tidaknya", "tanpa", "ada", "menjadi",
}


def sentences(text: Any) -> List[str]:
    """Pecah kalimat, lalu kembalikan marker [n] yang menempel di awal segmen
    ke kalimat SEBELUMNYA. Composer produksi menaruh marker di akhir kalimat
    ('... selesai. [1]'), jadi split regex naif salah mengaitkannya ke kalimat
    berikutnya dan merusak attribution/claim-citation metrics."""
    raw = [s.strip() for s in SENT_SPLIT_RE.split(str(text or "")) if s.strip()]
    out: List[str] = []
    for seg in raw:
        m = re.match(r"^((?:\[\d{1,2}\]\s*)+)(.*)$", seg, re.DOTALL)
        if m and out:
            out[-1] = f"{out[-1]} {m.group(1).strip()}".strip()
            rest = m.group(2).strip()
            if rest:
                out.append(rest)
        else:
            out.append(seg)
    return out


def content_tokens(s: Any) -> Set[str]:
    return {t for t in token_set(s) if t not in FACT_STOP}


def numbers(s: Any) -> Set[str]:
    return set(NUM_RE.findall(str(s or "")))


def supporting_evidence(fact: Any, ev_strings: Sequence[str]) -> Optional[str]:
    """Bukti GT pendukung sebuah key_fact (overlap token konten >= 0.5)."""
    ft = content_tokens(fact)
    if not ft:
        return None
    best, best_score = None, 0.0
    for e in ev_strings:
        et = content_tokens(e)
        if not et:
            continue
        score = len(ft & et) / len(ft)
        if score > best_score:
            best, best_score = e, score
    return best if best_score >= 0.5 else None


def evidence_strings(case: Dict[str, Any]) -> List[str]:
    return list(dict.fromkeys([*(case.get("evidence_spans") or []), *(case.get("evidence_text") or [])]))


def token_overlap(a: Any, b: Any) -> float:
    ta, tb = token_set(a), token_set(b)
    return len(ta & tb) / len(ta) if ta else 0.0


def ws(s: Any) -> str:
    return re.sub(r"\s+", " ", str(s or "")).strip()


# --------------------------------------------------------------------------- #
# end-to-end                                                                   #
# --------------------------------------------------------------------------- #
def check_end_to_end(bridge: Dict[str, Any]) -> Dict[str, Any]:
    cases = bridge.get("cases", [])
    answerable = [c for c in cases if c.get("answerability") != "none" and c.get("expected_behavior") != "abstain"]
    abstain_expected = [c for c in cases if c.get("answerability") == "none" or c.get("expected_behavior") == "abstain"]
    partial = [c for c in cases if c.get("answerability") == "partial"]
    clarify = [c for c in cases if c.get("expected_behavior") == "clarify_or_list_all"]

    false_abstain = mean([1.0 if c.get("abstain") else 0.0 for c in answerable])
    false_answer = mean([0.0 if c.get("abstain") else 1.0 for c in abstain_expected])
    partial_ok = mean([
        1.0 if (not c.get("abstain") and CAVEAT_RE.search(str(c.get("answer", "")))) else 0.0
        for c in partial
    ])

    # faithfulness: tidak ada angka mengarang pada jawaban yang dijawab
    faithful_vals: List[float] = []
    for c in answerable:
        if c.get("abstain"):
            faithful_vals.append(1.0)
            continue
        allowed = numbers(" ".join(
            [str(c.get("ground_truth_answer", ""))]
            + [str(x) for x in (c.get("key_facts") or [])]
            + [str(x) for x in evidence_strings(c)]
        ))
        used = numbers(c.get("answer", ""))
        faithful_vals.append(1.0 if used <= allowed else 0.0)

    # key-fact coverage: grounding-based (supporting evidence), literal fallback
    kf_vals: List[float] = []
    kf_literal_vals: List[float] = []
    for c in answerable:
        facts = c.get("key_facts") or []
        if not facts:
            kf_vals.append(1.0)
            kf_literal_vals.append(1.0)
            continue
        ev = evidence_strings(c)
        quotes = " ".join(str(x.get("quote", "")) for x in (c.get("citations") or []))
        hay = f"{c.get('answer', '')} {quotes}"
        hit = lit = 0
        for f in facts:
            support = supporting_evidence(f, ev)
            if contains(hay, support if support else f):
                hit += 1
            if contains(hay, f):
                lit += 1
        kf_vals.append(ratio(hit, len(facts)))
        kf_literal_vals.append(ratio(lit, len(facts)))

    # style pass (heuristik transparan dari SOP style_guide)
    style_vals: List[float] = []
    style_fail: Dict[str, int] = defaultdict(int)
    for c in cases:
        ans = str(c.get("answer", ""))
        reasons = []
        if not ans.strip():
            reasons.append("empty")
        if MOJIBAKE_RE.search(ans):
            reasons.append("mojibake")
        if any(ans.lower().startswith(o) for o in SLOP_OPENERS):
            reasons.append("slop_opener")
        if not c.get("abstain") and (c.get("citations") or []) and not INLINE_RE.search(ans):
            reasons.append("missing_inline_marker")
        if reasons:
            for r in reasons:
                style_fail[r] += 1
            style_vals.append(0.0)
        else:
            style_vals.append(1.0)

    # clarify handling (n kecil — dilaporkan dengan n, bukan klaim kuat)
    clarify_ok = mean([
        1.0 if (not c.get("abstain") and ("?" in str(c.get("answer", "")) or " atau " in str(c.get("answer", "")).lower()))
        else 0.0
        for c in clarify
    ]) if clarify else 0.0

    anomaly = not_measured(
        "GT 139 soal hanya memuat expected_behavior: answer, answer_with_caveat, abstain, "
        "clarify_or_list_all. Kategori 'anomaly' (32 contoh: kosong, acak, injeksi, "
        "kredensial, dll.) hanya ada di knowledge_tuning_sop.json yang dibaca saja "
        "(read-only) dan bukan bagian dari 139 soal GT. Mengujinya lewat UI/API "
        "adalah lingkup P5, bukan baseline Fase 1A.",
        method="Cek distribusi expected_behavior pada 4 file GT",
    )

    return {
        "false_abstain_rate": metric(false_abstain, "Fraksi soal answerable yang di-abstain (lower better)", n=len(answerable)),
        "false_answer_rate": metric(false_answer, "Fraksi soal abstain-expected yang justru dijawab (lower better)", n=len(abstain_expected)),
        "partial_handling": metric(partial_ok, "Fraksi soal answerability=partial yang dijawab dengan penanda caveat dan tidak di-abstain", n=len(partial)),
        "faithfulness": metric(mean(faithful_vals), "Fraksi jawaban tanpa angka di luar angka pada GT answer/key_facts/evidence", n=len(faithful_vals)),
        "key_fact_coverage": metric(mean(kf_vals), "Rata-rata fraksi key_facts terbukti via supporting evidence di jawaban/sitasi (literal fallback)", threshold=0.99, n=len(kf_vals)),
        "key_fact_literal_coverage": metric(mean(kf_literal_vals), "Transparansi: kecocokan literal parafrasa key_facts (metode lama)", n=len(kf_vals)),
        "style_pass": metric(mean(style_vals), "Heuristik SOP: tidak kosong, bebas mojibake/slop opener, inline marker hadir bila ada sitasi", n=len(style_vals)),
        "style_failure_reasons": dict(style_fail),
        "clarify_or_list_all_handling": metric(clarify_ok, "Fraksi soal clarify_or_list_all yang tidak di-abstain dan memberi alternatif/pertanyaan penyempit (n kecil)", n=len(clarify)),
        "anomaly_pass": anomaly,
        "counts": {
            "total": len(cases), "answerable": len(answerable),
            "abstain_expected": len(abstain_expected), "partial": len(partial),
            "clarify_or_list_all": len(clarify),
        },
    }


# --------------------------------------------------------------------------- #
# citations                                                                    #
# --------------------------------------------------------------------------- #
def check_citations(bridge: Dict[str, Any]) -> Dict[str, Any]:
    cases = [c for c in bridge.get("cases", [])
             if c.get("source_sections") and not c.get("abstain") and (c.get("citations") or [])]
    chunks = bridge.get("chunks_by_id", {})

    tot_inline_sents = tot_inline_marked = 0
    tot_claim_sents = tot_claim_marked = 0
    tot_markers = tot_markers_valid = 0
    tot_cites = tot_cites_grounded = tot_cites_source_ok = tot_quotes_valid = 0
    end_dump = over_cite = 0
    kf_total = kf_marked = 0
    gt_sent_matched = gt_sent_total = ans_sent_matched = ans_sent_factual = 0

    for c in cases:
        ans = str(c.get("answer", ""))
        sents = sentences(ans)
        cites = c.get("citations") or []
        markers = [int(m) for m in INLINE_RE.findall(ans)]
        ev = evidence_strings(c)

        # sentences & inline markers
        for s in sents:
            has_mark = bool(INLINE_RE.search(s))
            tot_inline_sents += 1
            tot_inline_marked += 1 if has_mark else 0
            is_claim = bool(NUM_RE.search(s)) or any(token_overlap(s, e) >= 0.5 for e in ev)
            if is_claim:
                tot_claim_sents += 1
                tot_claim_marked += 1 if has_mark else 0

        if markers and not any(INLINE_RE.search(s) for s in sents):
            end_dump += 1
        if len({str(x.get("chunk_id")) for x in cites}) > len(c.get("source_sections", [])) + 1:
            over_cite += 1

        # attribution: marker n -> citations[n-1], sentence harus punya overlap dengan quote
        for m in markers:
            tot_markers += 1
            if not (1 <= m <= len(cites)):
                continue
            quote = str(cites[m - 1].get("quote", ""))
            marker_sents = [s for s in sents if re.search(rf"\[{m}\]", s)]
            if marker_sents and any(token_overlap(s, quote) >= 0.3 for s in marker_sents):
                tot_markers_valid += 1

        # per citation: grounding, source accuracy, quote validity
        for cite in cites:
            tot_cites += 1
            cid = str(cite.get("chunk_id", ""))
            chunk_text = str((chunks.get(cid) or {}).get("text", ""))
            if any(contains(chunk_text, e) for e in ev):
                tot_cites_grounded += 1
            if cite.get("gt_section") in (c.get("source_sections") or []):
                tot_cites_source_ok += 1
            if ws(cite.get("quote")) and ws(cite.get("quote")) in ws(chunk_text):
                tot_quotes_valid += 1

        # claim citation recall: key_facts -> supporting evidence -> sentence with marker
        for f in c.get("key_facts") or []:
            kf_total += 1
            support = supporting_evidence(f, ev) or f
            for s in sents:
                if contains(s, support) and INLINE_RE.search(s):
                    kf_marked += 1
                    break

        # evidence span F1 (sentence level, micro)
        gt_sents = list(dict.fromkeys(
            ws(s) for s in [*(c.get("evidence_spans") or []), *(c.get("evidence_text") or [])] if ws(s)
        ))
        factual = [s for s in sents if INLINE_RE.search(s) or NUM_RE.search(s)]
        ans_sent_factual += len(factual)
        matched_gt = [g for g in gt_sents if any(contains(s, g) or token_overlap(s, g) >= 0.8 for s in factual)]
        matched_ans = [s for s in factual if any(contains(s, g) or token_overlap(s, g) >= 0.8 for g in gt_sents)]
        gt_sent_total += len(gt_sents)
        gt_sent_matched += len(matched_gt)
        ans_sent_matched += len(matched_ans)

    span_prec = ratio(ans_sent_matched, ans_sent_factual)
    span_rec = ratio(gt_sent_matched, gt_sent_total)
    span_f1 = 0.0 if span_prec + span_rec == 0 else round(2 * span_prec * span_rec / (span_prec + span_rec), 4)

    return {
        "uncited_claim_rate": metric(ratio(tot_claim_sents - tot_claim_marked, tot_claim_sents),
                                     "Fraksi kalimat factual (mengandung angka/bukti) tanpa marker sitasi inline", n=tot_claim_sents),
        "claim_citation_recall": metric(ratio(kf_marked, kf_total),
                                        "Fraksi key_facts yang muncul di kalimat bersitasi inline", n=kf_total),
        "attribution_precision": metric(ratio(tot_markers_valid, tot_markers),
                                        "Fraksi marker [n] yang menunjuk ke sitasi ke-n dengan overlap token >= 0.3 terhadap kalimatnya", n=tot_markers),
        "evidence_span_F1": metric(span_f1,
                                   "F1 sentence-level (micro): kalimat jawaban factual vs kalimat evidence_spans/evidence_text GT",
                                   n={"gt_sentences": gt_sent_total, "answer_factual_sentences": ans_sent_factual}),
        "evidence_span_precision": metric(span_prec, "Kalimat jawaban factual yang cocok dengan kalimat bukti GT", n=ans_sent_factual),
        "evidence_span_recall": metric(span_rec, "Kalimat bukti GT yang muncul di jawaban", n=gt_sent_total),
        "quote_validity": metric(ratio(tot_quotes_valid, tot_cites),
                                 "Fraksi quote sitasi yang merupakan substring teks chunk yang disitasi (whitespace-normalized)", n=tot_cites),
        "inline_ratio": metric(ratio(tot_inline_marked, tot_inline_sents),
                               "Fraksi kalimat jawaban yang memuat marker sitasi inline", n=tot_inline_sents),
        "end_dump_rate": metric(ratio(end_dump, len(cases)),
                                "Fraksi jawaban yang memuat sitasi HANYA sebagai daftar akhir (tanpa marker inline)", n=len(cases)),
        "over_citation_rate": metric(ratio(over_cite, len(cases)),
                                     "Fraksi jawaban dengan jumlah chunk berbeda > |source_sections|+1 (heuristik sitasi berlebih)", n=len(cases)),
        "citation_source_accuracy": metric(ratio(tot_cites_source_ok, tot_cites),
                                           "Fraksi sitasi yang gt_section-nya masuk source_sections GT", n=tot_cites),
        "citation_grounding_accuracy": metric(ratio(tot_cites_grounded, tot_cites),
                                              "Fraksi sitasi yang chunk-nya benar-benar mengandung evidence GT", n=tot_cites),
        "counts": {"evaluated_cases": len(cases), "citations": tot_cites, "inline_markers": tot_markers},
        "caveat": ("Metrik sitasi dihitung pada jawaban mode deterministik yang memakai marker inline [n] "
                   "(bukan daftar 'Sumber:' di akhir, sesuai ADR-OF-11). Kasus abstain dan kasus tanpa "
                   "sitasi dikecualikan dari denominator sitasi. attribution_precision mengasumsikan "
                   "marker [n] menunjuk ke citations[n-1] — sesuai kontrak UI. PIPELINE_MAP.md (architect) "
                   "mencatat risiko drift: composer memakai idx+1 dari excerpts yang sudah di-filter/dedup, "
                   "sehingga pada input lain marker bisa bergeser dari array citations asli; angka 1.0 di "
                   "baseline ini hanya berlaku untuk 93 kasus yang dievaluasi, bukan jaminan umum."),
    }


# --------------------------------------------------------------------------- #
# per-question projection                                                      #
# --------------------------------------------------------------------------- #
def project_questions(bridge: Dict[str, Any]) -> List[Dict[str, Any]]:
    out = []
    for c in bridge.get("cases", []):
        ans = str(c.get("answer", ""))
        out.append({
            "id": c.get("id"), "caseKey": c.get("caseKey"), "kb": c.get("kb"),
            "split": c.get("split"), "scope": c.get("scope"),
            "question": c.get("question"), "answerability": c.get("answerability"),
            "expected_behavior": c.get("expected_behavior"),
            "ingestMode": c.get("ingestMode"),
            "answer": ans,
            "segments": [
                {"text": s, "inline_citations": [int(m) for m in INLINE_RE.findall(s)]}
                for s in sentences(ans)
            ],
            "citations": c.get("citations", []),
            "retrieved_chunks": {
                variant: [
                    {"rank": r.get("rank"), "chunk_id": r.get("chunk_id"),
                     "gt_section": r.get("gt_section"), "score": r.get("score"),
                     "section_path": r.get("section_path")}
                    for r in (c.get("retrieval", {}).get(variant) or [])
                ]
                for variant in ("raw", "rewritten", "production")
            },
            "abstain": c.get("abstain"), "guardrail": c.get("guardrail"),
            "latency_ms": c.get("latencyMs"), "mode": c.get("mode"),
            "meta": c.get("meta", {}),
            "source_sections": c.get("source_sections", []),
            "key_facts": c.get("key_facts", []),
        })
    return out


# --------------------------------------------------------------------------- #
# bridge runner                                                                #
# --------------------------------------------------------------------------- #
def run_bridge(timeout: int, raw_file: str, extra: Optional[Sequence[str]] = None) -> Tuple[bool, str]:
    os.makedirs(os.path.dirname(raw_file), exist_ok=True)
    if os.path.exists(raw_file):
        os.remove(raw_file)
    extra = list(extra or [])
    if os.path.exists(SAFE_EXEC):
        cmd = [sys.executable, SAFE_EXEC, "--timeout", str(timeout), "--",
               "node", BRIDGE, "--out", raw_file, "--timeout", str((timeout - 30) * 1000)] + extra
    else:  # fallback terkontrol bila wrapper global tidak tersedia
        cmd = ["node", BRIDGE, "--out", raw_file, "--timeout", str((timeout - 30) * 1000)] + extra
    print(f"[qa] bridge cmd: {' '.join(cmd[:6])} ...", flush=True)
    try:
        proc = subprocess.run(cmd, cwd=REPO_ROOT, capture_output=True, text=True,
                              timeout=timeout + 30, encoding="utf-8", errors="replace")
    except subprocess.TimeoutExpired:
        return False, f"bridge timeout setelah {timeout}s"
    tail = "\n".join((proc.stdout or "").splitlines()[-20:] + (proc.stderr or "").splitlines()[-20:])
    if proc.returncode != 0 or not os.path.exists(raw_file):
        return False, f"bridge exit={proc.returncode}\n{tail}"
    return True, tail


# --------------------------------------------------------------------------- #
# gap reporting (QA-only, tidak mengubah metrik/tuning)                        #
# --------------------------------------------------------------------------- #
def compute_gap(current: Dict[str, Any], baseline: Dict[str, Any]) -> Dict[str, Any]:
    """Selisih metrik numerik current vs baseline 4-dokumen KB.

    Murni pelaporan: tidak ada ambang, bobot, atau parameter yang diubah.
    delta = current - baseline. Metrik lower-better: false_abstain_rate,
    false_answer_rate, uncited_claim_rate, end_dump_rate, over_citation_rate.
    """
    def numeric_leaves(d: Any) -> Dict[str, float]:
        out: Dict[str, float] = {}
        for k, v in (d or {}).items():
            if isinstance(v, dict) and isinstance(v.get("value"), (int, float)) \
                    and not isinstance(v.get("value"), bool):
                out[k] = float(v["value"])
        return out

    groups: Dict[str, Any] = {}
    for group in ("end_to_end", "citation"):
        cur = numeric_leaves(current.get("metrics", {}).get(group, {}))
        base = numeric_leaves(baseline.get("metrics", {}).get(group, {}))
        groups[group] = {
            k: {"current": cur[k], "baseline": base[k],
                "delta": round(cur[k] - base[k], 6)}
            for k in cur if k in base
        }

    cur_h = current.get("summary", {}).get("headline", {})
    base_h = baseline.get("summary", {}).get("headline", {})
    headline = {
        k: {"current": cur_h[k], "baseline": base_h[k],
            "delta": round(cur_h[k] - base_h[k], 6)}
        for k in cur_h if k in base_h
        and isinstance(cur_h[k], (int, float)) and isinstance(base_h[k], (int, float))
    }

    return {
        "baseline_file": "tanyadata/eval/results/baseline.json",
        "baseline_questions": baseline.get("summary", {}).get("questions"),
        "baseline_label": baseline.get("config", {}).get("label"),
        "direction_note": (
            "delta = current - baseline. Lower-better: false_abstain_rate, "
            "false_answer_rate, uncited_claim_rate, end_dump_rate, over_citation_rate "
            "(delta negatif = lebih baik)."
        ),
        "headline": headline,
        "end_to_end": groups["end_to_end"],
        "citation": groups["citation"],
    }


# --------------------------------------------------------------------------- #
# main                                                                         #
# --------------------------------------------------------------------------- #
def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="QA baseline harness (FASE 1A)")
    parser.add_argument("--timeout", type=int, default=600, help="timeout safe_exec untuk bridge (detik)")
    parser.add_argument("--raw", default=RAW_FILE)
    parser.add_argument("--out", default=BASELINE_FILE)
    parser.add_argument("--skip-bridge", action="store_true", help="pakai bridge_raw.json yang sudah ada")
    # FASE 3 — eksperimen (LODO / transfer set / general questions).
    parser.add_argument("--gt-dir", default=None, help="override direktori GT JSON")
    parser.add_argument("--gt-count", type=int, default=4, help="jumlah file GT yang diharapkan")
    parser.add_argument("--questions", default=None, help="JSON daftar soal eksternal (bukan GT)")
    parser.add_argument("--ingest-kb", default=None, help="koma-terpisah: KB yang diindeks")
    parser.add_argument("--eval-kb", default=None, help="koma-terpisah: KB yang soalnya dijalankan")
    parser.add_argument("--label", default="baseline", help="label eksperimen")
    parser.add_argument("--retrieval-mode", default=None, choices=["fts5", "hybrid", "qdrant"],
                        help="override RETRIEVAL_MODE untuk ablasi (default fts5)")
    # QA-only reporting: selisih metrik vs baseline 4 dokumen KB. TIDAK tuning.
    parser.add_argument("--gap-baseline", default=None,
                        help="path ke baseline.json untuk dihitung gap-nya (pelaporan saja)")
    args = parser.parse_args(argv)

    extra: List[str] = []
    for flag, value in (
        ("--gt-dir", args.gt_dir), ("--gt-count", args.gt_count),
        ("--questions", args.questions), ("--ingest-kb", args.ingest_kb),
        ("--eval-kb", args.eval_kb), ("--label", args.label),
        ("--retrieval-mode", args.retrieval_mode),
    ):
        if value is not None:
            extra += [flag, str(value)]

    if not args.skip_bridge:
        ok, log = run_bridge(args.timeout, args.raw, extra)
        print(log.strip()[-2000:], flush=True)
        if not ok:
            print(f"[qa] BRIDGE_FAILED: {log[-2000:]}", file=sys.stderr, flush=True)
            return 2

    with open(args.raw, "r", encoding="utf-8") as fh:
        bridge = json.load(fh)

    stage = run_all_stage_checks(bridge)
    e2e = check_end_to_end(bridge)
    cit = check_citations(bridge)

    # kumpulkan semua NOT_MEASURED untuk ringkasan
    not_measured_list: List[Dict[str, str]] = []

    def walk(obj: Any, path: str = "") -> None:
        if isinstance(obj, dict):
            if obj.get("value") == "NOT_MEASURED":
                not_measured_list.append({"metric": path, "reason": str(obj.get("reason", ""))})
            for k, v in obj.items():
                walk(v, f"{path}.{k}" if path else str(k))
        elif isinstance(obj, list):
            for i, v in enumerate(obj):
                walk(v, f"{path}[{i}]")

    walk({"stage": stage, "end_to_end": e2e, "citation": cit})

    violations = list(bridge.get("known_violations", []))
    if not any(v.get("id") == "KNOWN_BASELINE_VIOLATION" for v in violations):
        violations.append({
            "id": "KNOWN_BASELINE_VIOLATION",
            "detail": "Tidak ada flag per-KB dari bridge; periksa corpus[].ingest.ingestMode.",
        })

    gt_summary = bridge.get("gt_summary", {})
    report = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "role": "qa", "phase": "P1", "type": "baseline",
        "harness": {
            "run_eval": "tanyadata/eval/run_eval.py",
            "stage_checks": "tanyadata/eval/run_stage_checks.py",
            "bridge": "tanyadata/eval/bridge.mjs",
            "raw_artifact": os.path.relpath(args.raw, REPO_ROOT),
            "mode": "deterministic (LLM_MODE=off, FTS5, tanpa jaringan)",
            "server": "TIDAK ada dev server / HTTP — Node subprocess langsung ke pipeline produksi",
        },
        "config": bridge.get("config", {}),
        "corpus": {
            "gt_summary": gt_summary,
            "ingest": {kb: v.get("ingest") for kb, v in sorted(bridge.get("corpus", {}).items())},
        },
        "known_violations": violations,
        "metrics": {
            "extraction": stage["extraction"],
            "chunking_unit": stage["chunking_unit"],
            "indexing": stage["indexing"],
            "retrieval": stage["retrieval"],
            "end_to_end": e2e,
            "citation": cit,
        },
        "not_measured": not_measured_list,
        "per_question": project_questions(bridge),
        "summary": {
            "questions": gt_summary.get("total_questions"),
            "sections": gt_summary.get("sections"),
            "violations": len(violations),
            "not_measured_metrics": len(not_measured_list),
            "headline": {
                "section_recovery": stage["extraction"]["section_recovery"]["value"],
                "text_fidelity": stage["extraction"]["text_fidelity"]["value"],
                "retrieval_hit_at_1_production": stage["retrieval"]["variants"]["production"]["hit_at_1"],
                "retrieval_hit_at_1_raw": stage["retrieval"]["variants"]["raw"]["hit_at_1"],
                "false_abstain_rate": e2e["false_abstain_rate"]["value"],
                "false_answer_rate": e2e["false_answer_rate"]["value"],
                "key_fact_coverage": e2e["key_fact_coverage"]["value"],
                "citation_source_accuracy": cit["citation_source_accuracy"]["value"],
                "quote_validity": cit["quote_validity"]["value"],
            },
        },
    }

    if args.gap_baseline:
        with open(args.gap_baseline, "r", encoding="utf-8") as fh:
            baseline = json.load(fh)
        report["gap_vs_4kb_baseline"] = compute_gap(report, baseline)

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(report, fh, ensure_ascii=False, indent=2)
        fh.write("\n")

    h = report["summary"]["headline"]
    print("QA BASELINE (FASE 1A) — deterministik, pipeline produksi")
    print(f"  soal={report['summary']['questions']} bagian={report['summary']['sections']} "
          f"violation={report['summary']['violations']} NOT_MEASURED={report['summary']['not_measured_metrics']}")
    print(f"  ekstraksi: section_recovery={h['section_recovery']} text_fidelity={h['text_fidelity']}")
    print(f"  retrieval hit@1: production={h['retrieval_hit_at_1_production']} raw={h['retrieval_hit_at_1_raw']}")
    print(f"  e2e: false_abstain={h['false_abstain_rate']} false_answer={h['false_answer_rate']} kf_cov={h['key_fact_coverage']}")
    print(f"  sitasi: source_acc={h['citation_source_accuracy']} quote_valid={h['quote_validity']}")
    print(f"  artefak: {os.path.relpath(args.out, REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
