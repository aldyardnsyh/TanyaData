"""
OCR microservice — PP-OCRv6 tiny lewat `onnxocr` (ONNX Runtime saja, TANPA PaddlePaddle).

Rujukan: DECISION-034, ADR-11 (CORE_V2_ARCHITECTURE §2), kontrak HTTP di
`tanyadata/lib/ingest/ocr.ts:120-170`.

Aturan keras:
- Bind loopback. Port 6334 HANYA di-publish ke 127.0.0.1 oleh docker-compose.
- Model dimuat sekali (lazy singleton) saat startup — bukan per request.
- Konkurensi = 1: asyncio.Lock untuk admission + threading.Lock di worker.
- Timeout inference < 5 s (client OCR_TIMEOUT_MS) agar service sempat balas 504.
- TIDAK PERNAH menulis base64, piksel, atau teks hasil ke log. Hanya ukuran
  byte, nomor halaman, jumlah baris, confidence, latency, dan kode error.
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import hmac
import io
import logging
import os
import threading
import time
from contextlib import asynccontextmanager
from typing import Any

import numpy as np
from fastapi import FastAPI, Header, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from PIL import Image
from pydantic import BaseModel, Field

LOG = logging.getLogger("tanyadata.ocr")
logging.basicConfig(
    level=os.getenv("OCR_LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)

# --- Konfigurasi (semua dari env; tidak ada secret hardcode) -----------------
MAX_IMAGE_BYTES = int(os.getenv("OCR_MAX_IMAGE_BYTES", str(2 * 1024 * 1024)))
INFERENCE_TIMEOUT_S = float(os.getenv("OCR_TIMEOUT_S", "20.0"))
API_KEY = os.getenv("OCR_API_KEY", "")
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
# Preprocessing gambar (DECISION-034 lanjutan): grayscale + threshold adaptif +
# upscale untuk halaman kecil. Menonaktifkan deteksi otomatis bila 0.
PREPROCESS = os.getenv("OCR_PREPROCESS", "1") not in ("0", "false", "off")
UPSCALE_MIN_W = int(os.getenv("OCR_UPSCALE_MIN_WIDTH", "1400"))
UPSCALE_MAX_W = int(os.getenv("OCR_UPSCALE_MAX_WIDTH", "3200"))


def _binarize(arr: np.ndarray) -> np.ndarray | None:
    """Grayscale + threshold adaptif + auto-invert. None bila cv2 tidak ada."""
    try:
        import cv2

        gray = cv2.cvtColor(arr, cv2.COLOR_RGB2GRAY)
        if float(np.mean(gray)) < 110.0:
            gray = cv2.bitwise_not(gray)
        if float(np.std(gray)) > 12.0:
            return cv2.adaptiveThreshold(
                gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 15
            )
        _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        return binary
    except Exception:
        return None


def _column_splits(binary: np.ndarray) -> list[tuple[int, int]]:
    """Deteksi kolom dari proyeksi piksel (ink density), BUKAN dari box OCR.

    PP-OCR tiny sering MENYATUKAN baris dua kolom menjadi satu box lintas
    gutter — deteksi dari box tidak mungkin berhasil (terukur: 25/47 box
    melintasi zona tengah, gap bersih hanya 17 px). Sebaliknya, gutter dua
    kolom terlihat jelas pada proyeksi vertikal gambar biner: kolom x dengan
    density tinta ~0 secara berurutan. Kembalikan list crop (x0, x1) per
    kolom, terurut kiri→kanan; satu elemen = linear.
    """
    h, w = binary.shape
    if w < 300:
        return [(0, w)]
    # Piksel tinta = gelap (0). Density per kolom x.
    ink = (binary < 128).sum(axis=0).astype(np.float64)
    # Smoothing rolling 3% width agar noise satu-piksel tidak memecah lembah.
    win = max(3, int(w * 0.03))
    kernel = np.ones(win) / win
    smooth = np.convolve(ink, kernel, mode="same")
    peak = float(smooth.max()) or 1.0
    # 2% terlalu ketat untuk scan (noise threshold adaptif meninggalkan bintik
    # di gutter); terukur: gutter nyata KB01 ≈ 6% dari peak → 10% memisahkan
    # gutter (rel 0.01-0.07) dari badan teks (rel > 0.15).
    empty = smooth < peak * 0.10  # ~kosong (margin bawah noise threshold)
    # Lembah kosong di zona tengah (25–75%) dengan lebar >= 2.5% width.
    runs: list[tuple[int, int]] = []
    start: int | None = None
    for i, is_empty in enumerate(empty):
        if is_empty and start is None:
            start = i
        elif not is_empty and start is not None:
            runs.append((start, i - 1))
            start = None
    if start is not None:
        runs.append((start, w - 1))
    mid_runs = [
        r for r in runs
        if 0.25 < (r[0] + r[1]) / 2 / w < 0.75 and (r[1] - r[0] + 1) >= w * 0.025
    ]
    if not mid_runs:
        return [(0, w)]
    # Gunakan lembah TERLEBAR (paling aman) sebagai pemisah kolom.
    split = max(mid_runs, key=lambda r: r[1] - r[0])
    mid = (split[0] + split[1]) // 2
    return [(0, mid), (mid, w)]


def _preprocess_crop(binary: np.ndarray, x0: int, x1: int) -> np.ndarray:
    """Crop satu kolom dari gambar biner + upscale bila perlu. → BGR 3-kanal."""
    import cv2

    crop = binary[:, x0:x1]
    h, w = crop.shape
    if w < UPSCALE_MIN_W and w * 2 <= UPSCALE_MAX_W:
        crop = cv2.resize(crop, (w * 2, h * 2), interpolation=cv2.INTER_CUBIC)
    return cv2.cvtColor(crop, cv2.COLOR_GRAY2BGR)

# --- State model: lazy singleton, dimuat sekali ------------------------------
_model: Any = None
_model_error: str | None = None
_admit_lock = asyncio.Lock()     # konkurensi = 1 pada pintu masuk request
_infer_lock = threading.Lock()   # pengaman keras: satu thread inference aktif


def _load_model() -> Any:
    """Muat PP-OCRv6 tiny sekali. Idempoten. Dipanggil dari startup dan worker."""
    global _model, _model_error
    if _model is not None:
        return _model
    try:
        from onnxocr.onnx_paddleocr import ONNXPaddleOcr

        # tiny saja. small/medium melebihi budget VPS 2 GB (DECISION-034).
        _model = ONNXPaddleOcr(ocr_model_size="tiny", use_angle_cls=False, use_gpu=False)
        _model_error = None
        LOG.info("model loaded: PP-OCRv6 tiny (onnxocr, CPU)")
    except Exception as exc:  # detail internal saja, jangan ke client
        _model_error = f"{type(exc).__name__}: {exc}"
        LOG.error("model load failed: %s", _model_error)
        raise
    return _model


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Muat model sekali saat startup agar request pertama bukan cold start."""
    try:
        await asyncio.to_thread(_load_model)
    except Exception:
        LOG.error("service starting without usable model; /healthz will report 503")
    yield


app = FastAPI(title="tanyadata-ocr", version="1.0.0", lifespan=lifespan)


# --- Request / response ------------------------------------------------------
class OcrRequest(BaseModel):
    # base64 dari PNG ≤ 2 MB ≈ 2,8 juta karakter. Batasi juga di boundary agar
    # payload jahat tidak menghabiskan RAM sebelum sempat didekode.
    image: str = Field(min_length=1, max_length=4 * ((MAX_IMAGE_BYTES + 2) // 3) + 16)
    page: int = Field(ge=0, le=100_000)
    docId: str = Field(min_length=1, max_length=200)
    width: int = Field(gt=0, le=20_000)
    height: int = Field(gt=0, le=20_000)


def _error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message}})


def _authorized(authorization: str | None) -> bool:
    if not API_KEY:
        return True  # service loopback tanpa kredensial (mode lokal)
    if not authorization or not authorization.startswith("Bearer "):
        return False
    return hmac.compare_digest(authorization[len("Bearer ") :], API_KEY)


def _parse_item(node: Any) -> tuple[str, Any] | None:
    """Kenali satu hasil onnxocr: (box, (text, score))."""
    if (
        isinstance(node, (list, tuple))
        and len(node) == 2
        and isinstance(node[1], (list, tuple))
        and len(node[1]) == 2
        and isinstance(node[1][0], str)
    ):
        return node[1][0], node[1][1]
    return None


def _parse_boxed(node: Any) -> tuple[str, float, list[list[float]]] | None:
    """Kenali satu hasil onnxocr lengkap dengan box: (text, score, box)."""
    if (
        isinstance(node, (list, tuple))
        and len(node) == 2
        and isinstance(node[0], (list, tuple))
        and isinstance(node[1], (list, tuple))
        and len(node[1]) == 2
        and isinstance(node[1][0], str)
    ):
        try:
            score = float(node[1][1])
        except (TypeError, ValueError):
            score = 0.0
        box = [
            [float(p[0]), float(p[1])]
            for p in node[0]
            if isinstance(p, (list, tuple)) and len(p) >= 2
        ]
        return node[1][0], score, box
    return None


def _reading_order(items: list[tuple[str, float, list[list[float]]]]) -> tuple[list[str], int, float | None]:
    """Susun baris OCR sesuai tata letak halaman.

    Dokumen dua kolom (umum di KB/SOP) yang dibaca onnxocr sesuai urutan
    deteksi menyilang antar kolom. Heuristik ini meniru `detectColumnSplit`
    di lib/ingest/extract.ts: cari jurang vertikal di zona tengah halaman
    (30–70% lebar) yang jauh lebih lebar dari celah antar-kata, pastikan zona
    tengah hampir kosong (bukti bimodal), lalu baca kolom KIRI penuh
    (atas→bawah) sebelum kolom KANAN. Baris dalam satu kolom diurutkan dari
    y terbesar (atas) ke y terkecil; baris sejajar dengan x hampir sama
    digabung satu entri agar paragraf tidak terpotong per deteksi box.

    Mengembalikan (baris_terurut, jumlah_kolom, split_x_relatif).
    """
    if len(items) < 4:
        return [t for t, _, _ in items], 1, None

    def _geom(box: list[list[float]]) -> tuple[float, float, float, float]:
        xs = [p[0] for p in box] or [0.0]
        ys = [p[1] for p in box] or [0.0]
        return min(xs), min(ys), max(xs), max(ys)

    geo = [(t, s, box, *_geom(box)) for t, s, box in items if box]
    if len(geo) < 4:
        return [t for t, _, _ in items], 1, None

    lefts = sorted(g[3] for g in geo)
    rights = sorted(g[5] for g in geo)
    page_min, page_max = lefts[0], max(rights[-1], lefts[-1])
    width = page_max - page_min
    if width < 150:
        return [t for t, _, _, *_ in geo], 1, None

    # Kandidat jurang: proyeksikan interval x [left, right] semua box ke satu
    # garis, cari celah terbesar di zona tengah (30–70% lebar) yang tidak
    # dilintasi box mana pun — persis cara detectColumnSplit memakai gap antar
    # titik x yang terurut, tapi antar interval agar tidak salah pada box lebar.
    if page_max <= page_min:
        return [t for t, _, _, *_ in geo], 1, None
    probes = 200
    covered = [False] * (probes + 1)
    for g in geo:
        a = int((g[3] - page_min) / width * probes)
        b = int((g[5] - page_min) / width * probes)
        for i in range(max(0, a), min(probes, b) + 1):
            covered[i] = True
    best_gap, best_x = 0.0, None
    run_start = None
    for i in range(probes + 1):
        if not covered[i]:
            if run_start is None:
                run_start = i
        else:
            if run_start is not None:
                lo, hi = run_start, i - 1
                mid_rel = ((lo + hi) / 2) / probes
                gap = (hi - lo + 1) / probes * width
                if 0.3 < mid_rel < 0.7 and gap > best_gap:
                    best_gap, best_x = gap, page_min + ((lo + hi) / 2) / probes * width
                run_start = None
    if run_start is not None:
        lo, hi = run_start, probes
        mid_rel = ((lo + hi) / 2) / probes
        gap = (hi - lo + 1) / probes * width
        if 0.3 < mid_rel < 0.7 and gap > best_gap:
            best_gap, best_x = gap, page_min + ((lo + hi) / 2) / probes * width
    if best_x is None or best_gap <= max(30.0, width * 0.12):
        return [t for t, _, _, *_ in geo], 1, None

    # Bukti bimodal: zona tengah hampir kosong.
    middle = [
        g for g in geo
        if 0.3 < (g[3] - page_min) / width and (g[5] - page_min) / width < 0.7
        and (g[3] - page_min) / width < 0.7 and (g[5] - page_min) / width > 0.3
    ]
    if len(middle) / len(geo) > 0.15:
        return [t for t, _, _, *_ in geo], 1, None

    # Kolom kiri dulu (atas→bawah), lalu kanan; gabung box sejajar (x & y dekat).
    # CATATAN KOORDINAT: onnxocr memakai koordinat piksel gambar — y KECIL = atas.
    # (Berbeda dari text-layer PDF yang memakai transform[5]: y besar = atas.)
    def _column(column_items: list[tuple]) -> list[str]:
        ordered = sorted(column_items, key=lambda g: (g[4], g[3]))
        lines: list[str] = []
        last_t, last_l, last_y = None, None, None
        for t, _s, _b, l, y, _r, _b2 in ordered:
            if (
                last_t is not None
                and abs(y - last_y) <= 18
                and abs(l - last_l) <= width * 0.15
            ):
                lines[-1] = f"{lines[-1]} {t}".strip()
            else:
                lines.append(t)
            last_t, last_l, last_y = t, l, y
        return [ln.strip() for ln in lines if ln.strip()]

    left_col = [g for g in geo if g[5] <= best_x]
    right_col = [g for g in geo if g[5] > best_x]
    if len(left_col) < 2 or len(right_col) < 2:
        return [t for t, _, _, *_ in geo], 1, None
    return _column(left_col) + _column(right_col), 2, round((best_x - page_min) / width, 3)


def _collect(result: Any) -> tuple[list[str], list[float], int, float | None]:
    """Telusuri hasil onnxocr secara defensif; ambil teks + skor + box,
    lalu susun sesuai tata letak halaman (kolom kiri→kanan)."""
    boxed: list[tuple[str, float, list[list[float]]]] = []
    texts: list[str] = []
    scores: list[float] = []

    def visit(node: Any) -> None:
        if not isinstance(node, (list, tuple)):
            return
        parsed = _parse_boxed(node)
        if parsed is not None:
            text, score, box = parsed
            if text.strip():
                boxed.append((text.strip(), score, box))
                texts.append(text.strip())
                try:
                    scores.append(float(score))
                except (TypeError, ValueError):
                    pass
            return
        for child in node:
            visit(child)

    visit(result)
    if len(boxed) >= 4:
        ordered, columns, split_x = _reading_order(boxed)
        return ordered, scores, columns, split_x
    return texts, scores, 1, None


def _infer(bgr: np.ndarray) -> tuple[list[str], list[float], int, float | None]:
    """Satu inference. threading.Lock menjaga konkurensi=1 walau wait_for membatalkan."""
    with _infer_lock:
        model = _load_model()
        result = model.ocr(bgr)
    return _collect(result)


def _infer_columns(
    arr: np.ndarray,
) -> tuple[list[str], list[float], int, float | None]:
    """OCR sadar-kolom: split dari proyeksi piksel, OCR per kolom terpisah.

    Kolom kiri dibaca penuh (atas→bawah) sebelum kolom kanan — baris tidak
    pernah menyilang antar kolom. Fallback aman: split gagal/1 kolom → OCR
    satu crop penuh (perilaku lama).
    """
    texts: list[str] = []
    scores: list[float] = []
    columns = 1
    split_x: float | None = None
    try:
        binary = _binarize(arr)
        if binary is None:
            return _infer(arr[:, :, ::-1].copy())
        crops = _column_splits(binary)
        for idx, (x0, x1) in enumerate(crops):
            crop_bgr = _preprocess_crop(binary, x0, x1)
            crop_texts, crop_scores, _, _ = _infer(crop_bgr)
            texts.extend(crop_texts)
            scores.extend(crop_scores)
        if len(crops) == 2 and texts:
            columns = 2
            split_x = round((crops[0][1] + crops[1][0]) / 2 / binary.shape[1], 3)
        return texts, scores, columns, split_x
    except Exception as exc:
        LOG.warning("column-aware inference failed (%s) → fallback linear", type(exc).__name__)
        return _infer(arr[:, :, ::-1].copy())


# --- Endpoint ----------------------------------------------------------------
@app.get("/healthz")
async def healthz() -> JSONResponse:
    ready = _model is not None and _model_error is None
    return JSONResponse(
        status_code=200 if ready else 503,
        content={
            "status": "ok" if ready else "unavailable",
            "model": "PP-OCRv6 tiny" if ready else None,
            "concurrency": 1,
        },
    )


@app.post("/ocr")
async def ocr(
    req: OcrRequest,
    request: Request,
    authorization: str | None = Header(default=None),
) -> JSONResponse:
    started = time.perf_counter()

    if not _authorized(authorization):
        LOG.warning("auth rejected status=401 path=%s", request.url.path)
        return _error(401, "unauthorized", "Missing or invalid bearer token")

    try:
        raw = base64.b64decode(req.image, validate=True)
    except (binascii.Error, ValueError):
        LOG.warning("invalid base64 status=400 page=%s", req.page)
        return _error(400, "invalid_image", "image must be valid base64")

    if not raw or len(raw) > MAX_IMAGE_BYTES:
        LOG.warning("image size rejected status=413 page=%s bytes=%d", req.page, len(raw))
        return _error(413, "image_too_large", f"decoded image exceeds {MAX_IMAGE_BYTES} bytes")

    if not raw.startswith(PNG_MAGIC):
        LOG.warning("unsupported image status=415 page=%s bytes=%d", req.page, len(raw))
        return _error(415, "unsupported_image", "image must be PNG")

    try:
        with Image.open(io.BytesIO(raw)) as image:
            image.load()
            if image.format != "PNG":
                return _error(415, "unsupported_image", "image must be PNG")
            rgb = image.convert("RGB")
            arr = np.asarray(rgb, dtype=np.uint8)
    except Exception:
        LOG.warning("undecodable png status=400 page=%s bytes=%d", req.page, len(raw))
        return _error(400, "invalid_image", "image is not a decodable PNG")

    # OCR sadar-kolom: binarisasi → split dari proyeksi piksel → OCR per kolom
    # (kiri penuh dulu). Fallback otomatis ke linear bila deteksi gagal.
    try:
        if PREPROCESS:
            texts, scores, columns, split_x = await asyncio.wait_for(
                asyncio.to_thread(_infer_columns, arr), timeout=INFERENCE_TIMEOUT_S
            )
        else:
            texts, scores, columns, split_x = await asyncio.wait_for(
                asyncio.to_thread(_infer, arr[:, :, ::-1].copy()), timeout=INFERENCE_TIMEOUT_S
            )
    except asyncio.TimeoutError:
        LOG.warning("ocr timeout status=504 page=%s bytes=%d", req.page, len(raw))
        return _error(504, "inference_timeout", "OCR inference timed out")
    except Exception as exc:
        LOG.error("ocr inference failed status=503 page=%s type=%s", req.page, type(exc).__name__)
        return _error(503, "model_unavailable", "OCR model is unavailable")

    text = "\n".join(texts)
    confidence = round(sum(scores) / len(scores), 4) if scores else 0.0
    LOG.info(
        "ocr ok page=%s bytes=%d lines=%d columns=%d confidence=%.4f latency_ms=%d",
        req.page,
        len(raw),
        len(texts),
        columns,
        confidence,
        int((time.perf_counter() - started) * 1000),
    )
    return JSONResponse(
        content={
            "text": text,
            "confidence": confidence,
            "page": req.page,
            # Metadata tata letak (reading order): 1 = linear, 2 = dua kolom
            # (baca kiri penuh dulu). Konsumen ingest menyimpannya di layout_json.
            "columns": columns,
            "columnSplitX": split_x,
        }
    )


# --- Error handling seragam: tanpa stack trace ke client ---------------------
@app.exception_handler(RequestValidationError)
async def validation_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    LOG.warning("invalid request status=400 path=%s", request.url.path)
    return _error(400, "invalid_request", "Request body failed validation")


@app.exception_handler(Exception)
async def unhandled_handler(request: Request, exc: Exception) -> JSONResponse:
    LOG.error("unhandled error status=500 path=%s type=%s", request.url.path, type(exc).__name__)
    return _error(500, "internal_error", "Internal server error")

