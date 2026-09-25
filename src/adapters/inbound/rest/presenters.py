from datetime import datetime
from zoneinfo import ZoneInfo

from src.domain.entities import Query, QueryResult


def fmt_time(dt: datetime | None, tz: str) -> str | None:
    """DB의 UTC 시각을 표시용 시간대(KST)로 변환 (PLAN §3.0)."""
    return dt.astimezone(ZoneInfo(tz)).isoformat(timespec="seconds") if dt else None


def result_created(r: QueryResult) -> dict:
    return {"result_id": r.id, "provider": r.provider, "status": r.status.value}


def result_detail(r: QueryResult, tz: str) -> dict:
    return {
        "result_id": r.id,
        "provider": r.provider,
        "status": r.status.value,
        "answer": r.answer,
        "citations": r.citations,
        "answer_file_path": r.answer_file_path,
        "system_prompt_snapshot": r.system_prompt_snapshot,
        "progress_message": r.progress_message,
        "error_message": r.error_message,
        "retry_count": r.retry_count,
        "updated_at": fmt_time(r.updated_at, tz),
    }


def result_ask(r: QueryResult) -> dict:
    data = {"provider": r.provider, "status": r.status.value, "answer": r.answer, "citations": r.citations}
    if r.error_message and r.status.value == "failed":
        data["error_message"] = r.error_message
    return data


def query_detail(q: Query, results: list[QueryResult], tz: str) -> dict:
    return {
        "query_id": q.id,
        "batch_id": q.batch_id,
        "query": q.query_text,
        "created_at": fmt_time(q.created_at, tz),
        "results": [result_detail(r, tz) for r in results],
    }


def query_summary(q: Query, results: list[QueryResult], tz: str) -> dict:
    return {
        "query_id": q.id,
        "batch_id": q.batch_id,
        "query": q.query_text,
        "created_at": fmt_time(q.created_at, tz),
        "results_summary": [{"provider": r.provider, "status": r.status.value} for r in results],
    }
