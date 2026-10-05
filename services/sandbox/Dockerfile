FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1
WORKDIR /app/services/sandbox

RUN pip install --no-cache-dir uv
COPY services/sandbox/pyproject.toml services/sandbox/uv.lock ./
RUN uv sync --frozen --no-dev

COPY services/sandbox .

CMD [".venv/bin/uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8003"]
