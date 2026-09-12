from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def _load_json(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def _refs(depends_on: dict[str, list[str]]) -> list[str]:
    names: list[str] = []
    for item in depends_on.get("nodes", []):
        parts = item.split(".")
        if len(parts) >= 3 and parts[-2] in {"model", "source"}:
            names.append(parts[-1])
    return names


def _column_values(node: dict[str, Any]) -> list[dict[str, Any]]:
    columns = node.get("columns", {})
    if isinstance(columns, dict):
        return list(columns.values())
    return list(columns)


def _column_lines(columns: list[dict[str, Any]]) -> list[str]:
    return [
        f"- {column.get('name', '')} ({column.get('data_type', 'unknown')}): "
        f"{column.get('description') or '???'}"
        for column in columns
    ]


def _model_description(node: dict[str, Any], columns: list[dict[str, Any]]) -> str:
    return "\n".join(
        [
            f"???: {node.get('name', '')}",
            f"??: {node.get('description') or ''}",
            f"????: {node.get('config', {}).get('materialized', '')}",
            "????:",
            *_column_lines(columns),
            f"????: {', '.join(_refs(node.get('depends_on', {})))}",
        ]
    )


def parse_models(manifest_path: Path) -> list[dict[str, Any]]:
    manifest = _load_json(manifest_path)
    nodes = manifest.get("nodes", {})
    node_values = nodes.values() if isinstance(nodes, dict) else nodes
    models: list[dict[str, Any]] = []
    for node in node_values:
        if node.get("resource_type") != "model":
            continue
        columns = _column_values(node)
        models.append(
            {
                "id": node.get("unique_id", node.get("name", "")),
                "name": node.get("name", ""),
                "description": _model_description(node, columns),
                "metadata": {
                    "materialized": node.get("config", {}).get("materialized", ""),
                    "columns": [
                        {
                            "name": column.get("name", ""),
                            "type": column.get("data_type", ""),
                        }
                        for column in columns
                    ],
                },
            }
        )
    return models


def _dimensions_by_model(semantic_manifest: dict[str, Any]) -> dict[str, list[str]]:
    result: dict[str, list[str]] = {}
    for semantic_model in semantic_manifest.get("semantic_models", []):
        result[semantic_model.get("name", "")] = [
            dimension.get("name", "")
            for dimension in semantic_model.get("dimensions", [])
        ]
    return result


def parse_metrics(semantic_manifest_path: Path) -> list[dict[str, Any]]:
    semantic_manifest = _load_json(semantic_manifest_path)
    dimensions_by_model = _dimensions_by_model(semantic_manifest)
    metrics: list[dict[str, Any]] = []
    for metric in semantic_manifest.get("metrics", []):
        type_params = metric.get("type_params", {})
        available_dimensions = sorted(
            {
                dimension
                for dimensions in dimensions_by_model.values()
                for dimension in dimensions
                if dimension
            }
        )
        numerator = type_params.get("numerator") or {}
        denominator = type_params.get("denominator") or {}
        description = "\n".join(
            [
                f"???: {metric.get('name', '')}",
                f"??: {metric.get('description') or ''}",
                f"??: {metric.get('type', '')}",
                f"??: {numerator.get('name', '')}",
                f"??: {denominator.get('name', '')}",
                f"????: {', '.join(available_dimensions)}",
            ]
        )
        metrics.append(
            {
                "id": metric.get("unique_id", metric.get("name", "")),
                "name": metric.get("name", ""),
                "description": description,
                "metadata": {
                    "type": metric.get("type", ""),
                    "label": metric.get("label") or metric.get("name", ""),
                    "description": metric.get("description") or "",
                    "available_dimensions": available_dimensions,
                    "synonyms": (metric.get("config", {}).get("meta", {}) or {}).get("synonyms", []),
                },
            }
        )
    return metrics
