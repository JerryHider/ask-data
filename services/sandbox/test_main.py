from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from main import append_limit, mask_sql, mask_value, validate_sql
import sqlglot


class SandboxTests(unittest.TestCase):
    def test_append_limit(self) -> None:
        expression = sqlglot.parse_one("SELECT * FROM fct_orders", read="mysql")
        self.assertIn("LIMIT 1000", append_limit(expression, 1000).sql(dialect="mysql"))

    def test_mask_phone(self) -> None:
        self.assertEqual(mask_value("13812341234"), "138****1234")
        self.assertIn("138****1234", mask_sql("phone = 13812341234"))

    def test_write_rejected(self) -> None:
        expression = sqlglot.parse_one("DELETE FROM fct_orders", read="mysql")
        with self.assertRaises(ValueError):
            validate_sql(expression)


if __name__ == "__main__":
    unittest.main()
