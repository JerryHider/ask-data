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
    select_index = sql.upper().find("SELECT")
    if select_index < 0:
        return sql
    sql = sql[select_index:]
    sql = re.sub(
        r'\s*"askdata"\s*\.\s*"askdata"\s*\.\s*"([^"]+)"',
        r" askdata.`\1`",
        sql,
    )
    return sql.replace('"', '`')

app = FastAPI(title="AskData MetricFlow bridge")


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
            "MetricFlow ????",
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


def dimensions_for_metric(
    semantic_manifest: dict[str, Any], metric_name: str
) -> list[str]:
    metrics = {
        metric.get("name"): metric
        for metric in semantic_manifest.get("metrics", [])
    }
    metric = metrics.get(metric_name)
    if metric is None:
        return []
    type_params = metric.get("type_params") or {}
    input_measures = {
        measure.get("name")
        for measure in type_params.get("input_measures", [])
        if measure.get("name")
    }
    measure = type_params.get("measure")
    if isinstance(measure, dict) and measure.get("name"):
        input_measures.add(measure["name"])
    dimensions: set[str] = set()
    for semantic_model in semantic_manifest.get("semantic_models", []):
        measure_names = {
            model_measure.get("name")
            for model_measure in semantic_model.get("measures", [])
        }
        if input_measures.intersection(measure_names):
            dimensions.update(
                dimension.get("name")
                for dimension in semantic_model.get("dimensions", [])
                if dimension.get("name")
            )
    return sorted(dimensions)


def qualified_group_by(
    semantic_manifest: dict[str, Any], metric_name: str, requested: str
) -> str:
    for semantic_model in semantic_manifest.get("semantic_models", []):
        measure_names = {
            measure.get("name") for measure in semantic_model.get("measures", [])
        }
        metric = next(
            (
                item
                for item in semantic_manifest.get("metrics", [])
                if item.get("name") == metric_name
            ),
            None,
        )
        if metric is None:
            continue
        type_params = metric.get("type_params") or {}
        input_measures = {
            measure.get("name")
            for measure in type_params.get("input_measures", [])
            if measure.get("name")
        }
        measure = type_params.get("measure")
        if isinstance(measure, dict) and measure.get("name"):
            input_measures.add(measure["name"])
        if not input_measures.intersection(measure_names):
            continue
        primary_entities = [
            entity.get("name")
            for entity in semantic_model.get("entities", [])
            if entity.get("type") == "primary" and entity.get("name")
        ]
        for dimension in semantic_model.get("dimensions", []):
            dimension_name = dimension.get("name", "")
            qualified = (
                f"{primary_entities[0]}__{dimension_name}"
                if primary_entities
                else dimension_name
            )
            if requested in {dimension_name, qualified}:
                return qualified
    return requested


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
        arguments.extend(["--where", request.where])
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
