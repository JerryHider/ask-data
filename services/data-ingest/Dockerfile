FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1
WORKDIR /app/services/data-ingest

RUN pip install --no-cache-dir uv
COPY services/data-ingest/pyproject.toml services/data-ingest/uv.lock ./
RUN uv sync --frozen --no-dev

COPY services/data-ingest .
RUN mkdir -p /app/data/tmp_uploads

CMD .venv/bin/uvicorn main:app --host 0.0.0.0 --port 8005
