from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))

from main import (  # noqa: E402
    CompileRequest,
    MetricRequest,
    compile_sql,
    dimensions_for_metric,
    explain_metric,
    load_semantic_manifest,
    normalize_mysql_sql,
    qualified_group_by,
)


class MetricFlowBridgeTests(unittest.TestCase):
    def test_normalize_mysql_sql(self) -> None:
        source = (
            "Upgrade warning\n"
            "WITH cte AS ("
            "SELECT DATE_TRUNC('day', order_time) AS metric_time__day, "
            "GEN_RANDOM_UUID() AS id "
            'FROM "askdata"."askdata_import"."order_detail"'
            ") SELECT * FROM cte"
        )
        self.assertEqual(
            normalize_mysql_sql(source),
            "WITH cte AS (SELECT DATE(order_time) AS metric_time__day, UUID() AS id "
            "FROM `askdata_import`.`order_detail`) SELECT * FROM cte",
        )

    def test_list_metrics_source(self) -> None:
        semantic_manifest = load_semantic_manifest()
        names = {metric["name"] for metric in semantic_manifest["metrics"]}
        self.assertTrue(
            {
                "premium",
                "avg_premium_per_policy",
                "net_person_change",
                "premium_ytd",
                "policy_cancellation_rate",
            }.issubset(names)
        )

    def test_dimensions_for_premium(self) -> None:
        semantic_manifest = load_semantic_manifest()
        self.assertIn("order_type", dimensions_for_metric(semantic_manifest, "premium"))

    def test_qualified_time_group_by_includes_granularity(self) -> None:
        semantic_manifest = load_semantic_manifest()
        self.assertEqual(
            qualified_group_by(semantic_manifest, "premium", "order_effective_time"),
            "order__order_effective_time__day",
        )

    def test_explain_ratio_metric(self) -> None:
        result = explain_metric(MetricRequest(metric="avg_premium_per_policy"))
        self.assertEqual(result["numerator"], "premium")
        self.assertEqual(result["denominator"], "policy_count")

    def test_compile_sql_normalizes_duckdb_sql(self) -> None:
        raw_sql = (
            "Upgrade warning\n"
            "SELECT DATE_TRUNC('day', order_effective_time) AS metric_time__day "
            'FROM "askdata"."askdata_import"."order_detail"'
        )
        with mock.patch("main.run_command", return_value=raw_sql):
            result = compile_sql(CompileRequest(metrics=["premium"], limit=100))
        self.assertIn("DATE(order_effective_time)", result["sql"])
        self.assertIn("`askdata_import`.`order_detail`", result["sql"])


if __name__ == "__main__":
    unittest.main()
