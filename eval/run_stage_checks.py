#!/usr/bin/env python3
"""
QA baseline — stage checks (FASE 1A).

Modul murni: menerima data mentah dari eval/results/bridge_raw.json (output
eval/bridge.mjs) dan menghitung metrik per tahap:

  * ekstraksi   : section_recovery (32 bagian), reading_order_accuracy,
                  text_fidelity vs corpus_sections (target >= 0.98)
  * chunking    : chunk<->section alignment, unit_segmentation_accuracy,
                  offset_valid (NOT_MEASURED bila skema tidak menyimpan offset)
  * indexing    : self-retrieval hit@1, alias-retrieval hit@1/3/5
  * retrieval   : hit@1/3/5, recall@k, MRR, context_precision, noise_rate
                  untuk tiga varian: raw / rewritten / production

Semua angka dihitung dari output bridge nyata. Tidak ada angka yang
diperkirakan. Metrik yang tidak bisa diukur dari artefak yang tersedia
dicatat sebagai {"value": "NOT_MEASURED", "reason": "..."}.

Dipakai oleh eval/run_eval.py; juga bisa dijalankan sendiri:
  python eval/run_stage_checks.py --raw eval/results/bridge_raw.json \
      --out eval/results/stage_checks.json
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import unicodedata
from collections import defaultdict
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple


# --------------------------------------------------------------------------- #
# helpers                                                                      #
# --------------------------------------------------------------------------- #
def norm(s: Any) -> str:
    s = unicodedata.normalize("NFKD", str(s if s is not None else ""))
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.lower()
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def contains(hay: Any, needle: Any) -> bool:
    n = norm(needle)
    return bool(n) and n in norm(hay)


def tokens(s: Any) -> List[str]:
    return [t for t in norm(s).split() if len(t) >= 3]


def token_set(s: Any) -> set:
    return set(tokens(s))


def mean(values: Sequence[float]) -> float:
    return round(sum(values) / len(values), 4) if values else 0.0


def ratio(num: float, den: float) -> float:
    return round(num / den, 4) if den else 0.0


def metric(value: Any, method: str, *, threshold: Optional[float] = None,
           n: Optional[int] = None, passed: Optional[bool] = None) -> Dict[str, Any]:
    out: Dict[str, Any] = {"value": value, "method": method}
    if n is not None:
        out["n"] = n
    if threshold is not None:
        out["threshold"] = threshold
    if passed is not None:
        out["pass"] = passed
    elif threshold is not None and isinstance(value, (int, float)):
        out["pass"] = bool(value >= threshold)
    return out


def not_measured(reason: str, method: str = "") -> Dict[str, Any]:
    out: Dict[str, Any] = {"value": "NOT_MEASURED", "reason": reason}
    if method:
        out["method"] = method
    return out


def split_by_ingest(rows: Iterable[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    out: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for r in rows:
        out[str(r.get("ingestMode", "unknown"))].append(r)
    return dict(out)


# --------------------------------------------------------------------------- #
# extraction                                                                   #
# --------------------------------------------------------------------------- #
def match_gt_to_extracted(gt_sections: Sequence[Dict[str, Any]],
                          extracted: Sequence[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """Pasangkan section GT ke section hasil ekstraksi produksi.

    Cocokkan judul GT (dinormalisasi) di dalam section_path ekstraksi; bila
    gagal, coba '<number>. <title>' dan akhirnya nomor saja. Satu GT section
    hanya boleh dipetakan ke satu extracted section (first best wins).
    """
    used = set()
    mapping: Dict[str, Dict[str, Any]] = {}
    for gt in gt_sections:
        sid = str(gt.get("section_id", ""))
        title = norm(gt.get("title", ""))
        number = str(gt.get("number", "")).strip()
        best = None
        for idx, ex in enumerate(extracted):
            if idx in used:
                continue
            path = norm(ex.get("section_path", ""))
            if not path:
                continue
            if title and title in path:
                best = idx
                break
            numbered = norm(f"{number}. {gt.get('title', '')}")
            if numbered and numbered == path:
                best = idx
                break
        if best is None and number:
            for idx, ex in enumerate(extracted):
                if idx in used:
                    continue
                if re.match(rf"^{re.escape(number)}[\.\s]", str(ex.get("section_path", "")).strip()):
                    best = idx
                    break
        if best is not None:
            used.add(best)
            mapping[sid] = extracted[best]
    return mapping


def fidelity(gt_text: Any, ex_text: Any) -> float:
    """Token recall dari teks GT di teks ekstraksi (0..1)."""
    need = token_set(gt_text)
    if not need:
        return 1.0
    have = token_set(ex_text)
    return ratio(len(need & have), len(need))


def check_extraction(bridge: Dict[str, Any]) -> Dict[str, Any]:
    per_kb: Dict[str, Any] = {}
    all_fidelity: List[float] = []
    recovered = 0
    total_sections = 0
    order_pairs_ok = 0
    order_pairs_total = 0

    for kb, info in sorted(bridge.get("corpus", {}).items()):
        gt_sections = info.get("gt_sections", [])
        extracted = info.get("extracted_sections", [])
        mapping = match_gt_to_extracted(gt_sections, extracted)
        kb_fid: List[float] = []
        positions: Dict[str, int] = {}
        for pos, ex in enumerate(extracted):
            for sid, mapped in mapping.items():
                if mapped is ex:
                    positions[sid] = pos
        for gt in gt_sections:
            sid = str(gt.get("section_id", ""))
            total_sections += 1
            if sid in mapping:
                recovered += 1
                f = fidelity(gt.get("text", ""), mapping[sid].get("text", ""))
                kb_fid.append(f)
                all_fidelity.append(f)
        # urutan baca: pasangan bersebelahan menurut nomor GT
        ordered = sorted(gt_sections, key=lambda s: int(s.get("number", 0) or 0))
        sids = [str(s.get("section_id", "")) for s in ordered if str(s.get("section_id", "")) in positions]
        for a, b in zip(sids, sids[1:]):
            order_pairs_total += 1
            if positions[a] < positions[b]:
                order_pairs_ok += 1
        per_kb[kb] = {
            "ingestMode": info.get("ingest", {}).get("ingestMode"),
            "gt_sections": len(gt_sections),
            "extracted_sections": len(extracted),
            "recovered": len([s for s in gt_sections if str(s.get("section_id", "")) in mapping]),
            "section_recovery": ratio(len([s for s in gt_sections if str(s.get("section_id", "")) in mapping]), len(gt_sections)),
            "text_fidelity": mean(kb_fid),
            "reading_order_accuracy": ratio(
                sum(1 for a, b in zip(
                    [str(s.get("section_id", "")) for s in ordered if str(s.get("section_id", "")) in positions],
                    [str(s.get("section_id", "")) for s in ordered if str(s.get("section_id", "")) in positions][1:])
                    if positions[a] < positions[b]),
                max(0, len([s for s in ordered if str(s.get("section_id", "")) in positions]) - 1),
            ),
        }

    rec = ratio(recovered, total_sections)
    fid = mean(all_fidelity)
    order = ratio(order_pairs_ok, order_pairs_total)
    fallback_kbs = [kb for kb, v in per_kb.items() if v.get("ingestMode") == "gt_text_fallback"]
    return {
        "section_recovery": metric(rec, "GT section_id yang berhasil dipetakan ke section_path hasil ekstraksi produksi / 32", threshold=1.0, n=total_sections),
        "reading_order_accuracy": metric(order, "Fraksi pasangan section GT bersebelahan yang muncul dalam urutan relatif sama di ekstraksi", threshold=1.0, n=order_pairs_total),
        "text_fidelity": metric(fid, "Rata-rata token-recall teks GT pada teks ekstraksi yang dipetakan", threshold=0.98, n=len(all_fidelity)),
        "per_kb": per_kb,
        "interpretation": {
            "fallback_kbs": fallback_kbs,
            "note": ("Angka ekstraksi untuk KB di atas SENGAJA mendekati 1.0 karena korpusnya "
                     "direkonstruksi dari corpus_sections GT (KNOWN_BASELINE_VIOLATION). "
                     "Jangan dipakai sebagai bukti kualitas ekstraksi PDF. Gunakan per-KB "
                     "ingestMode='pdf' (KB02/KB03) sebagai ukuran jujur."),
        },
    }


# --------------------------------------------------------------------------- #
# chunking / unit                                                              #
# --------------------------------------------------------------------------- #
def check_chunking(bridge: Dict[str, Any], extraction: Dict[str, Any]) -> Dict[str, Any]:
    chunks = bridge.get("chunks_by_id", {})
    aligned = sum(1 for c in chunks.values() if c.get("gt_section"))
    total = len(chunks)

    # unit segmentation: tiap GT section harus punya tepat satu unit ekstraksi
    # dengan teks yang fidel (>= 0.98 token recall).
    good_units = 0
    total_units = 0
    per_kb: Dict[str, Any] = {}
    for kb, info in sorted(bridge.get("corpus", {}).items()):
        gt_sections = info.get("gt_sections", [])
        extracted = info.get("extracted_sections", [])
        mapping = match_gt_to_extracted(gt_sections, extracted)
        kb_good = 0
        for gt in gt_sections:
            sid = str(gt.get("section_id", ""))
            total_units += 1
            ex = mapping.get(sid)
            if ex is not None and fidelity(gt.get("text", ""), ex.get("text", "")) >= 0.98:
                kb_good += 1
                good_units += 1
        per_kb[kb] = {
            "ingestMode": info.get("ingest", {}).get("ingestMode"),
            "gt_sections": len(gt_sections), "good_units": kb_good,
            "unit_segmentation_accuracy": ratio(kb_good, len(gt_sections)),
        }

    observed_columns = sorted({k for c in chunks.values() for k in c.keys()})
    has_offsets = any(k in observed_columns for k in ("char_start", "char_end", "start_offset", "end_offset"))
    if has_offsets:
        valid = sum(
            1 for c in chunks.values()
            if isinstance(c.get("char_start"), int) and isinstance(c.get("char_end"), int)
            and 0 <= c["char_start"] < c["char_end"]
        )
        offset_metric = metric(ratio(valid, total), "char_start < char_end dan berada dalam batas dokumen", n=total)
    else:
        offset_metric = not_measured(
            "Skema produksi core_chunks tidak menyimpan offset karakter "
            "(hanya char_count/token_count/page_span). Mengukur offset valid "
            "mensyaratkan perubahan kode aplikasi — dilarang di Fase 1A.",
            method="Cek kolom offset pada artefak chunks_by_id hasil pipeline produksi",
        )

    return {
        "chunk_section_alignment": metric(ratio(aligned, total), "Fraksi chunk produksi yang berhasil dipetakan ke section_id GT via anchor teks", n=total),
        "unit_segmentation_accuracy": metric(ratio(good_units, total_units), "Fraksi 32 GT section yang memiliki unit ekstraksi terpetakan dengan token-recall >= 0.98 (mapping GT->ekstraksi one-to-one by konstruksi)", threshold=0.98, n=total_units),
        "offset_valid": offset_metric,
        "observed_chunk_columns": observed_columns,
        "per_kb": per_kb,
    }


# --------------------------------------------------------------------------- #
# indexing                                                                     #
# --------------------------------------------------------------------------- #
def _agg_hits(rows: Sequence[Dict[str, Any]], keys: Sequence[str]) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for key in keys:
        vals = [bool(r.get(key)) for r in rows]
        out[key] = metric(ratio(sum(vals), len(vals)), f"Fraksi entri dengan {key}=true dari retrieval produksi", n=len(vals))
    return out


def check_indexing(bridge: Dict[str, Any]) -> Dict[str, Any]:
    idx = bridge.get("indexing", {})
    self_rows = idx.get("self_retrieval", [])
    alias_rows = idx.get("alias_retrieval", [])

    self_all = _agg_hits(self_rows, ["hit_at_1", "hit_at_5"])
    alias_all = _agg_hits(alias_rows, ["hit_at_1", "hit_at_3", "hit_at_5"])

    def by_mode(rows: Sequence[Dict[str, Any]], keys: Sequence[str]) -> Dict[str, Any]:
        out: Dict[str, Any] = {}
        for mode, group in split_by_ingest(rows).items():
            out[mode] = {"n": len(group), **_agg_hits(group, keys)}
        return out

    return {
        "self_retrieval": {
            **self_all,
            "by_ingest_mode": by_mode(self_rows, ["hit_at_1", "hit_at_5"]),
            "method": "Query = 220 karakter pertama teks GT section; diukur dari searchChunks produksi pada 4 dataset",
        },
        "alias_retrieval": {
            **alias_all,
            "by_ingest_mode": by_mode(alias_rows, ["hit_at_1", "hit_at_3", "hit_at_5"]),
            "method": "Query = alias dari knowledge_tuning_sop.json (dibaca saja); target = section_id alias; diukur dari searchChunks produksi",
            "source": "ai_chatbot_testdata/.../Tuningan Knowledge/knowledge_tuning_sop.json (read-only)",
        },
        "counts": {"self_queries": len(self_rows), "alias_queries": len(alias_rows)},
    }


# --------------------------------------------------------------------------- #
# retrieval                                                                    #
# --------------------------------------------------------------------------- #
VARIANTS = ("raw", "rewritten", "production")


def _relevant_chunk_ids(case: Dict[str, Any], chunks: Dict[str, Any]) -> set:
    expected = set(case.get("source_sections", []))
    return {cid for cid, meta in chunks.items() if meta.get("gt_section") in expected}


def _rank_metrics(ranked: Sequence[Dict[str, Any]], relevant: set, k: int = 5) -> Dict[str, float]:
    top = ranked[:k]
    hits = [i + 1 for i, r in enumerate(top) if str(r.get("chunk_id")) in relevant]
    prec = ratio(len(hits), len(top)) if top else 0.0
    return {
        "hit_at_1": 1.0 if (hits and hits[0] == 1) else 0.0,
        "hit_at_3": 1.0 if any(h <= 3 for h in hits) else 0.0,
        "hit_at_5": 1.0 if bool(hits) else 0.0,
        "recall_at_5": ratio(len(hits), len(relevant)) if relevant else 0.0,
        "mrr": round(1.0 / hits[0], 4) if hits else 0.0,
        "context_precision_at_5": prec,
        "noise_rate_at_5": round(1.0 - prec, 4),
    }


def check_retrieval(bridge: Dict[str, Any]) -> Dict[str, Any]:
    chunks = bridge.get("chunks_by_id", {})
    cases = bridge.get("cases", [])
    answerable = [c for c in cases if c.get("source_sections")]
    abstain_cases = [c for c in cases if not c.get("source_sections")]

    per_variant: Dict[str, Any] = {}
    for variant in VARIANTS:
        rows: List[Dict[str, float]] = []
        by_split: Dict[str, List[Dict[str, float]]] = defaultdict(list)
        for case in answerable:
            relevant = _relevant_chunk_ids(case, chunks)
            ranked = (case.get("retrieval", {}).get(variant) or [])
            m = _rank_metrics(ranked, relevant, k=5)
            rows.append(m)
            by_split[str(case.get("split", "unknown"))].append(m)
        keys = ["hit_at_1", "hit_at_3", "hit_at_5", "recall_at_5", "mrr", "context_precision_at_5", "noise_rate_at_5"]
        agg = {key: mean([r[key] for r in rows]) for key in keys}
        agg["n"] = len(rows)
        agg["by_split"] = {
            sp: {"n": len(v), **{key: mean([r[key] for r in v]) for key in keys}}
            for sp, v in sorted(by_split.items())
        }
        per_variant[variant] = agg

    delta = {
        "production_minus_raw": {
            key: round(per_variant["production"][key] - per_variant["raw"][key], 4)
            for key in ["hit_at_1", "hit_at_3", "hit_at_5", "recall_at_5", "mrr", "context_precision_at_5"]
        },
        "rewritten_minus_raw": {
            key: round(per_variant["rewritten"][key] - per_variant["raw"][key], 4)
            for key in ["hit_at_1", "hit_at_3", "hit_at_5", "recall_at_5", "mrr", "context_precision_at_5"]
        },
    }

    return {
        "variants": per_variant,
        "delta": delta,
        "method": {
            "relevant": "chunk produksi yang gt_section-nya masuk case.source_sections (GT)",
            "raw": "searchChunks(question, limit=20) — tanpa rewriting, tanpa entity boost/evidence gate",
            "rewritten": "correctQueryWithVocabulary(...) lalu searchChunks(..., limit=20) — rewriting saja",
            "production": "retrieveWithEntityBoost(..., limit=20) — jalur produksi (entity boost + evidence gate)",
            "hit@k": "fraksi soal dengan >=1 chunk relevan di top-k",
            "recall@5": "fraksi chunk relevan yang muncul di top-5",
            "mrr": "1/(peringkat relevan pertama), 0 bila tidak ada",
            "context_precision@5": "fraksi top-5 yang relevan",
            "noise_rate@5": "1 - context_precision@5",
        },
        "counts": {"answerable_cases": len(answerable), "abstain_cases_excluded": len(abstain_cases)},
        "caveat": ("Perbandingan 'with/without rewriting & rerank' mengisolasi tiga entry point "
                   "yang tersedia di pipeline. answerQuestion juga memanggil rewrite internal; "
                   "tidak ada flag produksi untuk mematikan rewrite tersebut tanpa mengubah kode, "
                   "jadi efek gabungannya tidak diukur terpisah."),
    }


# --------------------------------------------------------------------------- #
# entry point                                                                  #
# --------------------------------------------------------------------------- #
def run_all_stage_checks(bridge: Dict[str, Any]) -> Dict[str, Any]:
    extraction = check_extraction(bridge)
    return {
        "extraction": extraction,
        "chunking_unit": check_chunking(bridge, extraction),
        "indexing": check_indexing(bridge),
        "retrieval": check_retrieval(bridge),
    }


def main(argv: Optional[Sequence[str]] = None) -> int:
    here = os.path.dirname(os.path.abspath(__file__))
    parser = argparse.ArgumentParser(description="QA baseline stage checks")
    parser.add_argument("--raw", default=os.path.join(here, "results", "bridge_raw.json"))
    parser.add_argument("--out", default=os.path.join(here, "results", "stage_checks.json"))
    args = parser.parse_args(argv)
    with open(args.raw, "r", encoding="utf-8") as fh:
        bridge = json.load(fh)
    report = run_all_stage_checks(bridge)
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(report, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    ex = report["extraction"]
    rt = report["retrieval"]["variants"]
    print(f"STAGE_CHECKS_OK extraction.rec={ex['section_recovery']['value']} "
          f"fid={ex['text_fidelity']['value']} order={ex['reading_order_accuracy']['value']} "
          f"retrieval.hit@1(raw/prod)={rt['raw']['hit_at_1']}/{rt['production']['hit_at_1']} "
          f"out={args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
