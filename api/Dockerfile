FROM python:3.12-slim AS base
# Tesseract reads ID photos and result slips in the API process (app/ocr); English data only.
RUN apt-get update && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-eng \
    && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PATH="/app/.venv/bin:$PATH"
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project --no-dev

FROM base AS dev
RUN uv sync --frozen --no-install-project
COPY . .
RUN uv sync --frozen

FROM base AS prod
COPY . .
RUN uv sync --frozen --no-dev
CMD ["gunicorn", "-k", "uvicorn.workers.UvicornWorker", "-w", "4", "-b", "0.0.0.0:8000", "app.main:app"]

# Worker image with the heavier OCR stack (PaddleOCR, OpenCV) for later pipeline stages
FROM base AS worker
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*
COPY . .
RUN uv sync --frozen --no-dev --extra ocr
CMD ["celery", "-A", "app.worker", "worker", "-B", "-l", "info"]
