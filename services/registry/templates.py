from __future__ import annotations

from typing import Any


def _field(
    key: str,
    label: str,
    type_: str,
    required: bool = True,
    default: Any | None = None,
    options: list[str] | None = None,
) -> dict[str, Any]:
    field: dict[str, Any] = {
        "key": key,
        "label": label,
        "type": type_,
        "required": required,
    }
    if default is not None:
        field["default"] = default
    if options is not None:
        field["options"] = options
    return field


TEMPLATES: list[dict[str, Any]] = [
    {
        "id": "tpl-01-generic-fact",
        "name": "通用事实表（单度量）",
        "description": "定义一个事实表和若干基础度量。",
        "fields": [
            _field("model_name", "模型名", "text"),
            _field("source_table", "源表", "text"),
            _field("description", "描述", "textarea"),
            _field("entities", "实体", "array"),
            _field("measures", "度量", "array"),
            _field("dimensions", "维度", "array"),
        ],
    },
    {
        "id": "tpl-02-ratio-metric",
        "name": "比率指标",
        "description": "定义分子/分母并生成比率指标。",
        "fields": [
            _field("model_name", "模型名", "text"),
            _field("source_table", "源表", "text"),
            _field("description", "描述", "textarea"),
            _field("numerator", "分子度量", "text"),
            _field("denominator", "分母度量", "text"),
        ],
    },
    {
        "id": "tpl-03-time-series",
        "name": "时间序列趋势模型",
        "description": "面向时间趋势分析的事实表模型。",
        "fields": [
            _field("model_name", "模型名", "text"),
            _field("source_table", "源表", "text"),
            _field("description", "描述", "textarea"),
            _field("time_dimension", "时间维度", "text"),
            _field("measures", "度量", "array"),
        ],
    },
    {
        "id": "tpl-04-user-profile",
        "name": "用户画像模型",
        "description": "以用户为主实体的画像模型。",
        "fields": [
            _field("model_name", "模型名", "text"),
            _field("source_table", "源表", "text"),
            _field("description", "描述", "textarea"),
            _field("user_id", "用户 ID 字段", "text"),
            _field("dimensions", "维度", "array"),
        ],
    },
    {
        "id": "tpl-05-funnel",
        "name": "漏斗模型",
        "description": "定义多步骤转化的漏斗模型。",
        "fields": [
            _field("model_name", "模型名", "text"),
            _field("source_table", "源表", "text"),
            _field("description", "描述", "textarea"),
            _field("steps", "步骤", "array"),
        ],
    },
]


def template_by_id(template_id: str) -> dict[str, Any] | None:
    return next((template for template in TEMPLATES if template["id"] == template_id), None)
