from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

DBT_PROJECT = Path(__file__).resolve().parents[2] / "dbt-project"
SEMANTIC_MANIFEST_PATH = DBT_PROJECT / "target" / "semantic_manifest.json"
def executable_for(name: str) -> str | None:
    for suffix in ("", ".exe"):
        candidate = Path(sys.executable).with_name(f"{name}{suffix}")
        if candidate.exists():
            return str(candidate)
    return shutil.which(name)


MF_EXECUTABLE = executable_for("mf")
DBT_EXECUTABLE = executable_for("dbt")


def normalize_mysql_sql(sql: str) -> str:
    statement_match = re.search(r"(?mis)^\s*(?:WITH\b|SELECT\b)", sql)
    if statement_match is None:
        return sql
    sql = sql[statement_match.start():]
    sql = re.sub(
        r'"([^"]+)"\s*\.\s*"([^"]+)"\s*\.\s*"([^"]+)"',
        r"`\2`.`\3`",
        sql,
    )
    sql = re.sub(
        r'"([^"]+)"\s*\.\s*"([^"]+)"',
        r"`\1`.`\2`",
        sql,
    )
    sql = sql.replace('"', '`')
    sql = _replace_date_trunc(sql)
    return sql.replace("GEN_RANDOM_UUID()", "UUID()")


def _replace_date_trunc(sql: str) -> str:
    pattern = re.compile(r"DATE_TRUNC\('([a-z]+)',\s*", re.IGNORECASE)
    while True:
        match = pattern.search(sql)
        if match is None:
            return sql
        depth = 1
        position = match.end()
        while position < len(sql) and depth:
            character = sql[position]
            if character == "(":
                depth += 1
            elif character == ")":
                depth -= 1
            position += 1
        if depth:
            return sql
        expression = sql[match.end():position - 1].strip()
        granularity = match.group(1).lower()
        if granularity == "day":
            replacement = f"DATE({expression})"
        elif granularity == "month":
            replacement = f"CAST(DATE_FORMAT({expression}, '%Y-%m-01') AS DATE)"
        elif granularity == "quarter":
            replacement = (
                f"MAKEDATE(YEAR({expression}), 1) "
                f"+ INTERVAL (QUARTER({expression}) * 3 - 3) MONTH"
            )
        elif granularity == "year":
            replacement = f"CAST(DATE_FORMAT({expression}, '%Y-01-01') AS DATE)"
        elif granularity == "week":
            replacement = f"DATE_SUB(DATE({expression}), INTERVAL WEEKDAY({expression}) DAY)"
        elif granularity == "hour":
            replacement = f"CAST(DATE_FORMAT({expression}, '%Y-%m-%d %H:00:00') AS DATETIME)"
        else:
            replacement = expression
        sql = sql[:match.start()] + replacement + sql[position:]

app = FastAPI(title="AskData MetricFlow bridge")


@app.on_event("startup")
def startup() -> None:
    reparse()


class MetricFlowError(Exception):
    def __init__(self, message: str, hint: str) -> None:
        super().__init__(message)
        self.message = message
        self.hint = hint


class MetricRequest(BaseModel):
    metric: str


class CompileRequest(BaseModel):
    metrics: list[str] = Field(min_length=1)
    group_by: list[str] = Field(default_factory=list)
    where: str | None = None
    limit: int = Field(default=100, ge=1, le=1000)
    start_time: str | None = None
    end_time: str | None = None


@app.exception_handler(MetricFlowError)
async def metricflow_error_handler(
    _request: Request, exc: MetricFlowError
) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content={"error": True, "message": exc.message, "hint": exc.hint},
    )


def run_command(arguments: list[str]) -> str:
    environment = os.environ.copy()
    environment["PYTHONIOENCODING"] = "utf-8"
    result = subprocess.run(
        [MF_EXECUTABLE or "mf", *arguments],
        cwd=DBT_PROJECT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        env=environment,
    )
    if result.returncode != 0:
        message = (result.stderr or result.stdout or "MetricFlow failed").strip()
        raise MetricFlowError(
            f"MetricFlow failed: {message[:1000]}",
            "??????????????????????????? list_metrics/get_dimensions ???",
        ) from RuntimeError(message)
    return result.stdout.strip()


def load_semantic_manifest() -> dict[str, Any]:
    if not SEMANTIC_MANIFEST_PATH.exists():
        raise MetricFlowError(
            "???????",
            "???? POST /reparse ?? dbt semantic_manifest.json?",
        )
    with SEMANTIC_MANIFEST_PATH.open(encoding="utf-8") as handle:
        return json.load(handle)


def semantic_models_for_metric(
    semantic_manifest: dict[str, Any], metric_name: str, visited: set[str] | None = None
) -> list[dict[str, Any]]:
    metrics = {
        metric.get("name"): metric
        for metric in semantic_manifest.get("metrics", [])
    }
    metric = metrics.get(metric_name)
    if metric is None:
        return []
    visited = visited or set()
    if metric_name in visited:
        return []
    visited.add(metric_name)
    type_params = metric.get("type_params") or {}
    model_names: set[str] = set()
    aggregation_params = type_params.get("metric_aggregation_params") or {}
    semantic_model_name = aggregation_params.get("semantic_model")
    if semantic_model_name:
        model_names.add(str(semantic_model_name))
    for reference in (
        type_params.get("numerator"),
        type_params.get("denominator"),
        *type_params.get("metrics", []),
    ):
        if isinstance(reference, dict) and reference.get("name"):
            referenced_name = str(reference["name"])
            for referenced_model in semantic_models_for_metric(
                semantic_manifest, referenced_name, visited
            ):
                model_names.add(str(referenced_model.get("name", "")))
    input_measures = {
        measure.get("name")
        for measure in type_params.get("input_measures", [])
        if measure.get("name")
    }
    if input_measures:
        for semantic_model in semantic_manifest.get("semantic_models", []):
            measure_names = {
                model_measure.get("name")
                for model_measure in semantic_model.get("measures", [])
            }
            if input_measures.intersection(measure_names):
                model_names.add(str(semantic_model.get("name", "")))
    return [
        semantic_model
        for semantic_model in semantic_manifest.get("semantic_models", [])
        if semantic_model.get("name") in model_names
    ]


def dimensions_for_metric(
    semantic_manifest: dict[str, Any], metric_name: str
) -> list[str]:
    dimensions: set[str] = set()
    for semantic_model in semantic_models_for_metric(semantic_manifest, metric_name):
        dimensions.update(
            dimension.get("name")
            for dimension in semantic_model.get("dimensions", [])
            if dimension.get("name")
        )
    return sorted(dimensions)


def qualified_group_by(
    semantic_manifest: dict[str, Any], metric_name: str, requested: str
) -> str:
    for semantic_model in semantic_models_for_metric(semantic_manifest, metric_name):
        primary_entities = [
            entity.get("name")
            for entity in semantic_model.get("entities", [])
            if entity.get("type") == "primary" and entity.get("name")
        ]
        for dimension in semantic_model.get("dimensions", []):
            dimension_name = dimension.get("name", "")
            time_granularity = (
                (dimension.get("type_params") or {}).get("time_granularity")
                if dimension.get("type") == "time"
                else None
            )
            base_qualified = (
                f"{primary_entities[0]}__{dimension_name}"
                if primary_entities
                else dimension_name
            )
            qualified = (
                f"{base_qualified}__{time_granularity}"
                if time_granularity
                else base_qualified
            )
            aliases = {dimension_name, base_qualified, qualified}
            if time_granularity:
                aliases.add(f"{dimension_name}__{time_granularity}")
            if requested in aliases:
                return qualified
    return requested


def qualified_where(
    semantic_manifest: dict[str, Any], metric_name: str, where: str
) -> str:
    def replace_dimension(match: re.Match[str]) -> str:
        dimension = match.group(2)
        qualified = qualified_group_by(semantic_manifest, metric_name, dimension)
        return f"{{{{ Dimension('{qualified}') }}}}"

    return re.sub(
        r"\{\{\s*Dimension\(\s*(['\"])([^'\"]+)\1\s*\)\s*\}\}",
        replace_dimension,
        where,
    )


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "ok": SEMANTIC_MANIFEST_PATH.exists(),
        "semantic_manifest": str(SEMANTIC_MANIFEST_PATH),
    }


@app.post("/list_metrics")
def list_metrics() -> list[dict[str, Any]]:
    semantic_manifest = load_semantic_manifest()
    output: list[dict[str, Any]] = []
    for metric in semantic_manifest.get("metrics", []):
        name = metric.get("name", "")
        output.append(
            {
                "name": name,
                "description": metric.get("description") or "",
                "type": metric.get("type") or "",
                "available_dimensions": dimensions_for_metric(semantic_manifest, name),
            }
        )
    return output


@app.post("/get_dimensions")
def get_dimensions(request: MetricRequest) -> list[str]:
    semantic_manifest = load_semantic_manifest()
    dimensions = dimensions_for_metric(semantic_manifest, request.metric)
    if not dimensions:
        raise MetricFlowError(
            f"?? {request.metric} ??????????",
            "???? POST /list_metrics ????????",
        )
    return dimensions


@app.post("/compile_sql")
def compile_sql(request: CompileRequest) -> dict[str, Any]:
    arguments = ["query", "--metrics", ",".join(request.metrics), "--quiet", "--explain"]
    if request.group_by:
        semantic_manifest = load_semantic_manifest()
        qualified = [
            qualified_group_by(semantic_manifest, request.metrics[0], dimension)
            for dimension in request.group_by
        ]
        arguments.extend(["--group-by", ",".join(qualified)])
    if request.where:
        semantic_manifest = load_semantic_manifest()
        arguments.extend(
            [
                "--where",
                qualified_where(
                    semantic_manifest, request.metrics[0], request.where
                ),
            ]
        )
    if request.start_time:
        arguments.extend(["--start-time", request.start_time])
    if request.end_time:
        arguments.extend(["--end-time", request.end_time])
    arguments.extend(["--limit", str(request.limit)])
    sql = normalize_mysql_sql(run_command(arguments))
    return {"sql": sql, "dialect": "mysql"}


@app.post("/explain_metric")
def explain_metric(request: MetricRequest) -> dict[str, Any]:
    semantic_manifest = load_semantic_manifest()
    metric = next(
        (
            item
            for item in semantic_manifest.get("metrics", [])
            if item.get("name") == request.metric
        ),
        None,
    )
    if metric is None:
        raise MetricFlowError(
            f"?? {request.metric} ???",
            "???? POST /list_metrics ????????",
        )
    type_params = metric.get("type_params") or {}
    numerator = (type_params.get("numerator") or {}).get("name", "")
    denominator = (type_params.get("denominator") or {}).get("name", "")
    return {
        "name": request.metric,
        "description": metric.get("description") or "",
        "numerator": numerator,
        "denominator": denominator,
        "expression": f"{numerator} / {denominator}" if numerator and denominator else "",
    }


@app.post("/reparse")
def reparse() -> dict[str, Any]:
    environment = os.environ.copy()
    environment["PYTHONIOENCODING"] = "utf-8"
    result = subprocess.run(
        [
            str(DBT_EXECUTABLE),
            "parse",
            "--no-partial-parse",
            "--project-dir",
            str(DBT_PROJECT),
            "--profiles-dir",
            str(DBT_PROJECT),
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        env=environment,
    )
    if result.returncode != 0:
        return JSONResponse(
            status_code=422,
            content={
                "error": True,
                "message": "dbt parse ??",
                "hint": (result.stderr or result.stdout or "").strip()[-2000:],
            },
        )
    return {"ok": True, "semantic_manifest": str(SEMANTIC_MANIFEST_PATH)}
