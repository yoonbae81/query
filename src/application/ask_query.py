import asyncio
import time
from dataclasses import dataclass

from src.application.submit_query import SubmitQuery
from src.domain.entities import PRIORITY_HIGH, QueryResult, ResultStatus
from src.domain.errors import InvalidRequest
from src.domain.ports import QueryRepositoryPort

_TERMINAL = {ResultStatus.DONE, ResultStatus.FAILED}


@dataclass
class AskOutcome:
    query_id: str
    results: list[QueryResult]
    timed_out: bool


class AskQuery:
    """동기 질의 (PLAN §4.6, §7.1): 높은 우선순위로 등록 후 완료/타임아웃까지 대기."""

    def __init__(
        self,
        submit: SubmitQuery,
        repo: QueryRepositoryPort,
        default_timeout: int = 60,
        max_timeout: int = 300,
        poll_interval: float = 0.5,
    ):
        self._submit = submit
        self._repo = repo
        self._default = default_timeout
        self._max = max_timeout
        self._poll = poll_interval

    async def execute(
        self, question: str, providers: list[str] | None = None, timeout_seconds: float | None = None
    ) -> AskOutcome:
        if timeout_seconds is None:
            timeout = self._default
        elif timeout_seconds <= 0:
            raise InvalidRequest("timeout_seconds는 0보다 커야 합니다.")
        else:
            timeout = min(timeout_seconds, self._max)

        submitted = await self._submit.submit(question, providers, priority=PRIORITY_HIGH)
        query_id = submitted.query.id
        deadline = time.monotonic() + timeout
        while True:
            results = await self._repo.get_results(query_id)
            if all(r.status in _TERMINAL for r in results):
                return AskOutcome(query_id, results, timed_out=False)
            if time.monotonic() >= deadline:
                return AskOutcome(query_id, results, timed_out=True)
            await asyncio.sleep(min(self._poll, max(deadline - time.monotonic(), 0)))
