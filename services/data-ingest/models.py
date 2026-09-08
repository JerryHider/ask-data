from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DATABASE_PATH = Path(__file__).resolve().parents[2] / 'data' / 'ingest.db'


def init_db() -> None:
    with sqlite3.connect(DATABASE_PATH) as database:
        database.execute(
            'CREATE TABLE IF NOT EXISTS import_history ('
            'id INTEGER PRIMARY KEY AUTOINCREMENT, '
            'table_name TEXT NOT NULL, '
            'source_file TEXT NOT NULL, '
            'row_count INTEGER NOT NULL, '
            'duration_ms INTEGER NOT NULL, '
            'column_mapping TEXT NOT NULL, '
            'created_at TEXT NOT NULL)'
        )
        database.execute('CREATE INDEX IF NOT EXISTS idx_import_table ON import_history(table_name)')


def add_import_history(**values: Any) -> None:
    created_at = datetime.now(timezone.utc).isoformat()
    with sqlite3.connect(DATABASE_PATH) as database:
        database.execute(
            'INSERT INTO import_history '
            '(table_name, source_file, row_count, duration_ms, column_mapping, created_at) '
            'VALUES (?, ?, ?, ?, ?, ?)',
            (
                values['table_name'],
                values['source_file'],
                values['row_count'],
                values['duration_ms'],
                json.dumps(values['column_mapping'], ensure_ascii=False),
                created_at,
            ),
        )


def list_import_history(limit: int = 100) -> list[dict[str, Any]]:
    with sqlite3.connect(DATABASE_PATH) as database:
        database.row_factory = sqlite3.Row
        rows = database.execute(
            'SELECT id, table_name, source_file, row_count, duration_ms, column_mapping, created_at '
            'FROM import_history ORDER BY id DESC LIMIT ?',
            (limit,),
        ).fetchall()
    return [
        {
            **dict(row),
            'column_mapping': json.loads(row['column_mapping']),
        }
        for row in rows
    ]
