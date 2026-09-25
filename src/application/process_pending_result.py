import logging
from datetime import datetime, timedelta, timezone

from src.domain.entities import QueryResult, utcnow
from src.domain.ports import (
    AnswerFileStoragePort,
    LLMProviderPort,
    QueryRepositoryPort,
    SystemPromptConfigPort,
)

log = logging.getLogger(__name__)


class ProcessPendingResult:
    """워커가 클레임(processing 전환)한 결과 1건을 처리 (PLAN §6.1 _process_one)."""

    def __init__(
        self,
        repo: QueryRepositoryPort,
        registry: dict[str, LLMProviderPort],
        storage: AnswerFileStoragePort,
        prompt: SystemPromptConfigPort,
        max_retry: int = 2,
        retry_backoff_seconds: int = 30,
    ):
        self._repo = repo
        self._registry = registry
        self._storage = storage
        self._prompt = prompt
        self._max_retry = max_retry
        self._backoff = retry_backoff_seconds

    async def execute(self, result: QueryResult) -> None:
        try:
            await self._run(result)
        except Exception as e:  # noqa: BLE001 — 어떤 실패든 재시도 정책을 적용
            log.warning("result %s (%s) 실패: %s", result.id, result.provider, e)
            await self._handle_failure(result, f"{type(e).__name__}: {e}")

    async def _run(self, result: QueryResult) -> None:
        system_prompt, _ = await self._prompt.read()
        await self._repo.set_system_prompt_snapshot(result.id, system_prompt)

        query = await self._repo.get_query(result.query_id)
        if query is None:
            raise RuntimeError(f"query를 찾을 수 없습니다: {result.query_id}")
        provider = self._registry.get(result.provider)
        if provider is None:
            raise RuntimeError(f"등록되지 않은 provider: {result.provider}")

        async def on_progress(message: str) -> None:
            await self._repo.set_progress(result.id, message)

        answer = await provider.ask(system_prompt, query.query_text, on_progress)

        path = await self._storage.save(
            query_id=query.id,
            provider=result.provider,
            system_prompt=system_prompt,
            question=query.query_text,
            answer=answer,
            created_at=query.created_at,
            answered_at=utcnow(),
        )
        await self._repo.mark_done(result.id, answer.text, answer.citations, path)

    async def _handle_failure(self, result: QueryResult, message: str) -> None:
        # result.retry_count는 클레임 시점 값 — 이번 실패까지 포함하면 +1
        if result.retry_count + 1 <= self._max_retry:
            next_at = datetime.now(timezone.utc) + timedelta(seconds=self._backoff)
            await self._repo.schedule_retry(result.id, message, next_at)
        else:
            await self._repo.mark_failed(result.id, message)
