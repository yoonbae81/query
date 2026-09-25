import asyncio
import logging
import signal
from datetime import datetime, timezone

from src.adapters.outbound.config.file_system_prompt_adapter import FileSystemPromptAdapter
from src.adapters.outbound.repository.sqlite_query_repository_adapter import SqliteQueryRepositoryAdapter
from src.adapters.outbound.storage.file_answer_storage_adapter import FileAnswerStorageAdapter
from src.application.cleanup_expired_results import CleanupExpiredResults
from src.application.process_pending_result import ProcessPendingResult
from src.bootstrap import build_registry
from src.config import Settings
from src.domain.ports import QueryRepositoryPort

log = logging.getLogger("worker")


class WorkerLoop:
    """상시 실행 폴링 루프 (PLAN §6.1). 빈 슬롯 수만큼만 클레임하므로 priority 순서가 유지된다."""

    def __init__(
        self,
        repo: QueryRepositoryPort,
        processor: ProcessPendingResult,
        cleanup: CleanupExpiredResults,
        max_concurrent: int = 4,
        poll_interval: float = 1.0,
        cleanup_interval_hours: int = 24,
    ):
        self._repo = repo
        self._processor = processor
        self._cleanup = cleanup
        self._max = max_concurrent
        self._poll = poll_interval
        self._cleanup_every = cleanup_interval_hours * 3600
        self._tasks: set[asyncio.Task] = set()

    async def _cleanup_safely(self) -> None:
        try:
            n = await self._cleanup.execute()
            if n:
                log.info("만료 결과 %d건 정리", n)
        except Exception:  # noqa: BLE001
            log.exception("cleanup 실패")

    async def run(self, stop: asyncio.Event) -> None:
        recovered = await self._repo.recover_processing()
        if recovered:
            log.info("processing 잔여 %d건을 pending으로 복구", recovered)
        await self._cleanup_safely()
        clock = asyncio.get_running_loop().time
        last_cleanup = clock()

        while not stop.is_set():
            try:
                free = self._max - len(self._tasks)
                if free > 0:
                    for r in await self._repo.claim_pending(datetime.now(timezone.utc), free):
                        t = asyncio.create_task(self._processor.execute(r))
                        self._tasks.add(t)
                        t.add_done_callback(self._tasks.discard)
                if clock() - last_cleanup >= self._cleanup_every:
                    await self._cleanup_safely()
                    last_cleanup = clock()
            except Exception:  # noqa: BLE001 — 일시적 DB 오류로 루프가 죽지 않게
                log.exception("워커 루프 오류")
            try:
                await asyncio.wait_for(stop.wait(), timeout=self._poll)
            except asyncio.TimeoutError:
                pass

        # 종료: 진행 중 작업은 취소하고, 남은 processing 행은 다음 기동 시 복구된다
        for t in list(self._tasks):
            t.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    s = Settings()
    repo = SqliteQueryRepositoryAdapter(s.db_path)
    await repo.init()
    storage = FileAnswerStorageAdapter(s.answers_dir, s.display_timezone)
    processor = ProcessPendingResult(
        repo, build_registry(s), storage, FileSystemPromptAdapter(s.system_prompt_path),
        max_retry=s.max_retry, retry_backoff_seconds=s.retry_backoff_seconds,
    )
    loop = WorkerLoop(
        repo, processor, CleanupExpiredResults(repo, storage, s.retention_days),
        s.max_concurrent_workers, s.worker_poll_interval_seconds, s.cleanup_interval_hours,
    )

    stop = asyncio.Event()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            asyncio.get_running_loop().add_signal_handler(sig, stop.set)
        except NotImplementedError:  # Windows
            signal.signal(sig, lambda *_: stop.set())
    log.info("워커 시작")
    await loop.run(stop)
    log.info("워커 종료")


if __name__ == "__main__":
    asyncio.run(main())
