from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import DateTime, Integer, String, Text, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, Session


class Base(DeclarativeBase):
    pass


class AuditEvent(Base):
    __tablename__ = "audit_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    timestamp: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )
    user: Mapped[str] = mapped_column(String(128))
    session_id: Mapped[str] = mapped_column(String(128), default="")
    event_type: Mapped[str] = mapped_column(String(64))
    tool_name: Mapped[str] = mapped_column(String(128), default="")
    sql_hash: Mapped[str] = mapped_column(String(32), default="")
    sql_text: Mapped[str] = mapped_column(Text, default="")
    rows_affected: Mapped[int] = mapped_column(Integer, default=0)
    duration_ms: Mapped[int] = mapped_column(Integer, default=0)
    decision: Mapped[str] = mapped_column(String(16))
    block_reason: Mapped[str] = mapped_column(Text, default="")
    question: Mapped[str] = mapped_column(Text, default="")


DATABASE_PATH = Path(__file__).resolve().parents[2] / "data" / "audit.db"
engine = create_engine(f"sqlite:///{DATABASE_PATH}", connect_args={"check_same_thread": False})
Base.metadata.create_all(engine)


def add_audit_event(**values: object) -> AuditEvent:
    event = AuditEvent(**values)
    with Session(engine) as session:
        session.add(event)
        session.commit()
        session.refresh(event)
    return event
