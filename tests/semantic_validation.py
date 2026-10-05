import unittest

from services.registry.semantic import (
    metric_yaml,
    normalize_metric_type,
    semantic_model_errors,
    semantic_model_yaml,
)


class SemanticValidationTests(unittest.TestCase):
    def test_normalizes_missing_metric_type(self):
        config = normalize_metric_type({"name": "premium"}, "simple")

        self.assertEqual(config["type"], "simple")

        with self.assertRaisesRegex(ValueError, "指标类型必须是 simple"):
            normalize_metric_type({"name": "premium", "type": "ratio"}, "simple")

    def test_metric_yaml_omits_join_to_timespine(self):
        yaml_text = metric_yaml(
            {
                "name": "sex_persons",
                "type": "simple",
                "measure": "emp_id_no_crypt",
                "join_to_timespine": False,
            }
        )

        self.assertIn("type: simple", yaml_text)
        self.assertNotIn("join_to_timespine", yaml_text)

    def test_collects_multiple_field_and_row_errors(self):
        errors = semantic_model_errors(
            {
                "name": "InvalidName",
                "model_name": "",
                "source_table": "",
                "agg_time_dimension": "",
                "entities": [{"name": "", "type": "", "expr": ""}],
                "dimensions": [{"name": "", "type": "", "expr": ""}],
                "measures": [{"name": "", "agg": "", "expr": ""}],
            },
            set(),
        )

        self.assertIn(
            {
                "field": "name",
                "index": None,
                "item_field": None,
                "message": "语义模型名必须匹配 ^[a-z][a-z0-9_]{0,59}$",
            },
            errors,
        )
        self.assertIn(
            {
                "field": "model_name",
                "index": None,
                "item_field": None,
                "message": "dbt 模型名不能为空",
            },
            errors,
        )
        self.assertIn(
            {
                "field": "entities",
                "index": 0,
                "item_field": "expr",
                "message": "物理列不能为空",
            },
            errors,
        )
        self.assertTrue(any(error["field"] == "measures" for error in errors))

    def test_reports_duplicate_names_and_missing_time_granularity(self):
        errors = semantic_model_errors(
            {
                "name": "insurance_order",
                "model_name": "insurance_order",
                "source_table": "askdata_import.order_detail",
                "agg_time_dimension": "order_time",
                "entities": [{"name": "order", "type": "primary", "expr": "order_id"}],
                "dimensions": [
                    {"name": "order", "type": "categorical", "expr": "order_id"},
                    {"name": "order_time", "type": "time", "expr": "order_time"},
                ],
                "measures": [],
            },
            {"order_id", "order_time"},
        )
        duplicate_errors = [error for error in errors if "名称重复" in error["message"]]
        granularity_errors = [error for error in errors if "时间粒度" in error["message"]]
        self.assertEqual(len(duplicate_errors), 2)
        self.assertEqual(
            granularity_errors,
            [
                {
                    "field": "dimensions",
                    "index": 1,
                    "item_field": "time_granularity",
                    "message": "时间维度必须声明时间粒度：order_time",
                }
            ],
        )

    def test_ignores_empty_percentile_for_non_percentile_measures(self):
        yaml_text = semantic_model_yaml(
            {
                "name": "employee_info",
                "model_name": "employee_info",
                "source_table": "askdata_import.employee_info",
                "agg_time_dimension": "effective_date",
                "entities": [{"name": "id", "type": "primary", "expr": "id"}],
                "dimensions": [
                    {
                        "name": "effective_date",
                        "type": "time",
                        "expr": "effective_date",
                        "time_granularity": "day",
                    }
                ],
                "measures": [
                    {
                        "name": "employee_count",
                        "agg": "count_distinct",
                        "expr": "emp_id_no_crypt",
                        "percentile": "",
                    }
                ],
            }
        )

        self.assertIn("agg: count_distinct", yaml_text)
        self.assertNotIn("agg_params", yaml_text)

    def test_reports_entity_and_measure_name_conflicts(self):
        errors = semantic_model_errors(
            {
                "name": "employee_info",
                "model_name": "employee_info",
                "source_table": "askdata_import.employee_info",
                "agg_time_dimension": "effective_date",
                "entities": [{"name": "price", "type": "foreign", "expr": "price_id"}],
                "dimensions": [
                    {
                        "name": "effective_date",
                        "type": "time",
                        "expr": "effective_date",
                        "time_granularity": "day",
                    }
                ],
                "measures": [{"name": "price", "agg": "sum", "expr": "price"}],
            },
            {"price_id", "effective_date", "price"},
        )

        conflicts = [error for error in errors if "名称重复" in error["message"]]
        self.assertEqual(
            [(error["field"], error["index"], error["item_field"]) for error in conflicts],
            [("entities", 0, "name"), ("measures", 0, "name")],
        )

    def test_validates_percentile_values(self):
        config = {
            "name": "employee_info",
            "model_name": "employee_info",
            "source_table": "askdata_import.employee_info",
            "agg_time_dimension": "effective_date",
            "entities": [{"name": "id", "type": "primary", "expr": "id"}],
            "dimensions": [
                {
                    "name": "effective_date",
                    "type": "time",
                    "expr": "effective_date",
                    "time_granularity": "day",
                }
            ],
            "measures": [
                {"name": "empty", "agg": "percentile", "expr": "price", "percentile": ""},
                {"name": "invalid", "agg": "percentile", "expr": "price", "percentile": "abc"},
                {"name": "out_of_range", "agg": "percentile", "expr": "price", "percentile": "1.2"},
            ],
        }
        errors = semantic_model_errors(config, {"id", "effective_date", "price"})

        self.assertEqual(len(errors), 3)
        self.assertTrue(all(error["item_field"] == "percentile" for error in errors))


if __name__ == "__main__":
    unittest.main()
