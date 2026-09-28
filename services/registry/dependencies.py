from __future__ import annotations

import re
from typing import Any


DIMENSION_REFERENCE_PATTERN = re.compile(r"Dimension\(['\"]([^'\"]+)['\"]\)")


def _items(config: dict[str, Any], key: str) -> list[dict[str, Any]]:
    value = config.get(key, [])
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]


def _element_map(config: dict[str, Any], key: str) -> dict[str, dict[str, Any]]:
    return {
        str(item.get('name')): item
        for item in _items(config, key)
        if item.get('name')
    }


def semantic_model_elements(config: dict[str, Any]) -> dict[str, dict[str, dict[str, Any]]]:
    return {
        'entities': _element_map(config, 'entities'),
        'dimensions': _element_map(config, 'dimensions'),
        'measures': _element_map(config, 'measures'),
    }


def metric_references(config: dict[str, Any]) -> dict[str, set[str]]:
    references = {
        'entities': set(),
        'dimensions': set(),
        'measures': set(),
        'metrics': set(),
    }
    metric_type = config.get('type')
    if metric_type in {'simple', 'cumulative'} and config.get('measure'):
        references['measures'].add(str(config['measure']))
    if metric_type == 'ratio':
        for role in ('numerator', 'denominator'):
            if config.get(role):
                references['metrics'].add(str(config[role]))
    if metric_type == 'derived':
        for item in _items(config, 'input_metrics'):
            if item.get('name'):
                references['metrics'].add(str(item['name']))
    if metric_type == 'conversion':
        if config.get('entity'):
            references['entities'].add(str(config['entity']))
        for role in ('base_measure', 'conversion_measure'):
            if config.get(role):
                references['measures'].add(str(config[role]))

    filter_values = [config.get('filter', '')]
    filter_values.extend(item.get('filter', '') for item in _items(config, 'input_metrics'))
    filter_values.extend([config.get('numerator_filter', ''), config.get('denominator_filter', '')])
    for value in filter_values:
        references['dimensions'].update(DIMENSION_REFERENCE_PATTERN.findall(str(value or '')))
    return references


def dependent_metric_configs(
    semantic_config: dict[str, Any],
    metric_configs: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    elements = semantic_model_elements(semantic_config)
    direct_names: set[str] = set()
    for metric in metric_configs:
        references = metric_references(metric)
        if any(references[kind] & set(elements[kind]) for kind in elements):
            if metric.get('name'):
                direct_names.add(str(metric['name']))

    dependent_names = set(direct_names)
    queue = list(direct_names)
    while queue:
        current = queue.pop()
        for metric in metric_configs:
            name = str(metric.get('name') or '')
            if not name or name in dependent_names:
                continue
            if current in metric_references(metric)['metrics']:
                dependent_names.add(name)
                queue.append(name)

    return [metric for metric in metric_configs if str(metric.get('name') or '') in dependent_names]


def _normalize_element(item: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in item.items() if key not in {'description', 'label'}}


def is_non_breaking_semantic_model_update(
    old_config: dict[str, Any],
    new_config: dict[str, Any],
    dependent_configs: list[dict[str, Any]],
) -> bool:
    if not dependent_configs:
        return True
    if any(
        old_config.get(key) != new_config.get(key)
        for key in ('model_name', 'source_table', 'agg_time_dimension')
    ):
        return False

    old_elements = semantic_model_elements(old_config)
    new_elements = semantic_model_elements(new_config)
    used_names = {
        kind: set()
        for kind in old_elements
    }
    for dependent in dependent_configs:
        references = metric_references(dependent)
        for kind in old_elements:
            used_names[kind].update(references[kind] & set(old_elements[kind]))

    for kind, names in used_names.items():
        for name in names:
            if name not in new_elements[kind]:
                return False
            if _normalize_element(old_elements[kind][name]) != _normalize_element(new_elements[kind][name]):
                return False
    return True
