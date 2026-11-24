# OCR microservice — PP-OCRv6 tiny (DECISION-034).
# Image ringan: python-slim + ONNX Runtime, TANPA PaddlePaddle.
# Model tiny sudah dibundel di wheel onnxocr (~75 MB), tidak ada unduhan saat runtime.

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    XDG_CACHE_HOME=/opt/ocr/.cache \
    OCR_BIND=0.0.0.0 \
    OCR_PORT=6334

WORKDIR /app

# Dependensi dipasang lebih dulu agar layer cache tetap stabil.
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt \
    && mkdir -p /opt/ocr/.cache \
    && useradd --create-home --uid 10001 ocr \
    && chown -R ocr:ocr /app /opt/ocr \
    && chown -R ocr:ocr /usr/local/lib/python3.12/site-packages/onnxocr

COPY app.py /app/app.py
RUN chown ocr:ocr /app/app.py

USER ocr

# Di dalam container WAJIB bind 0.0.0.0 agar port-mapping host bisa menjangkau.
# Binding ke 127.0.0.1:6334 dilakukan docker-compose di sisi HOST.
EXPOSE 6334

# workers=1 + concurrency=1 di aplikasi = satu inference pada satu waktu.
# --no-access-log mengurangi permukaan log (path saja tetap dicatat aplikasi).
CMD ["sh", "-c", "exec uvicorn app:app --host \"$OCR_BIND\" --port \"$OCR_PORT\" --workers 1 --no-access-log"]
