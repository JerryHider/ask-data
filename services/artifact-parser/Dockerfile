FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1
WORKDIR /app/services/artifact-parser

RUN pip install --no-cache-dir uv
COPY services/artifact-parser/pyproject.toml services/artifact-parser/uv.lock ./
RUN uv sync --frozen --no-dev

COPY services/artifact-parser .
COPY dbt-project /app/dbt-project

CMD ["uv", "run", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
