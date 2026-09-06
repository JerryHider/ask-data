from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from main import CompileRequest, MetricRequest, compile_sql, dimensions_for_metric, explain_metric, load_semantic_manifest, normalize_mysql_sql


class MetricFlowBridgeTests(unittest.TestCase):
    def test_normalize_mysql_sql(self) -> None:
        source = "Upgrade warning\nSELECT SUM(amount) AS gmv FROM \"askdata\".\"askdata\".\"fct_orders\""
        self.assertEqual(
            normalize_mysql_sql(source),
            "SELECT SUM(amount) AS gmv FROM askdata.`fct_orders`",
        )

    def test_list_metrics_source(self) -> None:
        semantic_manifest = load_semantic_manifest()
        names = {metric["name"] for metric in semantic_manifest["metrics"]}
        self.assertTrue({"gmv", "refund_rate", "aov"}.issubset(names))

    def test_dimensions_for_refund_rate(self) -> None:
        semantic_manifest = load_semantic_manifest()
        self.assertIn("region", dimensions_for_metric(semantic_manifest, "refund_rate"))

    def test_explain_refund_rate(self) -> None:
        result = explain_metric(MetricRequest(metric="refund_rate"))
        self.assertEqual(result["description"], "\u9000\u6b3e\u8ba2\u5355\u6570 / \u652f\u4ed8\u8ba2\u5355\u6570")
        self.assertEqual(result["numerator"], "refunded_orders")
        self.assertEqual(result["denominator"], "paid_orders")

    def test_compile_refund_rate_by_region(self) -> None:
        result = compile_sql(
            CompileRequest(metrics=["refund_rate"], group_by=["region"], limit=100)
        )
        self.assertIn("SUM(__refunded_orders)", result["sql"])
        self.assertIn("SUM(__paid_orders)", result["sql"])
        self.assertIn("refund_rate", result["sql"])


if __name__ == "__main__":
    unittest.main()
