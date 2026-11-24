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
INFERENCE_TIMEOUT_S = float(os.getenv("OCR_TIMEOUT_S", "4.0"))
API_KEY = os.getenv("OCR_API_KEY", "")
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"

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


def _collect(result: Any) -> tuple[list[str], list[float]]:
    """Telusuri hasil onnxocr secara defensif; ambil teks + skor yang valid."""
    texts: list[str] = []
    scores: list[float] = []

    def visit(node: Any) -> None:
        if not isinstance(node, (list, tuple)):
            return
        parsed = _parse_item(node)
        if parsed is not None:
            text, score = parsed
            if text.strip():
                texts.append(text.strip())
                try:
                    scores.append(float(score))
                except (TypeError, ValueError):
                    pass
            return
        for child in node:
            visit(child)

    visit(result)
    return texts, scores


def _infer(bgr: np.ndarray) -> tuple[list[str], list[float]]:
    """Satu inference. threading.Lock menjaga konkurensi=1 walau wait_for membatalkan."""
    with _infer_lock:
        model = _load_model()
        result = model.ocr(bgr)
    return _collect(result)


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

    # onnxocr mengikuti konvensi cv2 (BGR), bukan RGB.
    bgr = arr[:, :, ::-1].copy()

    try:
        async with _admit_lock:
            texts, scores = await asyncio.wait_for(
                asyncio.to_thread(_infer, bgr), timeout=INFERENCE_TIMEOUT_S
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
        "ocr ok page=%s bytes=%d lines=%d confidence=%.4f latency_ms=%d",
        req.page,
        len(raw),
        len(texts),
        confidence,
        int((time.perf_counter() - started) * 1000),
    )
    return JSONResponse(content={"text": text, "confidence": confidence, "page": req.page})


# --- Error handling seragam: tanpa stack trace ke client ---------------------
@app.exception_handler(RequestValidationError)
async def validation_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    LOG.warning("invalid request status=400 path=%s", request.url.path)
    return _error(400, "invalid_request", "Request body failed validation")


@app.exception_handler(Exception)
async def unhandled_handler(request: Request, exc: Exception) -> JSONResponse:
    LOG.error("unhandled error status=500 path=%s type=%s", request.url.path, type(exc).__name__)
    return _error(500, "internal_error", "Internal server error")
