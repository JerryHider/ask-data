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
        database.execute(
            'CREATE TABLE IF NOT EXISTS table_deletion_history ('
            'id INTEGER PRIMARY KEY AUTOINCREMENT, '
            'schema_name TEXT NOT NULL, '
            'table_name TEXT NOT NULL, '
            'estimated_row_count INTEGER NOT NULL, '
            'duration_ms INTEGER NOT NULL, '
            'created_at TEXT NOT NULL)'
        )
        database.execute(
            'CREATE TABLE IF NOT EXISTS query_history ('
            'id INTEGER PRIMARY KEY AUTOINCREMENT, '
            'sql TEXT NOT NULL, '
            'row_count INTEGER NOT NULL, '
            'duration_ms INTEGER NOT NULL, '
            'created_at TEXT NOT NULL)'
        )
        database.execute(
            'CREATE INDEX IF NOT EXISTS idx_query_history_created_at '
            'ON query_history(created_at)'
        )


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


def add_table_deletion_history(**values: Any) -> None:
    created_at = datetime.now(timezone.utc).isoformat()
    with sqlite3.connect(DATABASE_PATH) as database:
        database.execute(
            'INSERT INTO table_deletion_history '
            '(schema_name, table_name, estimated_row_count, duration_ms, created_at) '
            'VALUES (?, ?, ?, ?, ?)',
            (
                values['schema_name'],
                values['table_name'],
                values['estimated_row_count'],
                values['duration_ms'],
                created_at,
            ),
        )




def add_query_history(**values: Any) -> None:
    created_at = datetime.now(timezone.utc).isoformat()
    with sqlite3.connect(DATABASE_PATH) as database:
        database.execute(
            'INSERT INTO query_history (sql, row_count, duration_ms, created_at) '
            'VALUES (?, ?, ?, ?)',
            (
                values['sql'],
                values['row_count'],
                values['duration_ms'],
                created_at,
            ),
        )


def list_query_history(limit: int = 50) -> list[dict[str, Any]]:
    with sqlite3.connect(DATABASE_PATH) as database:
        database.row_factory = sqlite3.Row
        rows = database.execute(
            'SELECT id, sql, row_count, duration_ms, created_at '
            'FROM query_history ORDER BY id DESC LIMIT ?',
            (limit,),
        ).fetchall()
    return [dict(row) for row in rows]
