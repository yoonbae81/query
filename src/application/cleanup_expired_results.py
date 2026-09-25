from datetime import datetime, timedelta, timezone

from src.domain.ports import AnswerFileStoragePort, QueryRepositoryPort


class CleanupExpiredResults:
    """done/failed 후 retention_days가 지난 결과와 답변 파일을 삭제 (PLAN §3.1)."""

    def __init__(self, repo: QueryRepositoryPort, storage: AnswerFileStoragePort, retention_days: int):
        self._repo = repo
        self._storage = storage
        self._days = retention_days

    async def execute(self, now: datetime | None = None) -> int:
        now = now or datetime.now(timezone.utc)
        expired = await self._repo.find_expired(now - timedelta(days=self._days))
        for r in expired:
            if r.answer_file_path:
                await self._storage.delete(r.answer_file_path)
        await self._repo.delete_results([r.id for r in expired])
        return len(expired)
