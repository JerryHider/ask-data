FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1
WORKDIR /app/services/registry

RUN pip install --no-cache-dir uv
COPY services/registry/pyproject.toml services/registry/uv.lock ./
RUN uv sync --frozen --no-dev

COPY services/registry .
COPY dbt-project /app/dbt-project
RUN mkdir -p /app/data

CMD [".venv/bin/uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8004"]
