from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from parser import parse_metrics, parse_models

ROOT = Path(__file__).resolve().parents[2]


class ParserTests(unittest.TestCase):
    def test_parses_models(self) -> None:
        models = parse_models(ROOT / "dbt-project" / "target" / "manifest.json")
        self.assertEqual(len(models), 3)
        self.assertIn("fct_orders", {model["name"] for model in models})

    def test_parses_metrics(self) -> None:
        metrics = parse_metrics(
            ROOT / "dbt-project" / "target" / "semantic_manifest.json"
        )
        names = {metric["name"] for metric in metrics}
        self.assertIn("refund_rate", names)
        self.assertIn("gmv", names)
        self.assertIn("aov", names)

    def test_refund_rate_description(self) -> None:
        metrics = parse_metrics(
            ROOT / "dbt-project" / "target" / "semantic_manifest.json"
        )
        refund_rate = next(
            metric for metric in metrics if metric["name"] == "refund_rate"
        )
        self.assertIn("\u9000\u6b3e\u8ba2\u5355\u6570 / \u652f\u4ed8\u8ba2\u5355\u6570", refund_rate["description"])


if __name__ == "__main__":
    unittest.main()
