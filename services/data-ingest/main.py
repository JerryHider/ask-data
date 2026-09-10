from __future__ import annotations

import json
import os
import re
import time
import uuid
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

import pandas as pd
import pymysql
from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from models import (
    add_import_history,
    add_table_deletion_history,
    init_db,
    list_import_history,
)


app = FastAPI(title='AskData data ingest')
ROOT = Path(__file__).resolve().parents[2]
UPLOAD_DIR = ROOT / 'data' / 'tmp_uploads'
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
MAX_FILE_MB = int(os.environ.get('INGEST_MAX_FILE_MB', '50'))
IDENTIFIER_PATTERN = re.compile(r'^[A-Za-z_][A-Za-z0-9_]{0,63}$')
SQL_SANDBOX_URL = os.environ.get('SQL_SANDBOX_URL', 'http://sandbox:8003').rstrip('/')


class ColumnMapping(BaseModel):
    name: str
    inferred_type: str = Field(pattern=r'^(integer|float|string|date)$')
    source_name: str | None = None


class ImportRequest(BaseModel):
    file_id: str
    table_name: str
    columns: list[ColumnMapping] = Field(min_length=1)
    primary_key: str | None = None
    target_datasource: str = 'mysql'
    auto_draft: bool = False


class QueryRequest(BaseModel):
    sql: str = Field(min_length=1, max_length=20_000)


def parse_mysql_url(url: str) -> dict[str, Any]:
    parsed = urlparse(url)
    return {
        'host': parsed.hostname or '127.0.0.1',
        'port': parsed.port or 3306,
        'user': unquote(parsed.username or 'root'),
        'password': unquote(parsed.password or ''),
        'database': parsed.path.lstrip('/') or 'askdata',
    }


def mysql_connection() -> pymysql.connections.Connection:
    url = os.environ.get('DATASOURCE_MYSQL_URL')
    if not url:
        raise HTTPException(status_code=409, detail='DATASOURCE_MYSQL_URL is required')
    values = parse_mysql_url(url)
    return pymysql.connect(
        host=values['host'],
        port=values['port'],
        user=values['user'],
        password=values['password'],
        cursorclass=pymysql.cursors.DictCursor,
    )


def infer_type(series: pd.Series) -> str:
    if pd.api.types.is_integer_dtype(series):
        return 'integer'
    if pd.api.types.is_float_dtype(series):
        return 'float'
    if pd.api.types.is_datetime64_any_dtype(series):
        return 'date'
    if pd.api.types.is_object_dtype(series) or pd.api.types.is_string_dtype(series):
        parsed = pd.to_datetime(series, errors='coerce')
        if series.notna().all() and parsed.notna().all():
            return 'date'
    return 'string'


def rows_for_json(frame: pd.DataFrame) -> list[dict[str, Any]]:
    return json.loads(frame.to_json(orient='records', force_ascii=False, date_format='iso'))


@app.on_event('startup')
def startup() -> None:
    init_db()


@app.get('/health')
def health() -> dict[str, str]:
    return {'status': 'ok'}


@app.post('/parse')
async def parse(file: UploadFile, sheet: str | None = None) -> dict[str, Any]:
    content = await file.read()
    if len(content) > MAX_FILE_MB * 1024 * 1024:
        raise HTTPException(status_code=413, detail='file exceeds ' + str(MAX_FILE_MB) + 'MB')
    suffix = Path(file.filename or '').suffix.lower()
    try:
        if suffix == '.csv':
            frame = pd.read_csv(pd.io.common.BytesIO(content))
            sheets = []
        elif suffix in ('.xlsx', '.xls'):
            workbook = pd.ExcelFile(pd.io.common.BytesIO(content), engine='openpyxl')
            sheets = workbook.sheet_names
            selected_sheet = sheet if sheet in sheets else sheets[0]
            frame = workbook.parse(selected_sheet)
        else:
            raise HTTPException(status_code=422, detail='only .csv, .xlsx and .xls are supported')
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=422, detail='file parse failed: ' + str(exc)) from exc
    file_id = uuid.uuid4().hex
    records = rows_for_json(frame)
    payload = {
        'source_file': file.filename,
        'columns': list(frame.columns),
        'rows': records,
    }
    (UPLOAD_DIR / (file_id + '.json')).write_text(
        json.dumps(payload, ensure_ascii=False), encoding='utf-8'
    )
    return {
        'sheets': sheets,
        'columns': [
            {'name': str(column), 'inferred_type': infer_type(frame[column])}
            for column in frame.columns
        ],
        'preview_rows': records[:10],
        'total_rows': len(records),
        'file_id': file_id,
    }


def mysql_type(data_type: str, primary_key: bool) -> str:
    if primary_key and data_type == 'integer':
        return 'BIGINT NOT NULL PRIMARY KEY'
    return {
        'integer': 'BIGINT',
        'float': 'DOUBLE',
        'string': 'TEXT',
        'date': 'DATETIME',
    }[data_type]


@app.get('/imports')
def list_imports() -> list[dict[str, Any]]:
    return list_import_history()


@app.get('/tables')
def list_tables() -> list[dict[str, Any]]:
    connection = mysql_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                'SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE, TABLE_ROWS '
                'FROM information_schema.TABLES '
                'WHERE TABLE_SCHEMA NOT IN (%s, %s, %s, %s) '
                'ORDER BY TABLE_SCHEMA, TABLE_NAME',
                ('mysql', 'information_schema', 'performance_schema', 'sys'),
            )
            tables = cursor.fetchall()
            cursor.execute(
                'SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_KEY '
                'FROM information_schema.COLUMNS '
                'WHERE TABLE_SCHEMA NOT IN (%s, %s, %s, %s) '
                'ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION',
                ('mysql', 'information_schema', 'performance_schema', 'sys'),
            )
            columns = cursor.fetchall()
    finally:
        connection.close()

    columns_by_table: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for column in columns:
        key = (column['TABLE_SCHEMA'], column['TABLE_NAME'])
        columns_by_table.setdefault(key, []).append(
            {
                'name': column['COLUMN_NAME'],
                'dataType': column['DATA_TYPE'],
                'nullable': column['IS_NULLABLE'] == 'YES',
                'key': column['COLUMN_KEY'],
            }
        )
    return [
        {
            'schema': table['TABLE_SCHEMA'],
            'name': table['TABLE_NAME'],
            'type': table['TABLE_TYPE'],
            'estimatedRowCount': int(table['TABLE_ROWS'] or 0),
            'columns': columns_by_table.get((table['TABLE_SCHEMA'], table['TABLE_NAME']), []),
        }
        for table in tables
    ]


@app.delete('/tables/{schema_name}/{table_name}')
def delete_table(schema_name: str, table_name: str) -> dict[str, bool]:
    if not IDENTIFIER_PATTERN.fullmatch(schema_name) or not IDENTIFIER_PATTERN.fullmatch(table_name):
        raise HTTPException(status_code=422, detail='schema or table name is invalid')

    started_at = time.monotonic()
    connection = mysql_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                'SELECT TABLE_TYPE, TABLE_ROWS '
                'FROM information_schema.TABLES '
                'WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s '
                "AND TABLE_SCHEMA NOT IN ('mysql', 'information_schema', 'performance_schema', 'sys')",
                (schema_name, table_name),
            )
            table = cursor.fetchone()
            if table is None:
                raise HTTPException(status_code=404, detail='Table not found')
            if table['TABLE_TYPE'] != 'BASE TABLE':
                raise HTTPException(status_code=422, detail='Only base tables can be deleted')
            cursor.execute(f'DROP TABLE `{schema_name}`.`{table_name}`')
        connection.commit()
    except HTTPException:
        connection.rollback()
        raise
    except Exception as exc:
        connection.rollback()
        raise HTTPException(status_code=500, detail='Table deletion failed') from exc
    finally:
        connection.close()

    duration_ms = int((time.monotonic() - started_at) * 1000)
    add_table_deletion_history(
        schema_name=schema_name,
        table_name=table_name,
        estimated_row_count=int(table['TABLE_ROWS'] or 0),
        duration_ms=duration_ms,
    )
    return {'ok': True}


@app.post('/query')
def query_database(request: QueryRequest) -> dict[str, Any]:
    sql = request.sql.strip()
    if sql.endswith(';'):
        sql = sql[:-1].rstrip()
    if ';' in sql:
        raise HTTPException(status_code=422, detail='Only one SQL statement is allowed')
    if not re.match(r'^(select|with)\b', sql, re.IGNORECASE):
        raise HTTPException(status_code=422, detail='Only SELECT queries are allowed')
    if re.search(r'\binto\s+(outfile|dumpfile)\b', sql, re.IGNORECASE):
        raise HTTPException(status_code=422, detail='File output queries are not allowed')

    payload = json.dumps({'sql': sql, 'datasource': 'mysql', 'user': 'admin'}).encode('utf-8')
    outbound = urllib.request.Request(
        SQL_SANDBOX_URL + '/execute',
        data=payload,
        headers={'content-type': 'application/json'},
        method='POST',
    )
    try:
        with urllib.request.urlopen(outbound, timeout=35) as response:
            return json.loads(response.read().decode('utf-8'))
    except urllib.error.HTTPError as exc:
        try:
            body = json.loads(exc.read().decode('utf-8'))
        except Exception:
            body = {}
        detail = body.get('message') or body.get('detail') or f'SQL sandbox error: {exc.code}'
        raise HTTPException(status_code=exc.code, detail=detail) from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail='SQL sandbox is unavailable') from exc


@app.post('/import')
def import_file(request: ImportRequest) -> StreamingResponse:
    started = time.monotonic()
    if not IDENTIFIER_PATTERN.fullmatch(request.table_name):
        raise HTTPException(status_code=422, detail='table_name is invalid')
    for column in request.columns:
        if not IDENTIFIER_PATTERN.fullmatch(column.name):
            raise HTTPException(status_code=422, detail='column name is invalid: ' + column.name)
    upload_path = UPLOAD_DIR / (request.file_id + '.json')
    if not upload_path.exists():
        raise HTTPException(status_code=404, detail='parsed file not found')
    payload = json.loads(upload_path.read_text(encoding='utf-8'))
    rows = payload.get('rows', [])
    source_columns = set(payload.get('columns', []))
    mapping = []
    for column in request.columns:
        source_name = column.source_name or column.name
        if source_name not in source_columns:
            raise HTTPException(status_code=422, detail='source column not found: ' + source_name)
        mapping.append((source_name, column.name, column.inferred_type))

    def progress_event(inserted: int) -> str:
        return 'event: import_progress\ndata: ' + json.dumps({'inserted': inserted, 'total': len(rows)}) + '\n\n'

    def execute() -> Any:
        connection = mysql_connection()
        try:
            with connection.cursor() as cursor:
                cursor.execute('CREATE SCHEMA IF NOT EXISTS `askdata_import`')
                definitions = [
                    '`' + target + '` ' + mysql_type(data_type, target == request.primary_key)
                    for source, target, data_type in mapping
                ]
                cursor.execute('DROP TABLE IF EXISTS `askdata_import`.`' + request.table_name + '`')
                cursor.execute(
                    'CREATE TABLE `askdata_import`.`' + request.table_name + '` ('
                    + ', '.join(definitions) + ')'
                )
                targets = [target for _, target, _ in mapping]
                sql = (
                    'INSERT INTO `askdata_import`.`' + request.table_name + '` ('
                    + ', '.join('`' + target + '`' for target in targets)
                    + ') VALUES (' + ', '.join(['%s'] * len(targets)) + ')'
                )
                inserted = 0
                for offset in range(0, len(rows), 500):
                    batch = []
                    for row in rows[offset:offset + 500]:
                        batch.append(tuple(row.get(source) for source, _, _ in mapping))
                    cursor.executemany(sql, batch)
                    inserted += len(batch)
                    yield progress_event(inserted)
                connection.commit()
            duration_ms = int((time.monotonic() - started) * 1000)
            add_import_history(
                table_name='askdata_import.' + request.table_name,
                source_file=str(payload.get('source_file', '')),
                row_count=len(rows),
                duration_ms=duration_ms,
                column_mapping=[item.model_dump() for item in request.columns],
            )
            yield (
                'event: import_done\ndata: '
                + json.dumps({
                    'table_name': 'askdata_import.' + request.table_name,
                    'inserted': len(rows),
                    'duration_ms': duration_ms,
                })
                + '\n\n'
            )
        except Exception as exc:
            connection.rollback()
            yield 'event: import_failed\ndata: ' + json.dumps({'error': str(exc)}) + '\n\n'
        finally:
            connection.close()

    return StreamingResponse(execute(), media_type='text/event-stream')
