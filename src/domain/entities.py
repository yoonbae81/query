import secrets
import string
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum

_ID_CHARS = string.ascii_lowercase + string.digits


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def new_id(prefix: str) -> str:
    """`q_a3f9k2` 형태의 랜덤 ID (PLAN §3.0)."""
    return f"{prefix}_" + "".join(secrets.choice(_ID_CHARS) for _ in range(6))


class ResultStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    DONE = "done"
    FAILED = "failed"


PRIORITY_NORMAL = 0
PRIORITY_HIGH = 1


@dataclass
class Query:
    id: str
    query_text: str
    providers: list[str]
    batch_id: str | None = None
    created_at: datetime = field(default_factory=utcnow)


@dataclass
class QueryResult:
    id: str
    query_id: str
    provider: str
    status: ResultStatus = ResultStatus.PENDING
    priority: int = PRIORITY_NORMAL
    progress_message: str | None = None
    answer: str | None = None
    citations: list[str] | None = None
    answer_file_path: str | None = None
    system_prompt_snapshot: str | None = None
    error_message: str | None = None
    retry_count: int = 0
    next_attempt_at: datetime | None = None
    created_at: datetime = field(default_factory=utcnow)
    updated_at: datetime = field(default_factory=utcnow)


@dataclass
class ProviderAnswer:
    text: str
    citations: list[str] = field(default_factory=list)
