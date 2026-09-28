from __future__ import annotations

from typing import Any


def _field(
    key: str,
    label: str,
    type_: str,
    required: bool = True,
    options: list[str] | None = None,
    item_fields: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    field: dict[str, Any] = {
        "key": key,
        "label": label,
        "type": type_,
        "required": required,
    }
    if options is not None:
        field["options"] = options
    if item_fields is not None:
        field["item_fields"] = item_fields
    return field


ENTITY_FIELDS = [
    _field("name", "实体名", "text"),
    _field("type", "实体类型", "select", options=["primary", "foreign", "unique", "natural"]),
    _field("expr", "物理列", "text"),
    _field("description", "描述", "textarea", required=False),
]

DIMENSION_FIELDS = [
    _field("name", "维度名", "text"),
    _field("type", "维度类型", "select", options=["time", "categorical"]),
    _field("expr", "物理列", "text", required=False),
    _field("time_granularity", "时间粒度", "select", required=False, options=["day", "week", "month", "quarter", "year", "hour"]),
    _field("description", "描述", "textarea", required=False),
]

MEASURE_FIELDS = [
    _field("name", "度量名", "text"),
    _field("agg", "聚合方式", "select", options=["sum", "min", "max", "average", "median", "count_distinct", "count", "sum_boolean", "percentile"]),
    _field("expr", "列或表达式", "text"),
    _field("agg_time_dimension", "聚合时间轴", "text", required=False),
    _field("percentile", "Percentile", "text", required=False),
    _field("use_discrete_percentile", "离散 Percentile", "boolean", required=False),
    _field("description", "描述", "textarea", required=False),
]

METRIC_INPUT_FIELDS = [
    _field("name", "输入指标", "text"),
    _field("alias", "别名", "text", required=False),
    _field("filter", "过滤条件", "textarea", required=False),
    _field("offset_window", "时间偏移窗口", "text", required=False),
    _field("offset_to_grain", "对齐周期", "select", required=False, options=["day", "week", "month", "quarter", "year"]),
]

CONSTANT_PROPERTY_FIELDS = [
    _field("base_property", "起点属性", "text"),
    _field("conversion_property", "终点属性", "text"),
]

COMMON_METRIC_FIELDS = [
    _field("name", "指标名", "text"),
    _field("label", "显示名", "text", required=False),
    _field("description", "业务口径", "textarea", required=False),
    _field("filter", "指标过滤条件", "textarea", required=False),
    _field("owner", "负责人邮箱", "text", required=False),
    _field("synonyms", "同义词", "string_array", required=False),
]


TEMPLATES: list[dict[str, Any]] = [
    {
        "id": "semantic-model",
        "name": "语义模型基础层",
        "description": "声明 dbt 模型、实体、维度、度量和默认时间轴。",
        "fields": [
            _field("name", "语义模型名", "text"),
            _field("label", "显示名", "text", required=False),
            _field("description", "描述", "textarea", required=False),
            _field("model_name", "dbt 模型名", "text"),
            _field("source_table", "源表", "text"),
            _field("agg_time_dimension", "默认时间轴", "text"),
            _field("entities", "实体", "array", item_fields=ENTITY_FIELDS),
            _field("dimensions", "维度", "array", item_fields=DIMENSION_FIELDS),
            _field("measures", "度量", "array", item_fields=MEASURE_FIELDS),
        ],
    },
    {
        "id": "simple-metric",
        "name": "simple 指标",
        "description": "引用基础层度量生成单指标。",
        "fields": [
            *COMMON_METRIC_FIELDS,
            _field("measure", "度量", "text"),
            _field("agg_time_dimension", "聚合时间轴", "text", required=False),
            _field("join_to_timespine", "连接时间脊柱", "boolean", required=False),
            _field("fill_nulls_with", "空值填充", "text", required=False),
        ],
    },
    {
        "id": "ratio-metric",
        "name": "ratio 指标",
        "description": "基于两个指标生成比率。",
        "fields": [
            *COMMON_METRIC_FIELDS,
            _field("numerator", "分子指标", "text"),
            _field("numerator_filter", "分子过滤条件", "textarea", required=False),
            _field("numerator_alias", "分子别名", "text", required=False),
            _field("denominator", "分母指标", "text"),
            _field("denominator_filter", "分母过滤条件", "textarea", required=False),
            _field("denominator_alias", "分母别名", "text", required=False),
        ],
    },
    {
        "id": "derived-metric",
        "name": "derived 指标",
        "description": "对多个输入指标做聚合后运算。",
        "fields": [
            *COMMON_METRIC_FIELDS,
            _field("expr", "计算表达式", "text"),
            _field("input_metrics", "输入指标", "array", item_fields=METRIC_INPUT_FIELDS),
        ],
    },
    {
        "id": "cumulative-metric",
        "name": "cumulative 指标",
        "description": "生成滚动窗口或自然周期累计指标。",
        "fields": [
            *COMMON_METRIC_FIELDS,
            _field("measure", "度量", "text"),
            _field("window", "滚动窗口", "text", required=False),
            _field("grain_to_date", "自然周期", "select", required=False, options=["week", "month", "quarter", "year"]),
            _field("period_agg", "窗口边界聚合", "select", required=False, options=["first", "last", "average"]),
            _field("join_to_timespine", "连接时间脊柱", "boolean", required=False),
            _field("fill_nulls_with", "空值填充", "text", required=False),
        ],
    },
    {
        "id": "conversion-metric",
        "name": "conversion 指标",
        "description": "基于同一实体跟踪起点和终点事件转化。",
        "fields": [
            *COMMON_METRIC_FIELDS,
            _field("entity", "转化主体", "text"),
            _field("calculation", "计算方式", "select", options=["conversion_rate", "conversions"]),
            _field("base_measure", "起点度量", "text"),
            _field("conversion_measure", "终点度量", "text"),
            _field("window", "转化窗口", "text", required=False),
            _field("constant_properties", "恒定属性", "array", required=False, item_fields=CONSTANT_PROPERTY_FIELDS),
        ],
    },
]


def template_by_id(template_id: str) -> dict[str, Any] | None:
    return next((template for template in TEMPLATES if template["id"] == template_id), None)
