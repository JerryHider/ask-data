FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1
WORKDIR /app/services/metricflow-bridge

RUN pip install --no-cache-dir uv
COPY services/metricflow-bridge/pyproject.toml services/metricflow-bridge/uv.lock ./
RUN uv sync --frozen --no-dev

COPY services/metricflow-bridge .
COPY dbt-project /app/dbt-project

CMD [".venv/bin/uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8002"]
