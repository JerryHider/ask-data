from __future__ import annotations

import hashlib
import os
import re
import time
from fnmatch import fnmatch
from pathlib import Path
from typing import Any

import pymysql
import sqlglot
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from models import add_audit_event

app = FastAPI(title="AskData SQL sandbox")

DEFAULT_DATASOURCE_URL = os.environ.get(
    "DATASOURCE_MYSQL_URL",
    "",
)
PROJECT_ROOT = Path(__file__).resolve().parents[2]
AUDIT_DATABASE = f"sqlite:///{PROJECT_ROOT / 'data' / 'audit.db'}"

ROLE_RULES: dict[str, dict[str, Any]] = {
    "admin": {
        "tables": None,
        "columns": {},
        "rows": None,
    },
    "analyst": {
        "tables": {"fct_*", "dim_*"},
        "denied_tables": {"fct_salary"},
        "columns": {"fct_orders": {"phone"}},
        "rows": None,
    },
    "viewer": {
        "tables": {"fct_orders"},
        "columns": {"fct_orders": {"cost", "phone"}},
        "rows": f"region = '{chr(0x534e)}{chr(0x4e1c)}'",
    },
}

USERS = {"admin": "admin", "analyst": "analyst", "viewer": "viewer"}


class ExecuteRequest(BaseModel):
    sql: str
    datasource: str = "mysql"
    user: str
    timeout_ms: int = Field(default=30_000, ge=100, le=120_000)


class AuditRequest(BaseModel):
    user: str
    session_id: str = ""
    event_type: str
    tool_name: str = ""
    sql_text: str = ""
    sql_hash: str = ""
    rows_affected: int = 0
    duration_ms: int = 0
    decision: str
    block_reason: str = ""
    question: str = ""


def sql_hash(sql: str) -> str:
    return hashlib.sha256(sql.encode("utf-8")).hexdigest()[:16]


def table_name(table: Any) -> str:
    if isinstance(table, str):
        return table
    if hasattr(table, "name"):
        return table.name
    return str(table)


def is_table_allowed(table: str, rules: dict[str, Any]) -> bool:
    allowed_tables = rules.get("tables")
    if allowed_tables is None:
        return True
    if table in allowed_tables:
        return True
    return any(
        fnmatch(table, pattern)
        for pattern in allowed_tables
        if any(character in pattern for character in "*?")
    )


def extract_tables(expression: sqlglot.Expression) -> set[str]:
    tables: set[str] = set()
    for table in expression.find_all(sqlglot.exp.Table):
        tables.add(table_name(table))
    return tables


def extract_columns(expression: sqlglot.Expression) -> set[str]:
    columns: set[str] = set()
    for column in expression.find_all(sqlglot.exp.Column):
        columns.add(column.name)
    return columns


def mask_value(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    if re.fullmatch(r"1[3-9]\d{9}", value):
        return f"{value[:3]}****{value[-4:]}"
    if "@" in value and re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", value):
        local, domain = value.split("@", 1)
        return f"{local[:2]}***@{domain}"
    return value


def mask_sql(sql: str) -> str:
    masked = re.sub(
        r"\b1[3-9]\d{9}\b",
        lambda match: f"{match.group()[:3]}****{match.group()[-4:]}",
        sql,
    )
    return re.sub(
        r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b",
        lambda match: f"{match.group().split('@')[0][:2]}***@{match.group().split('@')[1]}",
        masked,
    )


def validate_sql(expression: sqlglot.Expression) -> None:
    for node in expression.walk():
        node = node[0] if isinstance(node, tuple) else node
        if isinstance(node, sqlglot.exp.Insert):
            raise ValueError("Write operations are not allowed")
        if isinstance(node, sqlglot.exp.Update):
            raise ValueError("Write operations are not allowed")
        if isinstance(node, sqlglot.exp.Delete):
            raise ValueError("Write operations are not allowed")
        if isinstance(node, sqlglot.exp.Drop):
            raise ValueError("DDL operations are not allowed")
        if isinstance(node, sqlglot.exp.TruncateTable):
            raise ValueError("DDL operations are not allowed")
        if isinstance(node, sqlglot.exp.Alter):
            raise ValueError("DDL operations are not allowed")
        if isinstance(node, sqlglot.exp.Grant):
            raise ValueError("Permission operations are not allowed")


def append_limit(expression: sqlglot.Expression, limit: int) -> sqlglot.Expression:
    if isinstance(expression, sqlglot.exp.Select) and expression.args.get("limit") is None:
        expression.set("limit", sqlglot.exp.Limit(expression=sqlglot.exp.Literal.number(limit)))
    return expression


def inject_row_filter(
    expression: sqlglot.Expression, row_filter: str | None
) -> sqlglot.Expression:
    if not row_filter:
        return expression
    condition = sqlglot.parse_one(row_filter, read="mysql")
    if isinstance(expression, sqlglot.exp.Select):
        expression.where(condition, copy=False)
    return expression


def apply_sensitive_mask(columns: list[str], rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {column: mask_value(row.get(column)) for column in columns}
        for row in rows
    ]


def parse_mysql_url(url: str) -> dict[str, Any]:
    pattern = re.match(
        r"mysql://([^:]+):([^@]+)@([^:/]+)(?::(\d+))?/([^?]+)", url
    )
    if not pattern:
        raise ValueError("Invalid MySQL URL")
    user, password, host, port, database = pattern.groups()
    return {
        "user": user,
        "password": password,
        "host": host,
        "port": int(port or 3306),
        "database": database,
    }


@app.get("/health")
def health() -> dict[str, Any]:
    return {"status": "ok"}


@app.get("/perm/tables")
def perm_tables(user: str) -> list[str]:
    rules = ROLE_RULES.get(USERS.get(user, user), {})
    return sorted(rules.get("tables") or [])


@app.get("/perm/columns")
def perm_columns(user: str, table: str) -> list[str]:
    rules = ROLE_RULES.get(USERS.get(user, user), {})
    return sorted(rules.get("columns", {}).get(table, []))


@app.get("/perm/rows")
def perm_rows(user: str) -> str | None:
    rules = ROLE_RULES.get(USERS.get(user, user), {})
    return rules.get("rows")


@app.post("/execute")
def execute(request: ExecuteRequest) -> dict[str, Any]:
    started_at = time.monotonic()
    try:
        expression = sqlglot.parse_one(request.sql, read="mysql")
    except Exception as exc:
        add_audit_event(
            user=request.user,
            event_type="sql_blocked",
            sql_hash=sql_hash(request.sql),
            sql_text=mask_sql(request.sql),
            decision="blocked",
            block_reason=f"SQL parse failed: {exc}",
        )
        return JSONResponse(
            status_code=422,
            content={"error": True, "message": f"SQL parse failed: {exc}"},
        )

    try:
        validate_sql(expression)
        rules = ROLE_RULES.get(USERS.get(request.user, request.user))
        if rules is None:
            raise PermissionError(f"Unknown user: {request.user}")

        tables = extract_tables(expression)
        allowed_tables = rules.get("tables")
        denied_tables = rules.get("denied_tables") or set()
        if any(
            table in denied_tables or not is_table_allowed(table, rules)
            for table in tables
        ):
            raise PermissionError(f"Tables not allowed: {sorted(tables - allowed_tables)}")

        columns = extract_columns(expression)
        for table in tables:
            denied_columns = rules.get("columns", {}).get(table, set())
            if denied_columns and columns.intersection(denied_columns):
                raise PermissionError(
                    f"Columns not allowed: {sorted(columns.intersection(denied_columns))}"
                )

        expression = append_limit(expression, 1000)
        expression = inject_row_filter(expression, rules.get("rows"))
        guarded_sql = expression.sql(dialect="mysql")

        connection_config = parse_mysql_url(DEFAULT_DATASOURCE_URL)
        connection = pymysql.connect(**connection_config)
        try:
            with connection.cursor(pymysql.cursors.DictCursor) as cursor:
                cursor.execute(guarded_sql)
                rows = cursor.fetchall()
        finally:
            connection.close()

        result_columns = list(rows[0].keys()) if rows else []
        masked_rows = apply_sensitive_mask(result_columns, rows)
        duration_ms = int((time.monotonic() - started_at) * 1000)
        add_audit_event(
            user=request.user,
            event_type="sql_executed",
            sql_hash=sql_hash(request.sql),
            sql_text=mask_sql(guarded_sql),
            rows_affected=len(masked_rows),
            duration_ms=duration_ms,
            decision="allowed",
        )
        return {
            "columns": result_columns,
            "rows": masked_rows,
            "rowCount": len(masked_rows),
            "durationMs": duration_ms,
            "sql": guarded_sql,
        }
    except (ValueError, PermissionError) as exc:
        add_audit_event(
            user=request.user,
            event_type="sql_blocked",
            sql_hash=sql_hash(request.sql),
            sql_text=mask_sql(request.sql),
            decision="blocked",
            block_reason=str(exc),
        )
        return JSONResponse(
            status_code=422,
            content={"error": True, "message": str(exc)},
        )


@app.post("/audit")
def audit(request: AuditRequest) -> dict[str, Any]:
    event = add_audit_event(
        user=request.user,
        session_id=request.session_id,
        event_type=request.event_type,
        tool_name=request.tool_name,
        sql_hash=request.sql_hash or sql_hash(request.sql_text),
        sql_text=mask_sql(request.sql_text),
        rows_affected=request.rows_affected,
        duration_ms=request.duration_ms,
        decision=request.decision,
        block_reason=request.block_reason,
        question=request.question,
    )
    return {"id": event.id}


@app.get("/audit")
def get_audit(limit: int = 20) -> list[dict[str, Any]]:
    from models import AuditEvent
    from sqlalchemy import select
    from sqlalchemy.orm import Session
    from models import engine

    with Session(engine) as session:
        events = session.scalars(
            select(AuditEvent).order_by(AuditEvent.id.desc()).limit(limit)
        ).all()
        return [
            {
                "id": event.id,
                "timestamp": event.timestamp.isoformat(),
                "user": event.user,
                "session_id": event.session_id,
                "event_type": event.event_type,
                "tool_name": event.tool_name,
                "sql_hash": event.sql_hash,
                "sql_text": event.sql_text,
                "rows_affected": event.rows_affected,
                "duration_ms": event.duration_ms,
                "decision": event.decision,
                "block_reason": event.block_reason,
                "question": event.question,
            }
            for event in events
        ]
