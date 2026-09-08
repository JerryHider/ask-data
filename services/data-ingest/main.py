from __future__ import annotations

import json
import os
import re
import time
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

import pandas as pd
import pymysql
from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from models import add_import_history, init_db, list_import_history


app = FastAPI(title='AskData data ingest')
ROOT = Path(__file__).resolve().parents[2]
UPLOAD_DIR = ROOT / 'data' / 'tmp_uploads'
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
MAX_FILE_MB = int(os.environ.get('INGEST_MAX_FILE_MB', '50'))
IDENTIFIER_PATTERN = re.compile(r'^[A-Za-z_][A-Za-z0-9_]{0,63}$')


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
