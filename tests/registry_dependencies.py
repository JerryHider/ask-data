import unittest

from services.registry.dependencies import (
    dependent_metric_configs,
    is_non_breaking_semantic_model_update,
)


OLD_CONFIG = {
    'model_name': 'insurance_order',
    'source_table': 'askdata_import.order_detail',
    'agg_time_dimension': 'order_effective_time',
    'entities': [{'name': 'policy', 'type': 'primary', 'expr': 'policy_no'}],
    'dimensions': [
        {'name': 'order_effective_time', 'type': 'time', 'time_granularity': 'day'},
        {'name': 'insure_unit_province', 'type': 'categorical'},
    ],
    'measures': [
        {'name': 'total_premium', 'agg': 'sum', 'expr': 'insure_money'},
    ],
}

SIMPLE_METRIC = {
    'name': 'premium',
    'type': 'simple',
    'measure': 'total_premium',
    'filter': "{{ Dimension('insure_unit_province') }} = '湖北省'",
}

RATIO_METRIC = {
    'name': 'premium_share',
    'type': 'ratio',
    'numerator': 'premium',
    'denominator': 'premium',
}


class RegistryDependencyTests(unittest.TestCase):
    def test_adding_dimension_is_non_breaking(self):
        new_config = {
            **OLD_CONFIG,
            'dimensions': [
                *OLD_CONFIG['dimensions'],
                {'name': 'insure_term', 'type': 'categorical'},
            ],
        }
        dependents = dependent_metric_configs(OLD_CONFIG, [SIMPLE_METRIC, RATIO_METRIC])
        self.assertTrue(is_non_breaking_semantic_model_update(OLD_CONFIG, new_config, dependents))

    def test_removing_referenced_measure_is_breaking(self):
        new_config = {**OLD_CONFIG, 'measures': []}
        dependents = dependent_metric_configs(OLD_CONFIG, [SIMPLE_METRIC, RATIO_METRIC])
        self.assertFalse(is_non_breaking_semantic_model_update(OLD_CONFIG, new_config, dependents))

    def test_changing_referenced_measure_definition_is_breaking(self):
        new_config = {
            **OLD_CONFIG,
            'measures': [
                {'name': 'total_premium', 'agg': 'average', 'expr': 'insure_money'},
            ],
        }
        dependents = dependent_metric_configs(OLD_CONFIG, [SIMPLE_METRIC, RATIO_METRIC])
        self.assertFalse(is_non_breaking_semantic_model_update(OLD_CONFIG, new_config, dependents))

    def test_description_change_is_non_breaking(self):
        new_config = {
            **OLD_CONFIG,
            'measures': [
                {
                    **OLD_CONFIG['measures'][0],
                    'description': '保费口径说明',
                },
            ],
        }
        dependents = dependent_metric_configs(OLD_CONFIG, [SIMPLE_METRIC, RATIO_METRIC])
        self.assertTrue(is_non_breaking_semantic_model_update(OLD_CONFIG, new_config, dependents))

    def test_transitive_metric_dependencies_are_detected(self):
        self.assertEqual(
            [item['name'] for item in dependent_metric_configs(OLD_CONFIG, [SIMPLE_METRIC, RATIO_METRIC])],
            ['premium', 'premium_share'],
        )


if __name__ == '__main__':
    unittest.main()
