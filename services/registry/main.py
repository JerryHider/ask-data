from __future__ import annotations

import json
import os
import re
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

import httpx
import pymysql
import yaml
from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError

from models import Base, DbConnection, LlmConfig, RagDoc, RagSpace, SemanticModel, SessionLocal, Skill, SqlExample, Setting, engine
from security import decrypt_secret, encrypt_secret
from semantic import config_from_yaml, metric_yaml, semantic_model_yaml, validate_metric, validate_name, validate_semantic_model
from templates import TEMPLATES, template_by_id


app = FastAPI(title='AskData registry')
ROOT = Path(__file__).resolve().parents[2]
DBT_PROJECT = ROOT / 'dbt-project'
USER_MODELS_DIR = DBT_PROJECT / 'user_semantic_models'
DATA_DIR = ROOT / 'data'
SKILLS_DIR = DATA_DIR / 'skills'
USER_MODELS_DIR.mkdir(parents=True, exist_ok=True)
SKILLS_DIR.mkdir(parents=True, exist_ok=True)
METRICFLOW_BRIDGE_URL = os.environ.get('METRICFLOW_BRIDGE_URL', 'http://metricflow-bridge:8002')
ARTIFACT_PARSER_URL = os.environ.get('ARTIFACT_PARSER_URL', 'http://artifact-parser:8001')
SQL_SANDBOX_URL = os.environ.get('SQL_SANDBOX_URL', 'http://sandbox:8003')
NAME_PATTERN = re.compile(r'^[a-z][a-z0-9_]{0,59}$')
TEMPLATE_METRIC_TYPES = {
    'simple-metric': 'simple',
    'ratio-metric': 'ratio',
    'derived-metric': 'derived',
    'cumulative-metric': 'cumulative',
    'conversion-metric': 'conversion',
}
SEED_SEMANTIC_FILES = [
    ('semantic-model', 'semantic_insurance_order.yml'),
    ('simple-metric', 'semantic_premium.yml'),
    ('simple-metric', 'semantic_premium_paid_time.yml'),
    ('simple-metric', 'semantic_premium_gd.yml'),
    ('simple-metric', 'semantic_policy_count.yml'),
    ('simple-metric', 'semantic_order_count.yml'),
    ('simple-metric', 'semantic_insured_persons.yml'),
    ('simple-metric', 'semantic_reduct_persons.yml'),
    ('simple-metric', 'semantic_avg_order_premium.yml'),
    ('simple-metric', 'semantic_premium_p95.yml'),
    ('simple-metric', 'semantic_current_insured_persons.yml'),
    ('ratio-metric', 'semantic_avg_premium_per_policy.yml'),
    ('ratio-metric', 'semantic_gd_premium_share.yml'),
    ('derived-metric', 'semantic_net_person_change.yml'),
    ('derived-metric', 'semantic_premium_yoy.yml'),
    ('derived-metric', 'semantic_gd_premium_yoy.yml'),
    ('derived-metric', 'semantic_premium_vs_month_start.yml'),
    ('cumulative-metric', 'semantic_premium_ytd.yml'),
    ('cumulative-metric', 'semantic_premium_rolling_30d.yml'),
    ('conversion-metric', 'semantic_policy_cancellation_rate.yml'),
]


class CreateModelRequest(BaseModel):
    template_id: str
    config: dict[str, Any]


class UpdateModelRequest(BaseModel):
    config: dict[str, Any]


class AutoDraftRequest(BaseModel):
    table_name: str = Field(min_length=1)


class ConnectionRequest(BaseModel):
    name: str
    type: str = 'mysql'
    host: str
    port: int = Field(default=3306, ge=1, le=65535)
    database_name: str
    username: str
    password: str | None = None
    is_default: bool = False


class ConnectionTestRequest(BaseModel):
    connection_id: int | None = None
    connection: ConnectionRequest | None = None


class LlmConfigRequest(BaseModel):
    name: str
    provider: str
    model: str
    api_key: str | None = None
    base_url: str | None = None
    temperature: float = Field(default=0.2, ge=0, le=1)
    max_tokens: int = Field(default=4096, ge=1, le=200000)
    is_active: bool = False


class SqlExampleRequest(BaseModel):
    question: str = Field(min_length=1)
    sql: str = Field(min_length=1)
    metric_name: str | None = None


class SettingRequest(BaseModel):
    value: dict[str, Any]


class RagSpaceRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    enabled: bool = False


class SkillRequest(BaseModel):
    name: str
    description: str
    trigger_keywords: list[str] = Field(min_length=1)
    prompt_addition: str = Field(min_length=1)
    allowed_tools: list[str] = Field(default_factory=list)
    enabled: bool = False


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def parse_mysql_url(url: str) -> dict[str, Any]:
    parsed = urlparse(url)
    return {
        'host': parsed.hostname or '127.0.0.1',
        'port': parsed.port or 3306,
        'user': unquote(parsed.username or 'root'),
        'password': unquote(parsed.password or ''),
        'database': parsed.path.lstrip('/') or 'askdata',
    }


def connect_with(connection: DbConnection) -> pymysql.connections.Connection:
    return pymysql.connect(
        host=connection.host,
        port=connection.port,
        user=connection.username,
        password=decrypt_secret(connection.password_encrypted),
        database=connection.database_name,
        connect_timeout=5,
        read_timeout=10,
        write_timeout=10,
        cursorclass=pymysql.cursors.DictCursor,
    )


def ensure_default_connection() -> None:
    url = os.environ.get('DATASOURCE_MYSQL_URL')
    if not url:
        return
    values = parse_mysql_url(url)
    with SessionLocal() as session:
        if session.query(DbConnection).filter(DbConnection.is_default.is_(True)).first():
            return
        session.add(
            DbConnection(
                name='mysql',
                type='mysql',
                host=values['host'],
                port=values['port'],
                database_name=values['database'],
                username=values['user'],
                password_encrypted=encrypt_secret(values['password']),
                is_default=True,
            )
        )
        session.commit()


def default_connection() -> DbConnection:
    with SessionLocal() as session:
        connection = session.query(DbConnection).filter(
            DbConnection.is_default.is_(True), DbConnection.type == 'mysql'
        ).first()
        if not connection:
            raise HTTPException(status_code=409, detail='default MySQL connection is not configured')
        session.expunge(connection)
        return connection


def table_columns(table_name: str) -> list[dict[str, Any]]:
    parts = table_name.replace('`', '').split('.')
    table = parts[-1]
    schema = parts[-2] if len(parts) > 1 else None
    with connect_with(default_connection()) as database:
        with database.cursor() as cursor:
            cursor.execute(
                'SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_KEY '
                'FROM information_schema.COLUMNS WHERE TABLE_NAME = %s '
                'AND (%s IS NULL OR TABLE_SCHEMA = %s) ORDER BY ORDINAL_POSITION',
                (table, schema, schema),
            )
            return list(cursor.fetchall())


def model_to_dict(model: SemanticModel) -> dict[str, Any]:
    return {
        'id': model.id,
        'name': model.name,
        'template_id': model.template_id,
        'status': model.status,
        'config': json.loads(model.config),
        'yaml_path': model.yaml_path,
        'error_message': model.error_message,
        'created_at': model.created_at.isoformat(),
        'updated_at': model.updated_at.isoformat(),
    }


def semantic_config_yaml(template_id: str, config: dict[str, Any]) -> str:
    return semantic_model_yaml(config) if template_id == 'semantic-model' else metric_yaml(config)


def validate_semantic_config(template_id: str, config: dict[str, Any]) -> None:
    if template_id == 'semantic-model':
        source_table = str(config.get('source_table', '')).strip()
        columns = table_columns(source_table) if source_table else []
        if not columns:
            raise ValueError('源表不存在：' + source_table)
        model_path = USER_MODELS_DIR / (str(config.get('model_name', '')) + '.sql')
        if not model_path.exists():
            raise ValueError('dbt 模型文件不存在：' + model_path.name)
        validate_semantic_model(config, {item['COLUMN_NAME'] for item in columns})
        return
    metric_type = TEMPLATE_METRIC_TYPES.get(template_id)
    if not metric_type:
        raise ValueError('模板类型无效')
    if config.get('type') != metric_type:
        raise ValueError('指标类型与模板不一致')
    with SessionLocal() as session:
        published = session.query(SemanticModel).filter(SemanticModel.status == 'published').all()
        semantic_configs = [
            json.loads(item.config)
            for item in published
            if item.template_id == 'semantic-model'
        ]
        metric_configs = [
            json.loads(item.config)
            for item in published
            if item.template_id != 'semantic-model'
        ]
    validate_metric(config, semantic_configs, metric_configs)


def semantic_yaml_path(name: str) -> Path:
    return USER_MODELS_DIR / ('semantic_' + name + '.yml')


def dependent_models(session: Any, model: SemanticModel) -> list[SemanticModel]:
    if model.template_id == 'semantic-model':
        return (
            session.query(SemanticModel)
            .filter(
                SemanticModel.id != model.id,
                SemanticModel.status == 'published',
                SemanticModel.template_id != 'semantic-model',
            )
            .all()
        )
    dependents: list[SemanticModel] = []
    for candidate in (
        session.query(SemanticModel)
        .filter(
            SemanticModel.id != model.id,
            SemanticModel.status == 'published',
            SemanticModel.template_id.in_(['ratio-metric', 'derived-metric']),
        )
        .all()
    ):
        config = json.loads(candidate.config)
        references = [config.get('numerator'), config.get('denominator')]
        references.extend(item.get('name') for item in config.get('input_metrics', []))
        if model.name in references:
            dependents.append(candidate)
    return dependents


def write_audit(event_type: str, name: str, decision: str = 'allowed') -> None:
    try:
        httpx.post(
            SQL_SANDBOX_URL + '/audit',
            json={
                'user': 'admin',
                'event_type': event_type,
                'tool_name': 'registry.semantic_models',
                'sql_text': name,
                'decision': decision,
            },
            timeout=3,
        )
    except httpx.HTTPError:
        pass


def ensure_metricflow_time_spine() -> None:
    try:
        connection = default_connection()
        with connect_with(connection) as database:
            with database.cursor() as cursor:
                cursor.execute(
                    "SELECT COUNT(*) AS n FROM information_schema.TABLES "
                    "WHERE TABLE_SCHEMA = 'askdata_import' AND TABLE_NAME = 'order_detail'"
                )
                if cursor.fetchone()['n'] == 0:
                    return
                cursor.execute(
                    'CREATE TABLE IF NOT EXISTS metricflow_time_spine (date_day DATE PRIMARY KEY)'
                )
                cursor.execute(
                    'SELECT MIN(CAST(order_effective_time AS DATE)) AS min_date, '
                    'MAX(CAST(order_effective_time AS DATE)) AS max_date '
                    'FROM askdata_import.order_detail'
                )
                date_range = cursor.fetchone()
                current_date = date_range['min_date']
                max_date = date_range['max_date']
                while current_date <= max_date:
                    chunk = []
                    while current_date <= max_date and len(chunk) < 500:
                        chunk.append(current_date)
                        current_date += timedelta(days=1)
                    placeholders = ', '.join(['(%s)'] * len(chunk))
                    cursor.execute(
                        'INSERT IGNORE INTO metricflow_time_spine (date_day) VALUES ' + placeholders,
                        chunk,
                    )
                database.commit()
    except Exception:
        return


def migrate_semantic_models() -> None:
    marker = 'semantic_models_rebuilt_v2'
    with SessionLocal() as session:
        if session.get(Setting, marker):
            return
        for model in session.query(SemanticModel).filter(SemanticModel.template_id.like('tpl-%')).all():
            session.delete(model)
        for template_id, file_name in SEED_SEMANTIC_FILES:
            path = USER_MODELS_DIR / file_name
            if not path.exists():
                continue
            config = config_from_yaml(path, template_id)
            name = str(config['name'])
            if session.query(SemanticModel).filter(SemanticModel.name == name).first():
                continue
            session.add(
                SemanticModel(
                    name=name,
                    template_id=template_id,
                    status='published',
                    config=json.dumps(config, ensure_ascii=False),
                    yaml_path=str(semantic_yaml_path(name)),
                )
            )
        if session.get(Setting, marker):
            session.get(Setting, marker).value = 'true'
        else:
            session.add(Setting(key=marker, value='true'))
        session.commit()


async def call_service(url: str) -> None:
    async with httpx.AsyncClient(timeout=90) as client:
        response = await client.post(url, json={})
        if response.status_code >= 400:
            raise RuntimeError(url + ' failed: ' + str(response.status_code))


@app.on_event('startup')
def startup() -> None:
    Base.metadata.create_all(engine)
    ensure_default_connection()
    ensure_metricflow_time_spine()
    migrate_semantic_models()


@app.get('/health')
def health() -> dict[str, str]:
    return {'status': 'ok'}


@app.get('/semantic-models/templates')
def list_templates() -> list[dict[str, Any]]:
    return TEMPLATES


@app.get('/semantic-models')
def list_models(status: str | None = None) -> list[dict[str, Any]]:
    with SessionLocal() as session:
        query = session.query(SemanticModel)
        if status:
            query = query.filter(SemanticModel.status == status)
        return [model_to_dict(item) for item in query.order_by(SemanticModel.updated_at.desc()).all()]


@app.post('/semantic-models', status_code=201)
def create_model(request: CreateModelRequest) -> dict[str, Any]:
    if not template_by_id(request.template_id):
        raise HTTPException(status_code=422, detail='template_id is invalid')
    name = str(request.config.get('name', '')).strip()
    validate_name(name)
    model = SemanticModel(
        name=name,
        template_id=request.template_id,
        status='draft',
        config=json.dumps(request.config, ensure_ascii=False),
    )
    with SessionLocal() as session:
        session.add(model)
        try:
            session.commit()
        except IntegrityError:
            session.rollback()
            raise HTTPException(status_code=409, detail='name already exists') from None
        session.refresh(model)
        write_audit('semantic_model_created', name)
        return model_to_dict(model)


@app.get('/semantic-models/{model_id}')
def get_model(model_id: int) -> dict[str, Any]:
    with SessionLocal() as session:
        model = session.get(SemanticModel, model_id)
        if not model:
            raise HTTPException(status_code=404, detail='semantic model not found')
        return model_to_dict(model)


@app.put('/semantic-models/{model_id}')
async def update_model(model_id: int, request: UpdateModelRequest) -> dict[str, Any]:
    with SessionLocal() as session:
        model = session.get(SemanticModel, model_id)
        if not model:
            raise HTTPException(status_code=404, detail='semantic model not found')
        if model.status == 'published' and dependent_models(session, model):
            raise HTTPException(status_code=409, detail='存在依赖该模型的已发布指标，请先撤销依赖项')
        was_published = model.status == 'published'
        yaml_path = semantic_yaml_path(model.name)
        model.config = json.dumps(request.config, ensure_ascii=False)
        if model.status == 'published':
            model.status = 'draft'
            if yaml_path.exists():
                yaml_path.unlink()
        model.error_message = None
        session.commit()
        if was_published:
            try:
                await call_service(METRICFLOW_BRIDGE_URL + '/reparse')
                await call_service(ARTIFACT_PARSER_URL + '/sync')
            except Exception as exc:
                model.error_message = str(exc)
                session.commit()
                raise HTTPException(status_code=500, detail=str(exc)) from exc
        write_audit('semantic_model_updated', model.name)
        session.refresh(model)
        return model_to_dict(model)


@app.post('/semantic-models/{model_id}/publish')
async def publish_model(model_id: int) -> dict[str, Any]:
    with SessionLocal() as session:
        model = session.get(SemanticModel, model_id)
        if not model:
            raise HTTPException(status_code=404, detail='semantic model not found')
        config = json.loads(model.config)
        if str(config.get('name', '')) != model.name:
            raise HTTPException(status_code=422, detail='config.name must match model name')
        yaml_path = semantic_yaml_path(model.name)
        previous_yaml = yaml_path.read_text(encoding='utf-8') if yaml_path.exists() else None
        try:
            validate_name(model.name)
            validate_semantic_config(model.template_id, config)
            yaml_path.write_text(semantic_config_yaml(model.template_id, config), encoding='utf-8')
            await call_service(METRICFLOW_BRIDGE_URL + '/reparse')
            await call_service(ARTIFACT_PARSER_URL + '/sync')
            model.status = 'published'
            model.yaml_path = str(yaml_path)
            model.error_message = None
            session.commit()
            session.refresh(model)
            write_audit('semantic_model_published', model.name)
            return model_to_dict(model)
        except HTTPException as exc:
            model.status = 'draft'
            model.error_message = str(exc.detail)
            session.commit()
            raise exc
        except Exception as exc:
            if yaml_path.exists():
                if previous_yaml is None:
                    yaml_path.unlink()
                else:
                    yaml_path.write_text(previous_yaml, encoding='utf-8')
            model.status = 'draft'
            model.error_message = str(exc)
            session.commit()
            raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post('/semantic-models/{model_id}/unpublish')
async def unpublish_model(model_id: int) -> dict[str, Any]:
    with SessionLocal() as session:
        model = session.get(SemanticModel, model_id)
        if not model:
            raise HTTPException(status_code=404, detail='semantic model not found')
        if dependent_models(session, model):
            raise HTTPException(status_code=409, detail='存在依赖该模型的已发布指标，请先撤销依赖项')
        yaml_path = semantic_yaml_path(model.name)
        if yaml_path.exists():
            yaml_path.unlink()
        try:
            await call_service(METRICFLOW_BRIDGE_URL + '/reparse')
            await call_service(ARTIFACT_PARSER_URL + '/sync')
        except Exception as exc:
            model.error_message = str(exc)
            session.commit()
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        model.status = 'draft'
        model.yaml_path = None
        model.error_message = None
        session.commit()
        session.refresh(model)
        write_audit('semantic_model_unpublished', model.name)
        return model_to_dict(model)


@app.delete('/semantic-models/{model_id}')
async def delete_model(model_id: int) -> dict[str, str]:
    with SessionLocal() as session:
        model = session.get(SemanticModel, model_id)
        if not model:
            raise HTTPException(status_code=404, detail='semantic model not found')
        if dependent_models(session, model):
            raise HTTPException(status_code=409, detail='存在依赖该模型的已发布指标，请先撤销依赖项')
        yaml_path = semantic_yaml_path(model.name)
        if yaml_path.exists():
            yaml_path.unlink()
            await call_service(METRICFLOW_BRIDGE_URL + '/reparse')
            await call_service(ARTIFACT_PARSER_URL + '/sync')
        session.delete(model)
        session.commit()
        write_audit('semantic_model_deleted', model.name)
    return {'status': 'deleted'}


@app.post('/semantic-models/auto-draft', status_code=201)
def auto_draft(request: AutoDraftRequest) -> dict[str, Any]:
    qualified_table = request.table_name
    parts = qualified_table.replace('`', '').split('.')
    model_name = parts[-1]
    validate_name(model_name)
    columns = table_columns(qualified_table)
    if not columns:
        raise HTTPException(status_code=422, detail='table does not exist: ' + qualified_table)
    connection = default_connection()
    dimensions = []
    measures = []
    entities = []
    with connect_with(connection) as database:
        with database.cursor() as cursor:
            for column in columns:
                name = column['COLUMN_NAME']
                data_type = column['DATA_TYPE']
                if column.get('COLUMN_KEY') == 'PRI':
                    entities.append({'name': name.removesuffix('_id'), 'type': 'primary', 'expr': name})
                elif name.endswith('_id'):
                    entities.append({'name': name.removesuffix('_id'), 'type': 'foreign', 'expr': name})
                elif data_type in ('date', 'datetime', 'timestamp'):
                    dimensions.append({
                        'name': name, 'type': 'time', 'expr': name, 'time_granularity': 'day',
                    })
                elif data_type in ('int', 'bigint', 'smallint', 'decimal', 'float', 'double'):
                    measures.append({'name': name, 'agg': 'sum', 'expr': name})
                else:
                    cursor.execute(
                        'SELECT COUNT(DISTINCT ' + pymysql.converters.escape_string(name) + ') AS n FROM ' + qualified_table
                    )
                    distinct_count = cursor.fetchone()['n']
                    if distinct_count <= 20:
                        dimensions.append({'name': name, 'type': 'categorical', 'expr': name})
    if parts[0] == 'askdata_import':
        model_path = USER_MODELS_DIR / (model_name + '.sql')
        model_path.write_text(
            "{{ config(schema='askdata_import') }}\n\nselect * from " + qualified_table + '\n',
            encoding='utf-8',
        )
    config = {
        'name': model_name,
        'model_name': model_name,
        'source_table': qualified_table,
        'description': 'Auto-drafted semantic model',
        'agg_time_dimension': next(
            (item['name'] for item in dimensions if item.get('type') == 'time'),
            '',
        ),
        'entities': entities,
        'measures': measures,
        'dimensions': dimensions,
    }
    with SessionLocal() as session:
        existing = session.query(SemanticModel).filter(SemanticModel.name == model_name).first()
        if existing:
            existing.config = json.dumps(config, ensure_ascii=False)
            existing.status = 'draft'
            existing.error_message = None
            session.commit()
            session.refresh(existing)
            return model_to_dict(existing)
    return create_model(CreateModelRequest(template_id='semantic-model', config=config))


def connection_to_dict(connection: DbConnection, include_password: bool = False) -> dict[str, Any]:
    result = {
        'id': connection.id,
        'name': connection.name,
        'type': connection.type,
        'host': connection.host,
        'port': connection.port,
        'database_name': connection.database_name,
        'username': connection.username,
        'is_default': connection.is_default,
        'last_test_ok': connection.last_test_ok,
        'created_at': connection.created_at.isoformat(),
        'updated_at': connection.updated_at.isoformat(),
    }
    if include_password:
        result['password'] = decrypt_secret(connection.password_encrypted)
    return result


@app.get('/db-connections')
def list_connections() -> list[dict[str, Any]]:
    with SessionLocal() as session:
        connections = session.query(DbConnection).order_by(DbConnection.id).all()
        return [connection_to_dict(item) for item in connections]


@app.post('/db-connections/runtime')
def runtime_connections() -> list[dict[str, Any]]:
    with SessionLocal() as session:
        connections = session.query(DbConnection).filter(DbConnection.type == 'mysql').all()
        return [connection_to_dict(item, include_password=True) for item in connections]


@app.post('/db-connections', status_code=201)
def create_connection(request: ConnectionRequest) -> dict[str, Any]:
    if request.type != 'mysql':
        raise HTTPException(status_code=422, detail='only mysql connections are supported')
    if not request.password:
        raise HTTPException(status_code=422, detail='password is required')
    connection = DbConnection(
        name=request.name,
        type=request.type,
        host=request.host,
        port=request.port,
        database_name=request.database_name,
        username=request.username,
        password_encrypted=encrypt_secret(request.password),
        is_default=False,
    )
    with SessionLocal() as session:
        session.add(connection)
        try:
            session.commit()
        except IntegrityError:
            session.rollback()
            raise HTTPException(status_code=409, detail='connection name already exists') from None
        session.refresh(connection)
        return connection_to_dict(connection)


@app.put('/db-connections/{connection_id}')
def update_connection(connection_id: int, request: ConnectionRequest) -> dict[str, Any]:
    with SessionLocal() as session:
        connection = session.get(DbConnection, connection_id)
        if not connection:
            raise HTTPException(status_code=404, detail='connection not found')
        connection.name = request.name
        connection.type = request.type
        connection.host = request.host
        connection.port = request.port
        connection.database_name = request.database_name
        connection.username = request.username
        if request.password:
            connection.password_encrypted = encrypt_secret(request.password)
        connection.last_test_ok = None
        try:
            session.commit()
        except IntegrityError:
            session.rollback()
            raise HTTPException(status_code=409, detail='connection name already exists') from None
        session.refresh(connection)
        return connection_to_dict(connection)


@app.delete('/db-connections/{connection_id}')
def delete_connection(connection_id: int) -> dict[str, str]:
    with SessionLocal() as session:
        connection = session.get(DbConnection, connection_id)
        if not connection:
            raise HTTPException(status_code=404, detail='connection not found')
        if connection.is_default:
            raise HTTPException(status_code=422, detail='default connection cannot be deleted')
        session.delete(connection)
        session.commit()
    return {'status': 'deleted'}


@app.post('/db-connections/test')
def test_connection(request: ConnectionTestRequest) -> dict[str, Any]:
    started = time.monotonic()
    connection_values = None
    connection_id = request.connection_id
    if request.connection:
        connection_values = request.connection
    elif connection_id is not None:
        with SessionLocal() as session:
            stored = session.get(DbConnection, connection_id)
            if not stored:
                raise HTTPException(status_code=404, detail='connection not found')
            password = decrypt_secret(stored.password_encrypted)
            connection_values = ConnectionRequest(
                name=stored.name,
                type=stored.type,
                host=stored.host,
                port=stored.port,
                database_name=stored.database_name,
                username=stored.username,
                password=password,
            )
    if not connection_values or not connection_values.password:
        raise HTTPException(status_code=422, detail='password is required for connection test')
    try:
        database = pymysql.connect(
            host=connection_values.host,
            port=connection_values.port,
            user=connection_values.username,
            password=connection_values.password,
            database=connection_values.database_name,
            connect_timeout=5,
        )
        with database.cursor() as cursor:
            cursor.execute('SELECT 1')
            cursor.fetchall()
        database.close()
    except Exception as exc:
        if connection_id is not None:
            with SessionLocal() as session:
                stored = session.get(DbConnection, connection_id)
                if stored:
                    stored.last_test_ok = False
                    session.commit()
        return {'ok': False, 'latency_ms': int((time.monotonic() - started) * 1000), 'error': str(exc)}
    if connection_id is not None:
        with SessionLocal() as session:
            stored = session.get(DbConnection, connection_id)
            if stored:
                stored.last_test_ok = True
                session.commit()
    return {'ok': True, 'latency_ms': int((time.monotonic() - started) * 1000), 'error': None}


def llm_to_dict(config: LlmConfig) -> dict[str, Any]:
    return {
        'id': config.id,
        'name': config.name,
        'provider': config.provider,
        'model': config.model,
        'base_url': config.base_url,
        'temperature': config.temperature,
        'max_tokens': config.max_tokens,
        'is_active': config.is_active,
        'created_at': config.created_at.isoformat(),
        'updated_at': config.updated_at.isoformat(),
    }


@app.get('/llm-configs')
def list_llm_configs(active_only: bool = False) -> list[dict[str, Any]]:
    with SessionLocal() as session:
        query = session.query(LlmConfig)
        if active_only:
            query = query.filter(LlmConfig.is_active.is_(True))
        return [llm_to_dict(item) for item in query.order_by(LlmConfig.id).all()]


@app.post('/llm-configs/runtime')
def runtime_llm_config() -> dict[str, Any] | None:
    with SessionLocal() as session:
        config = (
            session.query(LlmConfig)
            .filter(LlmConfig.is_active.is_(True))
            .order_by(LlmConfig.id)
            .first()
        )
        if not config:
            return None
        return {
            'id': config.id,
            'name': config.name,
            'provider': config.provider,
            'model': config.model,
            'api_key': decrypt_secret(config.api_key_encrypted) if config.api_key_encrypted else None,
            'base_url': config.base_url,
            'temperature': config.temperature,
            'max_tokens': config.max_tokens,
        }


@app.post('/llm-configs', status_code=201)
def create_llm_config(request: LlmConfigRequest) -> dict[str, Any]:
    config = LlmConfig(
        name=request.name,
        provider=request.provider,
        model=request.model,
        api_key_encrypted=encrypt_secret(request.api_key) if request.api_key else None,
        base_url=request.base_url,
        temperature=request.temperature,
        max_tokens=request.max_tokens,
        is_active=request.is_active,
    )
    with SessionLocal() as session:
        if request.is_active:
            session.query(LlmConfig).update({'is_active': False})
        session.add(config)
        try:
            session.commit()
        except IntegrityError:
            session.rollback()
            raise HTTPException(status_code=409, detail='LLM config name already exists') from None
        session.refresh(config)
        return llm_to_dict(config)


@app.put('/llm-configs/{config_id}')
def update_llm_config(config_id: int, request: LlmConfigRequest) -> dict[str, Any]:
    with SessionLocal() as session:
        config = session.get(LlmConfig, config_id)
        if not config:
            raise HTTPException(status_code=404, detail='LLM config not found')
        config.name = request.name
        config.provider = request.provider
        config.model = request.model
        config.base_url = request.base_url
        config.temperature = request.temperature
        config.max_tokens = request.max_tokens
        if request.api_key:
            config.api_key_encrypted = encrypt_secret(request.api_key)
        if request.is_active:
            session.query(LlmConfig).filter(LlmConfig.id != config_id).update({'is_active': False})
        config.is_active = request.is_active
        try:
            session.commit()
        except IntegrityError:
            session.rollback()
            raise HTTPException(status_code=409, detail='LLM config name already exists') from None
        session.refresh(config)
        return llm_to_dict(config)


@app.post('/llm-configs/{config_id}/activate')
def activate_llm_config(config_id: int) -> dict[str, Any]:
    with SessionLocal() as session:
        config = session.get(LlmConfig, config_id)
        if not config:
            raise HTTPException(status_code=404, detail='LLM config not found')
        session.query(LlmConfig).update({'is_active': False})
        config.is_active = True
        session.commit()
        session.refresh(config)
        return llm_to_dict(config)


@app.delete('/llm-configs/{config_id}')
def delete_llm_config(config_id: int) -> dict[str, str]:
    with SessionLocal() as session:
        config = session.get(LlmConfig, config_id)
        if not config:
            raise HTTPException(status_code=404, detail='LLM config not found')
        session.delete(config)
        session.commit()
    return {'status': 'deleted'}


@app.post('/llm-configs/{config_id}/test')
def test_llm_config(config_id: int) -> dict[str, Any]:
    with SessionLocal() as session:
        config = session.get(LlmConfig, config_id)
        if not config:
            raise HTTPException(status_code=404, detail='LLM config not found')
        api_key = decrypt_secret(config.api_key_encrypted) if config.api_key_encrypted else None
        provider = config.provider
        model = config.model
        base_url = (config.base_url or '').rstrip('/')
    started = time.monotonic()
    try:
        if provider == 'ollama':
            if not base_url:
                base_url = 'http://localhost:11434'
            payload = {'model': model, 'messages': [{'role': 'user', 'content': 'ping'}], 'stream': False}
            headers = {}
            url = base_url + '/api/chat'
        elif provider == 'anthropic':
            if not api_key:
                raise RuntimeError('API key is required')
            url = (base_url or 'https://api.anthropic.com') + '/v1/messages'
            headers = {'x-api-key': api_key, 'anthropic-version': '2023-06-01'}
            payload = {'model': model, 'max_tokens': 16, 'messages': [{'role': 'user', 'content': 'ping'}]}
        else:
            if not api_key:
                raise RuntimeError('API key is required')
            default_urls = {
                'openai': 'https://api.openai.com/v1',
                'deepseek': 'https://api.deepseek.com/v1',
            }
            url = base_url or default_urls.get(provider, '')
            if not url:
                raise RuntimeError('base_url is required')
            url += '/chat/completions'
            headers = {'Authorization': 'Bearer ' + api_key}
            payload = {'model': model, 'messages': [{'role': 'user', 'content': 'ping'}], 'max_tokens': 16}
        with httpx.Client(timeout=20) as client:
            response = client.post(url, headers=headers, json=payload)
            response.raise_for_status()
            body = response.json()
        if provider == 'ollama':
            preview = body.get('message', {}).get('content', '')
        elif provider == 'anthropic':
            preview = body.get('content', [{}])[0].get('text', '')
        else:
            preview = body.get('choices', [{}])[0].get('message', {}).get('content', '')
        return {'ok': True, 'latency_ms': int((time.monotonic() - started) * 1000), 'reply_preview': preview, 'error': None}
    except Exception as exc:
        return {'ok': False, 'latency_ms': int((time.monotonic() - started) * 1000), 'reply_preview': '', 'error': str(exc)}


def sql_example_to_dict(example: SqlExample) -> dict[str, Any]:
    return {
        'id': example.id,
        'question': example.question,
        'sql': example.sql,
        'metric_name': example.metric_name,
        'created_at': example.created_at.isoformat(),
    }


@app.get('/sql-examples')
def list_sql_examples() -> list[dict[str, Any]]:
    with SessionLocal() as session:
        return [sql_example_to_dict(item) for item in session.query(SqlExample).order_by(SqlExample.id.desc()).all()]


@app.post('/sql-examples', status_code=201)
def create_sql_example(request: SqlExampleRequest) -> dict[str, Any]:
    example = SqlExample(question=request.question, sql=request.sql, metric_name=request.metric_name)
    with SessionLocal() as session:
        session.add(example)
        session.commit()
        session.refresh(example)
        return sql_example_to_dict(example)


@app.put('/sql-examples/{example_id}')
def update_sql_example(example_id: int, request: SqlExampleRequest) -> dict[str, Any]:
    with SessionLocal() as session:
        example = session.get(SqlExample, example_id)
        if not example:
            raise HTTPException(status_code=404, detail='SQL example not found')
        example.question = request.question
        example.sql = request.sql
        example.metric_name = request.metric_name
        session.commit()
        session.refresh(example)
        return sql_example_to_dict(example)


@app.delete('/sql-examples/{example_id}')
def delete_sql_example(example_id: int) -> dict[str, str]:
    with SessionLocal() as session:
        example = session.get(SqlExample, example_id)
        if not example:
            raise HTTPException(status_code=404, detail='SQL example not found')
        session.delete(example)
        session.commit()
    return {'status': 'deleted'}


@app.post('/sql-examples/reindex')
async def reindex_sql_examples() -> dict[str, Any]:
    await call_service(ARTIFACT_PARSER_URL + '/sync')
    with SessionLocal() as session:
        count = session.query(SqlExample).count()
    return {'status': 'ok', 'count': count}


@app.post('/sql-examples/search')
def search_sql_examples(request: dict[str, str]) -> list[dict[str, Any]]:
    query = request.get('query', '').lower()
    with SessionLocal() as session:
        examples = session.query(SqlExample).all()
    scored = []
    for example in examples:
        text = (example.question + ' ' + example.sql + ' ' + (example.metric_name or '')).lower()
        score = sum(1 for token in query.split() if token and token in text)
        if score:
            scored.append((score, sql_example_to_dict(example)))
    scored.sort(key=lambda item: item[0], reverse=True)
    return [item for _, item in scored[:3]]


DEFAULT_SETTINGS = {
    'context': {
        'history_window': 20,
        'compression_threshold_tokens': 120000,
        'max_clarification_rounds': 2,
        'persist_clarified_contexts': True,
    },
    'sandbox': {
        'timeout_seconds': 30,
        'max_rows': 1000,
        'mask_rules': [{'field_pattern': 'phone*', 'strategy': 'mask_middle'}],
        'forbidden_keywords': ['insert', 'update', 'delete', 'drop', 'truncate', 'alter', 'create', 'grant', 'revoke'],
    },
}


@app.get('/settings/{key}')
def get_setting(key: str) -> dict[str, Any]:
    if key not in DEFAULT_SETTINGS:
        raise HTTPException(status_code=404, detail='setting not found')
    with SessionLocal() as session:
        setting = session.get(Setting, key)
        if not setting:
            return DEFAULT_SETTINGS[key]
        return json.loads(setting.value)


@app.put('/settings/{key}')
def put_setting(key: str, request: SettingRequest) -> dict[str, Any]:
    if key not in DEFAULT_SETTINGS:
        raise HTTPException(status_code=404, detail='setting not found')
    value = {**DEFAULT_SETTINGS[key], **request.value}
    if key == 'context':
        if not 5 <= value['history_window'] <= 100:
            raise HTTPException(status_code=422, detail='history_window must be 5-100')
        if not 32000 <= value['compression_threshold_tokens'] <= 200000:
            raise HTTPException(status_code=422, detail='compression_threshold_tokens must be 32000-200000')
        if not 1 <= value['max_clarification_rounds'] <= 3:
            raise HTTPException(status_code=422, detail='max_clarification_rounds must be 1-3')
    if key == 'sandbox':
        if not 10 <= value['timeout_seconds'] <= 120:
            raise HTTPException(status_code=422, detail='timeout_seconds must be 10-120')
        if not 100 <= value['max_rows'] <= 10000:
            raise HTTPException(status_code=422, detail='max_rows must be 100-10000')
    with SessionLocal() as session:
        setting = session.get(Setting, key)
        if setting:
            setting.value = json.dumps(value, ensure_ascii=False)
        else:
            session.add(Setting(key=key, value=json.dumps(value, ensure_ascii=False)))
        session.commit()
    return value


def rag_space_to_dict(space: RagSpace, doc_count: int) -> dict[str, Any]:
    return {
        'id': space.id,
        'name': space.name,
        'enabled': space.enabled,
        'doc_count': doc_count,
        'created_at': space.created_at.isoformat(),
        'updated_at': space.updated_at.isoformat(),
    }


@app.get('/rag/spaces')
def list_rag_spaces() -> list[dict[str, Any]]:
    with SessionLocal() as session:
        spaces = session.query(RagSpace).order_by(RagSpace.id).all()
        result = []
        for space in spaces:
            count = session.query(RagDoc).filter(RagDoc.space_id == space.id).count()
            result.append(rag_space_to_dict(space, count))
        return result


@app.post('/rag/spaces', status_code=201)
def create_rag_space(request: RagSpaceRequest) -> dict[str, Any]:
    space = RagSpace(name=request.name, enabled=request.enabled)
    with SessionLocal() as session:
        session.add(space)
        try:
            session.commit()
        except IntegrityError:
            session.rollback()
            raise HTTPException(status_code=409, detail='RAG space name already exists') from None
        session.refresh(space)
        return rag_space_to_dict(space, 0)


@app.put('/rag/spaces/{space_id}')
def update_rag_space(space_id: int, request: RagSpaceRequest) -> dict[str, Any]:
    with SessionLocal() as session:
        space = session.get(RagSpace, space_id)
        if not space:
            raise HTTPException(status_code=404, detail='RAG space not found')
        space.name = request.name
        space.enabled = request.enabled
        try:
            session.commit()
        except IntegrityError:
            session.rollback()
            raise HTTPException(status_code=409, detail='RAG space name already exists') from None
        session.refresh(space)
        count = session.query(RagDoc).filter(RagDoc.space_id == space.id).count()
        return rag_space_to_dict(space, count)


@app.delete('/rag/spaces/{space_id}')
def delete_rag_space(space_id: int) -> dict[str, str]:
    with SessionLocal() as session:
        space = session.get(RagSpace, space_id)
        if not space:
            raise HTTPException(status_code=404, detail='RAG space not found')
        session.query(RagDoc).filter(RagDoc.space_id == space_id).delete()
        session.delete(space)
        session.commit()
    return {'status': 'deleted'}


@app.get('/rag/spaces/{space_id}/docs')
def list_rag_docs(space_id: int) -> list[dict[str, Any]]:
    with SessionLocal() as session:
        docs = session.query(RagDoc).filter(RagDoc.space_id == space_id).all()
        return [{
            'id': doc.id,
            'space_id': doc.space_id,
            'file_name': doc.file_name,
            'chunk_count': doc.chunk_count,
            'created_at': doc.created_at.isoformat(),
        } for doc in docs]


@app.post('/rag/spaces/{space_id}/docs', status_code=201)
async def upload_rag_doc(space_id: int, file: UploadFile) -> dict[str, Any]:
    content_bytes = await file.read()
    if len(content_bytes) > 20 * 1024 * 1024:
        raise HTTPException(status_code=413, detail='file exceeds 20MB')
    suffix = Path(file.filename or 'document.txt').suffix.lower()
    if suffix == '.pdf':
        try:
            from pypdf import PdfReader
            import io
            reader = PdfReader(io.BytesIO(content_bytes))
            content = '\n'.join(page.extract_text() or '' for page in reader.pages)
        except Exception as exc:
            raise HTTPException(status_code=422, detail='PDF parse failed: ' + str(exc)) from exc
    elif suffix in ('.md', '.txt'):
        content = content_bytes.decode('utf-8', errors='replace')
    else:
        raise HTTPException(status_code=422, detail='only .md, .txt and .pdf are supported')
    chunk_count = max(1, (len(content) // 2000) + 1)
    with SessionLocal() as session:
        space = session.get(RagSpace, space_id)
        if not space:
            raise HTTPException(status_code=404, detail='RAG space not found')
        doc = RagDoc(space_id=space_id, file_name=file.filename or 'document.txt', chunk_count=chunk_count, content=content)
        session.add(doc)
        session.commit()
        session.refresh(doc)
        return {'id': doc.id, 'space_id': doc.space_id, 'file_name': doc.file_name, 'chunk_count': doc.chunk_count}


@app.delete('/rag/docs/{doc_id}')
def delete_rag_doc(doc_id: int) -> dict[str, str]:
    with SessionLocal() as session:
        doc = session.get(RagDoc, doc_id)
        if not doc:
            raise HTTPException(status_code=404, detail='document not found')
        session.delete(doc)
        session.commit()
    return {'status': 'deleted'}


@app.get('/rag/active-spaces')
def active_rag_spaces() -> list[dict[str, Any]]:
    with SessionLocal() as session:
        spaces = session.query(RagSpace).filter(RagSpace.enabled.is_(True)).all()
        result = []
        for space in spaces:
            docs = session.query(RagDoc).filter(RagDoc.space_id == space.id).all()
            result.append({
                'id': space.id,
                'name': space.name,
                'docs': [{'file_name': doc.file_name, 'content': doc.content} for doc in docs],
            })
        return result


ALLOWED_TOOLS = {
    'search_schema', 'query_metric', 'execute_sql', 'explain_metric',
    'ask_clarification', 'render_table',
}
UNSAFE_PROMPT_FRAGMENTS = ('忽略以上规则', '绕过沙箱', '直接执行写操作')


def skill_to_dict(skill: Skill) -> dict[str, Any]:
    return {
        'id': skill.id,
        'name': skill.name,
        'description': skill.description,
        'trigger_keywords': json.loads(skill.trigger_keywords),
        'prompt_addition': skill.prompt_addition,
        'allowed_tools': json.loads(skill.allowed_tools),
        'enabled': skill.enabled,
        'created_at': skill.created_at.isoformat(),
        'updated_at': skill.updated_at.isoformat(),
    }


def export_skill_markdown(skill: Skill) -> None:
    keywords = ', '.join(json.loads(skill.trigger_keywords))
    tools = ', '.join(json.loads(skill.allowed_tools)) or '全部'
    content = (
        '---\n'
        'id: ' + str(skill.id) + '\n'
        'name: ' + skill.name + '\n'
        'enabled: ' + str(skill.enabled).lower() + '\n'
        'trigger_keywords: ' + json.dumps(json.loads(skill.trigger_keywords), ensure_ascii=False) + '\n'
        'allowed_tools: ' + json.dumps(json.loads(skill.allowed_tools), ensure_ascii=False) + '\n'
        '---\n\n'
        '# ' + skill.name + '\n\n'
        + skill.description + '\n\n'
        '触发场景: ' + keywords + '\n\n'
        '允许工具: ' + tools + '\n\n'
        '## Prompt\n\n' + skill.prompt_addition + '\n'
    )
    path = SKILLS_DIR / (skill.name + '.md')
    path.write_text(content, encoding='utf-8')


def validate_skill_request(request: SkillRequest) -> None:
    for fragment in UNSAFE_PROMPT_FRAGMENTS:
        if fragment in request.prompt_addition:
            raise HTTPException(status_code=422, detail='prompt_addition contains unsafe instruction')
    invalid_tools = sorted(set(request.allowed_tools) - ALLOWED_TOOLS)
    if invalid_tools:
        raise HTTPException(status_code=422, detail='invalid tools: ' + ', '.join(invalid_tools))


@app.get('/skills')
def list_skills(enabled: bool | None = None) -> list[dict[str, Any]]:
    with SessionLocal() as session:
        query = session.query(Skill)
        if enabled is not None:
            query = query.filter(Skill.enabled.is_(enabled))
        return [skill_to_dict(item) for item in query.order_by(Skill.updated_at.desc()).all()]


@app.post('/skills', status_code=201)
def create_skill(request: SkillRequest) -> dict[str, Any]:
    validate_skill_request(request)
    skill = Skill(
        name=request.name,
        description=request.description,
        trigger_keywords=json.dumps(request.trigger_keywords, ensure_ascii=False),
        prompt_addition=request.prompt_addition,
        allowed_tools=json.dumps(request.allowed_tools, ensure_ascii=False),
        enabled=request.enabled,
    )
    with SessionLocal() as session:
        session.add(skill)
        try:
            session.commit()
        except IntegrityError:
            session.rollback()
            raise HTTPException(status_code=409, detail='skill name already exists') from None
        session.refresh(skill)
        export_skill_markdown(skill)
        return skill_to_dict(skill)


@app.put('/skills/{skill_id}')
def update_skill(skill_id: int, request: SkillRequest) -> dict[str, Any]:
    validate_skill_request(request)
    with SessionLocal() as session:
        skill = session.get(Skill, skill_id)
        if not skill:
            raise HTTPException(status_code=404, detail='skill not found')
        previous_name = skill.name
        skill.name = request.name
        skill.description = request.description
        skill.trigger_keywords = json.dumps(request.trigger_keywords, ensure_ascii=False)
        skill.prompt_addition = request.prompt_addition
        skill.allowed_tools = json.dumps(request.allowed_tools, ensure_ascii=False)
        skill.enabled = request.enabled
        try:
            session.commit()
        except IntegrityError:
            session.rollback()
            raise HTTPException(status_code=409, detail='skill name already exists') from None
        session.refresh(skill)
        export_skill_markdown(skill)
        if previous_name != skill.name:
            previous_path = SKILLS_DIR / (previous_name + '.md')
            if previous_path.exists():
                previous_path.unlink()
        return skill_to_dict(skill)


@app.delete('/skills/{skill_id}')
def delete_skill(skill_id: int) -> dict[str, str]:
    with SessionLocal() as session:
        skill = session.get(Skill, skill_id)
        if not skill:
            raise HTTPException(status_code=404, detail='skill not found')
        path = SKILLS_DIR / (skill.name + '.md')
        session.delete(skill)
        session.commit()
    if path.exists():
        path.unlink()
    return {'status': 'deleted'}


@app.exception_handler(Exception)
async def registry_error_handler(_request, exc):
    return JSONResponse(status_code=500, content={'message': str(exc)})
