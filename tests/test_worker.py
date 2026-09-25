import asyncio
from datetime import datetime, timedelta, timezone

import pytest

from src.adapters.outbound.config.file_system_prompt_adapter import FileSystemPromptAdapter
from src.adapters.outbound.repository.sqlite_query_repository_adapter import SqliteQueryRepositoryAdapter
from src.adapters.outbound.storage.file_answer_storage_adapter import FileAnswerStorageAdapter
from src.application.cleanup_expired_results import CleanupExpiredResults
from src.application.process_pending_result import ProcessPendingResult
from src.application.submit_query import SubmitQuery
from src.domain.entities import PRIORITY_HIGH, ProviderAnswer, ResultStatus
from src.domain.ports import LLMProviderPort
from src.worker import WorkerLoop


class FakeProvider(LLMProviderPort):
    def __init__(self, fail_times: int = 0, delay: float = 0.0):
        self.fail_times = fail_times
        self.delay = delay
        self.calls: list[str] = []

    async def ask(self, system_prompt, question, on_progress):
        self.calls.append(question)
        await on_progress("답변 대기 중")
        if self.delay:
            await asyncio.sleep(self.delay)
        if len(self.calls) <= self.fail_times:
            raise TimeoutError("boom")
        return ProviderAnswer(text=f"answer to {question} [{system_prompt}]", citations=["http://src"])


@pytest.fixture
async def env(tmp_path):
    user = tmp_path / "user"
    repo = SqliteQueryRepositoryAdapter(user / "query.db")
    await repo.init()
    prompt = FileSystemPromptAdapter(user / "config" / "system_prompt.md")
    await prompt.write("SYS")
    storage = FileAnswerStorageAdapter(user / "answers")
    submit = SubmitQuery(repo, {"perplexity"}, ["perplexity"])
    return repo, prompt, storage, submit, user


def make_processor(env, provider, max_retry=2):
    repo, prompt, storage, *_ = env
    return ProcessPendingResult(repo, {"perplexity": provider}, storage, prompt, max_retry, retry_backoff_seconds=0)


async def test_process_success_writes_file_and_db(env):
    repo, _, _, submit, user = env
    s = await submit.submit("hello")
    [claimed] = await repo.claim_pending(datetime.now(timezone.utc), 1)
    await make_processor(env, FakeProvider()).execute(claimed)

    r = await repo.get_result(s.results[0].id)
    assert r.status == ResultStatus.DONE
    assert r.answer == "answer to hello [SYS]" and r.citations == ["http://src"]
    assert r.system_prompt_snapshot == "SYS" and r.progress_message is None
    assert r.answer_file_path.startswith("answers/") and r.answer_file_path.endswith(f"_{s.query.id}_perplexity.md")
    text = (user / r.answer_file_path).read_text(encoding="utf-8")
    assert "## Question\nhello" in text and "- http://src" in text and "+09:00" in text


async def test_retry_then_failed_after_max_retry(env):
    repo, *_, submit, _ = env
    s = await submit.submit("q")
    rid = s.results[0].id
    proc = make_processor(env, FakeProvider(fail_times=99), max_retry=2)
    for expected in (ResultStatus.PENDING, ResultStatus.PENDING, ResultStatus.FAILED):
        [claimed] = await repo.claim_pending(datetime.now(timezone.utc) + timedelta(seconds=1), 1)
        await proc.execute(claimed)
        assert (await repo.get_result(rid)).status == expected
    assert (await repo.get_result(rid)).retry_count == 3  # 최초 1회 + 재시도 2회


async def test_unregistered_provider_fails_without_crash(env):
    repo, _, _, submit, _ = env
    s = await submit.submit("q")
    proc = ProcessPendingResult(repo, {}, env[2], env[1], max_retry=0)
    [claimed] = await repo.claim_pending(datetime.now(timezone.utc), 1)
    await proc.execute(claimed)
    r = await repo.get_result(s.results[0].id)
    assert r.status == ResultStatus.FAILED and "등록되지 않은 provider" in r.error_message


async def test_worker_loop_priority_and_concurrency(env):
    repo, _, storage, submit, _ = env
    for i in range(3):
        await submit.submit(f"bulk-{i}")
    provider = FakeProvider(delay=0.05)
    loop = WorkerLoop(
        repo, make_processor(env, provider), CleanupExpiredResults(repo, storage, 7),
        max_concurrent=1, poll_interval=0.01,
    )
    stop = asyncio.Event()
    task = asyncio.create_task(loop.run(stop))
    while not provider.calls:  # bulk-0이 슬롯을 점유한 상태에서 /ask 등록
        await asyncio.sleep(0.005)
    await submit.submit("ask", priority=PRIORITY_HIGH)

    page = None
    for _ in range(200):
        page = await repo.list_queries("done", None, 10, None)
        if len(page.items) == 4:
            break
        await asyncio.sleep(0.02)
    stop.set()
    await task
    assert provider.calls == ["bulk-0", "ask", "bulk-1", "bulk-2"]  # 선점은 없지만 다음 슬롯은 /ask 우선


async def test_worker_recovers_processing_on_start(env):
    repo, _, storage, submit, _ = env
    s = await submit.submit("q")
    await repo.claim_pending(datetime.now(timezone.utc), 1)  # 비정상 종료로 processing 잔여
    loop = WorkerLoop(repo, make_processor(env, FakeProvider()), CleanupExpiredResults(repo, storage, 7), poll_interval=0.01)
    stop = asyncio.Event()
    task = asyncio.create_task(loop.run(stop))
    for _ in range(100):
        if (await repo.get_result(s.results[0].id)).status == ResultStatus.DONE:
            break
        await asyncio.sleep(0.02)
    stop.set()
    await task
    assert (await repo.get_result(s.results[0].id)).status == ResultStatus.DONE


async def test_cleanup_removes_file_and_rows(env):
    repo, _, storage, submit, user = env
    s = await submit.submit("q")
    [claimed] = await repo.claim_pending(datetime.now(timezone.utc), 1)
    await make_processor(env, FakeProvider()).execute(claimed)
    path = user / (await repo.get_result(s.results[0].id)).answer_file_path
    assert path.exists()

    cleanup = CleanupExpiredResults(repo, storage, retention_days=7)
    assert await cleanup.execute() == 0
    assert await cleanup.execute(datetime.now(timezone.utc) + timedelta(days=8)) == 1
    assert not path.exists() and await repo.get_query(s.query.id) is None
