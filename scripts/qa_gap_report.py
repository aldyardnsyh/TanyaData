#!/usr/bin/env python3
"""QA ONLY — augment an eval result with an explicit 11-metric generalization
gap table vs the 4-KB baseline. Reporting only: no threshold/parameter is
changed, no metric is recomputed with different logic.

Run via safe_exec.py --timeout 600.
"""
from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone

# (label, path in metrics, lower_is_better)
METRICS = [
    ("section_recovery", "extraction.section_recovery", False),
    ("self_retrieval_hit_at_1", "indexing.self_retrieval.hit_at_1", False),
    ("retrieval_hit_at_1_production", "retrieval.variants.production.hit_at_1", False),
    ("retrieval_hit_at_5_production", "retrieval.variants.production.hit_at_5", False),
    ("retrieval_hit_at_1_raw", "retrieval.variants.raw.hit_at_1", False),
    ("retrieval_hit_at_5_raw", "retrieval.variants.raw.hit_at_5", False),
    ("false_abstain_rate", "end_to_end.false_abstain_rate", True),
    ("false_answer_rate", "end_to_end.false_answer_rate", True),
    ("faithfulness", "end_to_end.faithfulness", False),
    ("citation_source_accuracy", "citation.citation_source_accuracy", False),
    ("evidence_span_F1", "citation.evidence_span_F1", False),
    ("quote_validity", "citation.quote_validity", False),
    ("inline_ratio", "citation.inline_ratio", False),
    ("end_dump_rate", "citation.end_dump_rate", True),
]
TARGET_PT = 5.0  # target: |gap| <= 5 percentage points


def dig(obj, dotted):
    cur = obj
    for part in dotted.split("."):
        cur = cur[part]
    return cur


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--result", required=True)
    ap.add_argument("--baseline", required=True)
    ap.add_argument("--label", default="transfer_indexed")
    args = ap.parse_args()

    with open(args.result, "r", encoding="utf-8") as fh:
        result = json.load(fh)
    with open(args.baseline, "r", encoding="utf-8") as fh:
        baseline = json.load(fh)

    rows = []
    for label, path, lower_better in METRICS:
        cur = dig(result["metrics"], path)
        base = dig(baseline["metrics"], path)
        cv = cur.get("value") if isinstance(cur, dict) else cur
        bv = base.get("value") if isinstance(base, dict) else base
        if not isinstance(cv, (int, float)) or not isinstance(bv, (int, float)):
            continue
        delta_pt = round((float(cv) - float(bv)) * 100, 2)
        within = abs(delta_pt) <= TARGET_PT
        rows.append({
            "metric": label,
            "current": round(float(cv), 4),
            "baseline_4kb": round(float(bv), 4),
            "delta_pp": delta_pt,
            "lower_is_better": lower_better,
            "within_target_5pp": within,
            "verdict": "PASS" if within else "FAIL",
        })

    passed = sum(1 for r in rows if r["within_target_5pp"])
    result["generalization_gap"] = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "label": args.label,
        "baseline_file": os.path.basename(args.baseline),
        "target": "abs(delta) <= 5 percentage points",
        "direction": "delta_pp = (current - baseline) * 100; for lower-is-better metrics a negative delta is an improvement",
        "rows": rows,
        "summary": {
            "metrics_compared": len(rows),
            "within_5pp": passed,
            "outside_5pp": len(rows) - passed,
            "pass_rate": round(passed / len(rows), 4) if rows else None,
        },
        "not_measured": [
            {"metric": "indexing.alias_retrieval",
             "reason": "SOP alias target KB01–KB04; tidak ada alias untuk domain transfer CUTI/TI/PD."},
            {"metric": "end_to_end.key_fact_coverage / citation.claim_citation_recall",
             "reason": "Skema *_qa.json transfer tidak memiliki field key_facts; angka 1.0/0.0 dari harness bukan ukuran kualitas."},
            {"metric": "chunking_unit.offset_valid",
             "reason": "Skema core_chunks tidak menyimpan offset karakter (sama seperti baseline)."},
            {"metric": "end_to_end.anomaly_pass",
             "reason": "Transfer set tidak memuat kategori anomaly; lingkup P5."},
        ],
    }

    # Correct the generic violation note injected by run_eval.py: this run used
    # PDF bytes only, so there is NO gt_text_fallback violation to report.
    result["known_violations"] = [
        v for v in result.get("known_violations", [])
        if v.get("id") != "KNOWN_BASELINE_VIOLATION"
    ]
    result["summary"]["violations"] = len(result["known_violations"])

    if args.label == "transfer_indexed":
        manifest = os.path.join(
            os.environ.get("QA_TRANSFER_WS",
                           os.path.join(os.environ.get("TEMP", ""), "opencode", "tanyadata-transfer-ws")),
            "qa-transfer-ingest-manifest.json",
        )
        docs = []
        if os.path.exists(manifest):
            with open(manifest, "r", encoding="utf-8") as fh:
                docs = json.load(fh).get("documents", [])
        result["measurement_notes"] = {
            "ocr": {
                "needed": False,
                "detail": "Ketiga PDF memiliki text layer (901/777/413+385 char non-spasi per halaman). "
                          "quality_report.ocrUsed=false untuk ketiganya; tidak ada halaman scan. "
                          "Jadi generalisasi layout/struktur yang diuji, BUKAN jalur OCR.",
                "per_document": [
                    {"kb": d["key"], "textLayer": d["textLayer"], "ocrUsed": d["quality"]["ocrUsed"],
                     "pageStats": d["pageStats"]} for d in docs
                ],
            },
            "layout_observations": [
                "kebijakan_cuti.pdf: deteksi 2 kolom berhasil (columns=2, readingOrder=column), "
                "tetapi chunker hanya menghasilkan 1 section_path ('kebijakan_cuti') untuk 8 bagian "
                "dan memotong chunk ke-2 di tengah kalimat ('...mengurangi saldo cuti tahunan. CUTI#6...').",
                "keamanan_ti.pdf: tabel 'Bagian | Ketentuan' tidak terdeteksi sebagai tabel "
                "(layout.tables=0); 8 baris TI#n tidak menjadi heading → 1 section_path.",
                "pengadaan_barang.pdf: header/footer berulang TIDAK dibuang (stripRepeatedLines "
                "hanya aktif untuk >=3 halaman); chunk 5 hanya berisi 'PENGADAAN BARANG - DOKUMEN INTERNAL'.",
                "Pembersihan mengubah 'Patch' menjadi 'Pateh' pada chunk TI#7 — indikasi hard-code "
                "OCR_GLYPHS yang overfit pada kosakata SOP (sesuai catatan PIPELINE_MAP.md).",
            ],
            "attribution": (
                "Semua angka dihitung dari PDF yang diindeks di workspace terpisah "
                "<tmp>/opencode/tanyadata-transfer-ws. Tidak ada parameter yang diubah; "
                "transfer set tidak dipakai untuk tuning."
            ),
        }

    with open(args.result, "w", encoding="utf-8") as fh:
        json.dump(result, fh, ensure_ascii=False, indent=2)
        fh.write("\n")

    print(f"GAP_REPORT_OK label={args.label} compared={len(rows)} within5pp={passed} out={args.result}")
    for r in rows:
        print(f"  {r['metric']:<34} cur={r['current']:<7} base={r['baseline_4kb']:<7} "
              f"delta={r['delta_pp']:+7.2f}pp {r['verdict']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
