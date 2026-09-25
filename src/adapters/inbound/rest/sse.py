import asyncio
import time
from typing import AsyncIterator

from src.domain.entities import QueryResult
from src.domain.ports import QueryRepositoryPort


def _payload(r: QueryResult) -> dict:
    data = {
        "result_id": r.id,
        "provider": r.provider,
        "status": r.status.value,
        "progress_message": r.progress_message,
    }
    if r.status.value == "done":
        data.update(answer=r.answer, citations=r.citations)
    elif r.status.value == "failed":
        data["error_message"] = r.error_message
    return data


async def stream_events(
    repo: QueryRepositoryPort, query_id: str, interval: float = 1.0, idle_timeout: float = 1800.0
) -> AsyncIterator[tuple[str, dict]]:
    """DB 폴링 → 변경분만 (event, data)로 내보내는 브릿지 (PLAN §4.11).

    첫 폴링은 현재 스냅샷을 result_update로, 이후 새로 생긴 결과는 result_added로 보낸다.
    자동 종료하지 않으며 idle_timeout이 지나면 끝낸다.
    """
    known: dict[str, tuple] = {}
    first = True
    started = time.monotonic()
    while time.monotonic() - started < idle_timeout:
        for r in await repo.get_results(query_id):
            sig = (r.status, r.progress_message, r.updated_at)
            if r.id not in known:
                yield ("result_update" if first else "result_added"), _payload(r)
            elif known[r.id] != sig:
                yield "result_update", _payload(r)
            known[r.id] = sig
        first = False
        await asyncio.sleep(interval)
