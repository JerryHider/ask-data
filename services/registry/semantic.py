from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import yaml


NAME_PATTERN = re.compile(r"^[a-z][a-z0-9_]{0,59}$")
REF_PATTERN = re.compile(r"^ref\('([^']+)'\)$")
DIMENSION_REFERENCE_PATTERN = re.compile(r"Dimension\('([^']+)'\)")
SQL_KEYWORDS = {
    "as", "case", "when", "then", "else", "end", "and", "or", "not", "null",
    "true", "false", "cast", "date", "int", "bigint", "decimal", "double",
}


def _clean(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: _clean(item) for key, item in value.items() if item not in (None, "", [], {})}
    if isinstance(value, list):
        return [_clean(item) for item in value]
    return value


def semantic_model_yaml(config: dict[str, Any]) -> str:
    entities = [
        {
            "name": item.get("name"),
            "type": item.get("type"),
            "expr": item.get("expr"),
        }
        for item in config.get("entities", [])
    ]
    for item, entity in zip(config.get("entities", []), entities):
        if item.get("description"):
            entity["description"] = item["description"]
    dimensions = []
    for item in config.get("dimensions", []):
        dimension: dict[str, Any] = {
            "name": item.get("name"),
            "type": item.get("type"),
        }
        if item.get("expr"):
            dimension["expr"] = item["expr"]
        if item.get("description"):
            dimension["description"] = item["description"]
        if item.get("type") == "time":
            dimension["type_params"] = {"time_granularity": item.get("time_granularity", "day")}
        dimensions.append(dimension)
    measures = []
    for item in config.get("measures", []):
        measure: dict[str, Any] = {
            "name": item.get("name"),
            "agg": item.get("agg"),
            "expr": item.get("expr"),
        }
        if item.get("description"):
            measure["description"] = item["description"]
        if item.get("agg_time_dimension"):
            measure["agg_time_dimension"] = item["agg_time_dimension"]
        if item.get("percentile") is not None:
            measure["agg_params"] = {
                "percentile": float(item["percentile"]),
                "use_discrete_percentile": bool(item.get("use_discrete_percentile", False)),
            }
        if item.get("non_additive_dimension"):
            measure["non_additive_dimension"] = item["non_additive_dimension"]
        measures.append(measure)
    semantic_model = {
        "name": config["name"],
        "model": f"ref('{config['model_name']}')",
        "defaults": {"agg_time_dimension": config["agg_time_dimension"]},
        "entities": entities,
        "dimensions": dimensions,
        "measures": measures,
    }
    if config.get("label"):
        semantic_model["label"] = config["label"]
    if config.get("description"):
        semantic_model["description"] = config["description"]
    document = {"version": 2, "semantic_models": [semantic_model]}
    return yaml.safe_dump(_clean(document), sort_keys=False, allow_unicode=True)


def _metric_input(name: str, config: dict[str, Any]) -> dict[str, Any] | str:
    if not any(config.get(key) for key in ("filter", "alias", "offset_window", "offset_to_grain")):
        return name
    result: dict[str, Any] = {"name": name}
    for key in ("filter", "alias", "offset_window", "offset_to_grain"):
        if config.get(key):
            result[key] = config[key]
    return result


def metric_yaml(config: dict[str, Any]) -> str:
    metric_type = config["type"]
    type_params: dict[str, Any] = {}
    if metric_type == "simple":
        type_params["measure"] = config["measure"]
    elif metric_type == "ratio":
        type_params["numerator"] = _metric_input(config["numerator"], {**config, "alias": config.get("numerator_alias"), "filter": config.get("numerator_filter")})
        type_params["denominator"] = _metric_input(config["denominator"], {**config, "alias": config.get("denominator_alias"), "filter": config.get("denominator_filter")})
    elif metric_type == "derived":
        type_params["expr"] = config["expr"]
        type_params["metrics"] = [_metric_input(item["name"], item) for item in config.get("input_metrics", [])]
    elif metric_type == "cumulative":
        type_params["measure"] = config["measure"]
        cumulative: dict[str, Any] = {}
        if config.get("window"):
            cumulative["window"] = config["window"]
        if config.get("grain_to_date"):
            cumulative["grain_to_date"] = config["grain_to_date"]
        if config.get("period_agg"):
            cumulative["period_agg"] = config["period_agg"]
        if cumulative:
            type_params["cumulative_type_params"] = cumulative
    elif metric_type == "conversion":
        type_params["conversion_type_params"] = {
            "entity": config["entity"],
            "calculation": config["calculation"],
            "base_measure": config["base_measure"],
            "conversion_measure": config["conversion_measure"],
            **({"window": config["window"]} if config.get("window") else {}),
            **({
                "constant_properties": [
                    {"base_property": item["base_property"], "conversion_property": item["conversion_property"]}
                    for item in config.get("constant_properties", [])
                ]
            } if config.get("constant_properties") else {}),
        }
    if config.get("join_to_timespine") is not None:
        type_params["join_to_timespine"] = bool(config["join_to_timespine"])
    if config.get("fill_nulls_with") not in (None, ""):
        value = config["fill_nulls_with"]
        type_params["fill_nulls_with"] = int(value) if str(value).lstrip("-").isdigit() else value

    metric: dict[str, Any] = {
        "name": config["name"],
        "label": config.get("label") or config["name"],
        "description": config.get("description", ""),
        "type": metric_type,
        "type_params": type_params,
    }
    if config.get("filter"):
        metric["filter"] = config["filter"]
    meta: dict[str, Any] = {}
    if config.get("owner"):
        meta["owner"] = config["owner"]
    if config.get("synonyms"):
        meta["synonyms"] = config["synonyms"]
    if meta:
        metric["config"] = {"meta": meta}
    return yaml.safe_dump(_clean({"version": 2, "metrics": [metric]}), sort_keys=False, allow_unicode=True)


def config_from_yaml(path: Path, template_id: str) -> dict[str, Any]:
    document = yaml.safe_load(path.read_text(encoding="utf-8"))
    if template_id == "semantic-model":
        source = document["semantic_models"][0]
        model_match = REF_PATTERN.match(str(source["model"]))
        if not model_match:
            raise ValueError(f"invalid model reference in {path.name}")
        config: dict[str, Any] = {
            "name": source["name"],
            "label": source.get("label", ""),
            "description": source.get("description", ""),
            "model_name": model_match.group(1),
            "source_table": "askdata_import.order_detail",
            "agg_time_dimension": source["defaults"]["agg_time_dimension"],
            "entities": source.get("entities", []),
            "dimensions": [],
            "measures": [],
        }
        for item in source.get("dimensions", []):
            dimension = {key: value for key, value in item.items() if key != "type_params"}
            if item.get("type") == "time":
                dimension["time_granularity"] = (item.get("type_params") or {}).get("time_granularity", "day")
            config["dimensions"].append(dimension)
        for item in source.get("measures", []):
            measure = {key: value for key, value in item.items() if key != "agg_params"}
            agg_params = item.get("agg_params") or {}
            if agg_params.get("percentile") is not None:
                measure["percentile"] = agg_params["percentile"]
                measure["use_discrete_percentile"] = agg_params.get("use_discrete_percentile", False)
            config["measures"].append(measure)
        return config

    source = document["metrics"][0]
    type_params = source.get("type_params") or {}
    config: dict[str, Any] = {
        "name": source["name"],
        "label": source.get("label", ""),
        "description": source.get("description", ""),
        "filter": source.get("filter", ""),
        "type": source["type"],
    }
    meta = (source.get("config") or {}).get("meta") or {}
    config["owner"] = meta.get("owner", "")
    config["synonyms"] = meta.get("synonyms", [])
    if source["type"] == "simple":
        config.update({
            "measure": type_params.get("measure"),
            "join_to_timespine": type_params.get("join_to_timespine", False),
            "fill_nulls_with": type_params.get("fill_nulls_with", ""),
        })
    elif source["type"] == "ratio":
        for role in ("numerator", "denominator"):
            value = type_params.get(role, "")
            if isinstance(value, str):
                config[role] = value
            else:
                config[role] = value.get("name")
                config[f"{role}_filter"] = value.get("filter", "")
                config[f"{role}_alias"] = value.get("alias", "")
    elif source["type"] == "derived":
        config["expr"] = type_params.get("expr")
        config["input_metrics"] = [
            item if isinstance(item, dict) else {"name": item}
            for item in type_params.get("metrics", [])
        ]
    elif source["type"] == "cumulative":
        cumulative = type_params.get("cumulative_type_params") or {}
        config.update({
            "measure": type_params.get("measure"),
            "window": cumulative.get("window", ""),
            "grain_to_date": cumulative.get("grain_to_date", ""),
            "period_agg": cumulative.get("period_agg", ""),
            "join_to_timespine": type_params.get("join_to_timespine", False),
            "fill_nulls_with": type_params.get("fill_nulls_with", ""),
        })
    elif source["type"] == "conversion":
        conversion = type_params.get("conversion_type_params") or {}
        config.update({
            "entity": conversion.get("entity"),
            "calculation": conversion.get("calculation"),
            "base_measure": conversion.get("base_measure"),
            "conversion_measure": conversion.get("conversion_measure"),
            "window": conversion.get("window", ""),
            "constant_properties": conversion.get("constant_properties", []),
        })
    return config


def validate_name(name: str) -> None:
    if not NAME_PATTERN.fullmatch(name or ""):
        raise ValueError("名称必须匹配 ^[a-z][a-z0-9_]{0,59}$")


def _validate_expression(value: str, column_names: set[str], label: str) -> None:
    if not value:
        raise ValueError(f"{label}不能为空")
    if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", value):
        if value not in column_names:
            raise ValueError(f"{label}引用的列不存在：{value}")
        return
    identifiers = set(re.findall(r"[A-Za-z_][A-Za-z0-9_]*", value))
    missing = sorted(identifiers - column_names - SQL_KEYWORDS)
    if missing:
        raise ValueError(f"{label}引用的列不存在：{', '.join(missing)}")


def validate_semantic_model(config: dict[str, Any], column_names: set[str]) -> None:
    validate_name(str(config.get("name", "")))
    validate_name(str(config.get("model_name", "")))
    if not config.get("source_table"):
        raise ValueError("源表不能为空")
    time_dimensions = {
        item.get("name")
        for item in config.get("dimensions", [])
        if item.get("type") == "time"
    }
    if config.get("agg_time_dimension") not in time_dimensions:
        raise ValueError("默认时间轴必须是已声明的时间维度")
    element_names: set[str] = set()
    for item in config.get("entities", []):
        if not item.get("name") or not item.get("type") or not item.get("expr"):
            raise ValueError("实体名、类型和物理列均不能为空")
        if item["name"] in element_names:
            raise ValueError(f"实体或维度名称重复：{item['name']}")
        element_names.add(item["name"])
        if item["expr"] not in column_names:
            raise ValueError(f"实体引用的列不存在：{item['expr']}")
    for item in config.get("dimensions", []):
        if not item.get("name") or not item.get("type"):
            raise ValueError("维度名和类型不能为空")
        if item["name"] in element_names:
            raise ValueError(f"实体或维度名称重复：{item['name']}")
        element_names.add(item["name"])
        expr = item.get("expr") or item["name"]
        if expr not in column_names:
            raise ValueError(f"维度引用的列不存在：{expr}")
        if item["type"] == "time" and not item.get("time_granularity"):
            raise ValueError(f"时间维度必须声明时间粒度：{item['name']}")
    measure_names: set[str] = set()
    for item in config.get("measures", []):
        if not item.get("name") or not item.get("agg") or not item.get("expr"):
            raise ValueError("度量名、聚合方式和表达式不能为空")
        if item["name"] in measure_names:
            raise ValueError(f"度量名称重复：{item['name']}")
        measure_names.add(item["name"])
        _validate_expression(str(item["expr"]), column_names, f"度量 {item['name']}")
        if item.get("agg") == "percentile" and item.get("percentile") in (None, ""):
            raise ValueError(f"percentile 度量必须填写 percentile：{item['name']}")


def validate_metric(
    config: dict[str, Any],
    semantic_models: list[dict[str, Any]],
    metrics: list[dict[str, Any]],
) -> None:
    validate_name(str(config.get("name", "")))
    metric_type = config.get("type")
    if metric_type not in {"simple", "ratio", "derived", "cumulative", "conversion"}:
        raise ValueError("指标类型无效")
    measure_names = {
        measure["name"]
        for model in semantic_models
        for measure in model.get("measures", [])
        if measure.get("name")
    }
    entity_names = {
        entity["name"]
        for model in semantic_models
        for entity in model.get("entities", [])
        if entity.get("name")
    }
    dimension_names = {
        dimension["name"]
        for model in semantic_models
        for dimension in model.get("dimensions", [])
        if dimension.get("name")
    }
    metric_names = {item.get("name") for item in metrics if item.get("name")}
    if metric_type in {"simple", "cumulative"} and config.get("measure") not in measure_names:
        raise ValueError(f"度量不存在：{config.get('measure')}")
    if metric_type == "ratio":
        for role in ("numerator", "denominator"):
            if config.get(role) not in metric_names:
                raise ValueError(f"{role} 指标不存在：{config.get(role)}")
    if metric_type == "derived":
        if not config.get("expr") or not config.get("input_metrics"):
            raise ValueError("derived 指标必须填写表达式和输入指标")
        for item in config["input_metrics"]:
            if item.get("name") not in metric_names:
                raise ValueError(f"输入指标不存在：{item.get('name')}")
    if metric_type == "cumulative":
        if bool(config.get("window")) == bool(config.get("grain_to_date")):
            raise ValueError("cumulative 指标必须且只能填写 window 或 grain_to_date")
    if metric_type == "conversion":
        if config.get("entity") not in entity_names:
            raise ValueError(f"转化主体不存在：{config.get('entity')}")
        if config.get("base_measure") not in measure_names:
            raise ValueError(f"起点度量不存在：{config.get('base_measure')}")
        if config.get("conversion_measure") not in measure_names:
            raise ValueError(f"终点度量不存在：{config.get('conversion_measure')}")
    for filter_value in [config.get("filter", "")] + [
        item.get("filter", "") for item in config.get("input_metrics", [])
    ] + [config.get("numerator_filter", ""), config.get("denominator_filter", "")]:
        for reference in DIMENSION_REFERENCE_PATTERN.findall(str(filter_value or "")):
            if "__" not in reference or reference.split("__", 1)[1] not in dimension_names:
                raise ValueError(f"过滤条件引用的维度不存在：{reference}")
