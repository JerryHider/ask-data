import importlib.util
import unittest
from pathlib import Path


MODULE_PATH = (
    Path(__file__).parent.parent
    / "services"
    / "metricflow-bridge"
    / "main.py"
)
spec = importlib.util.spec_from_file_location("metricflow_bridge_main", MODULE_PATH)
assert spec is not None and spec.loader is not None
metricflow_bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(metricflow_bridge)


class MetricFlowDimensionTests(unittest.TestCase):
    def setUp(self):
        self.manifest = {
            "semantic_models": [
                {
                    "name": "employee_info",
                    "entities": [
                        {"name": "id", "type": "primary"},
                        {"name": "order", "type": "foreign"},
                    ],
                    "dimensions": [{"name": "sex"}],
                    "measures": [{"name": "emp_id_no_crypt"}],
                },
                {
                    "name": "insurance_order",
                    "entities": [{"name": "order", "type": "primary"}],
                    "dimensions": [{"name": "insure_unit_province"}],
                    "measures": [{"name": "order_cnt"}],
                },
                {
                    "name": "unrelated_model",
                    "entities": [{"name": "other", "type": "primary"}],
                    "dimensions": [{"name": "unrelated_dimension"}],
                    "measures": [],
                },
            ],
            "metrics": [
                {
                    "name": "sex_persons",
                    "type_params": {
                        "input_measures": [{"name": "emp_id_no_crypt"}]
                    },
                }
            ],
        }

    def test_exposes_dimensions_from_models_joined_by_shared_entity(self):
        dimensions = metricflow_bridge.dimensions_for_metric(
            self.manifest, "sex_persons"
        )

        self.assertIn("insure_unit_province", dimensions)
        self.assertIn("order__insure_unit_province", dimensions)
        self.assertNotIn("unrelated_dimension", dimensions)

    def test_qualifies_joined_dimensions(self):
        self.assertEqual(
            metricflow_bridge.qualified_group_by(
                self.manifest, "sex_persons", "insure_unit_province"
            ),
            "order__insure_unit_province",
        )
        self.assertEqual(
            metricflow_bridge.qualified_group_by(
                self.manifest, "sex_persons", "order__insure_unit_province"
            ),
            "order__insure_unit_province",
        )
        self.assertEqual(
            metricflow_bridge.qualified_group_by(
                self.manifest, "sex_persons", "sex"
            ),
            "id__sex",
        )


if __name__ == "__main__":
    unittest.main()
