#!/usr/bin/env python3
"""QA ONLY — Leave-One-Document-Out over KB01..KB04 using the EXISTING harness
flags (--ingest-kb / --eval-kb) in eval/bridge.mjs. No core source is edited.

For each fold: index 3 documents, run only the held-out document's GT questions.
There is NO calibration/tuning step in the locked pipeline — 'calibrate' here
means the 3-document index is the only context available to the engine.

Run via safe_exec.py --timeout 600.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)                       # .../tanyadata
OUTER = os.path.dirname(REPO)                      # project root
RUN_EVAL = os.path.join(REPO, "eval", "run_eval.py")
BASELINE = os.path.join(REPO, "eval", "results", "baseline.json")
RESULTS = os.path.join(REPO, "eval", "results")
KBS = ["KB01", "KB02", "KB03", "KB04"]

FIELDS = [
    ("section_recovery", "extraction.section_recovery"),
    ("self_retrieval_hit_at_1", "indexing.self_retrieval.hit_at_1"),
    ("retrieval_hit_at_1_production", "retrieval.variants.production.hit_at_1"),
    ("retrieval_hit_at_5_production", "retrieval.variants.production.hit_at_5"),
    ("false_abstain_rate", "end_to_end.false_abstain_rate"),
    ("false_answer_rate", "end_to_end.false_answer_rate"),
    ("faithfulness", "end_to_end.faithfulness"),
    ("citation_source_accuracy", "citation.citation_source_accuracy"),
    ("evidence_span_F1", "citation.evidence_span_F1"),
    ("quote_validity", "citation.quote_validity"),
    ("inline_ratio", "citation.inline_ratio"),
    ("end_dump_rate", "citation.end_dump_rate"),
]


def dig(obj, dotted):
    cur = obj
    for part in dotted.split("."):
        cur = cur[part]
    return cur.get("value") if isinstance(cur, dict) else cur


def main() -> int:
    folds = []
    for held in KBS:
        train = [k for k in KBS if k != held]
        raw = os.path.join(RESULTS, f"_lodo_{held}_raw.json")
        out = os.path.join(RESULTS, f"_lodo_{held}.json")
        cmd = [
            sys.executable, RUN_EVAL,
            "--ingest-kb", ",".join(train),
            "--eval-kb", held,
            "--label", f"lodo-{held}",
            "--raw", raw, "--out", out,
            "--gap-baseline", BASELINE,
        ]
        print(f"[lodo] held={held} train={','.join(train)}", flush=True)
        try:
            proc = subprocess.run(cmd, cwd=OUTER, capture_output=True, text=True,
                                  timeout=180, encoding="utf-8", errors="replace")
        except subprocess.TimeoutExpired:
            folds.append({"held_out": held, "status": "TIMEOUT", "train": train})
            print(f"[lodo] {held} TIMEOUT", flush=True)
            continue
        tail = "\n".join((proc.stdout or "").splitlines()[-8:] + (proc.stderr or "").splitlines()[-8:])
        if proc.returncode != 0 or not os.path.exists(out):
            folds.append({"held_out": held, "status": "FAILED", "train": train, "log_tail": tail[-1500:]})
            print(f"[lodo] {held} FAILED rc={proc.returncode}\n{tail[-800:]}", flush=True)
            continue
        with open(out, "r", encoding="utf-8") as fh:
            res = json.load(fh)
        metrics = {}
        for label, path in FIELDS:
            try:
                metrics[label] = dig(res["metrics"], path)
            except (KeyError, TypeError):
                metrics[label] = "NOT_MEASURED"
        folds.append({
            "held_out": held, "train": train, "status": "OK",
            "questions": res.get("summary", {}).get("questions"),
            "sections_indexed": res.get("summary", {}).get("sections"),
            "metrics": metrics,
            "known_violations": res.get("known_violations", []),
            "artifact": os.path.relpath(out, OUTER),
        })
        print(f"[lodo] {held} OK q={folds[-1]['questions']} "
              f"hit@1={metrics['retrieval_hit_at_1_production']} "
              f"FA={metrics['false_abstain_rate']}", flush=True)

    ok = [f for f in folds if f["status"] == "OK"]
    means = {}
    for label, _ in FIELDS:
        vals = [f["metrics"][label] for f in ok if isinstance(f["metrics"].get(label), (int, float))]
        means[label] = round(sum(vals) / len(vals), 4) if vals else "NOT_MEASURED"

    report = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "role": "qa", "phase": "P4", "type": "lodo",
        "method": (
            "Harness bawaan: --ingest-kb = 3 dokumen lain, --eval-kb = dokumen ke-4. "
            "Tidak ada tahap kalibrasi parameter (pipeline terkunci); 3 dokumen adalah "
            "satu-satunya indeks yang tersedia saat soal dokumen ke-4 dijawab."
        ),
        "known_limitation": (
            "KB01 dan KB04 adalah PDF image-only; bila masuk ke set 3 dokumen, bridge "
            "memakai gt_text_fallback (KNOWN_BASELINE_VIOLATION). Fold dengan KB01/KB04 "
            "di training MEWARISI pelanggaran baseline — lihat known_violations per fold."
        ),
        "folds": folds,
        "mean_across_folds": means,
        "summary": {
            "folds_ok": len(ok), "folds_total": len(KBS),
            "status": "PERFORMED" if len(ok) == len(KBS) else "PARTIAL",
        },
    }
    out_path = os.path.join(RESULTS, "lodo.json")
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(report, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    print(f"LODO_OK folds={len(ok)}/{len(KBS)} out={os.path.relpath(out_path, OUTER)}")
    return 0 if ok else 2


if __name__ == "__main__":
    raise SystemExit(main())
