from datetime import datetime, timedelta, timezone

import pytest

from src.adapters.outbound.repository.sqlite_query_repository_adapter import SqliteQueryRepositoryAdapter
from src.application.add_provider_to_query import AddProviderToQuery
from src.application.retry_result import RetryResult
from src.application.submit_query import SubmitQuery
from src.domain.entities import PRIORITY_HIGH, ResultStatus
from src.domain.errors import Conflict, InvalidRequest, NotFound

AVAILABLE = {"perplexity", "claude"}


@pytest.fixture
async def repo(tmp_path):
    r = SqliteQueryRepositoryAdapter(tmp_path / "q.db")
    await r.init()
    return r


@pytest.fixture
def submit(repo):
    return SubmitQuery(repo, AVAILABLE, ["perplexity"], max_query_length=50)


async def test_submit_defaults_to_perplexity(submit, repo):
    s = await submit.submit("  hello  ")
    assert s.query.query_text == "hello"
    assert [r.provider for r in s.results] == ["perplexity"]
    assert (await repo.get_query(s.query.id)).providers == ["perplexity"]


async def test_submit_validation(submit):
    with pytest.raises(InvalidRequest):
        await submit.submit("   ")
    with pytest.raises(InvalidRequest):
        await submit.submit("x" * 51)
    with pytest.raises(InvalidRequest):
        await submit.submit("q", ["gemini"])


async def test_bulk_skips_blank_and_shares_batch(submit, repo):
    batch_id, items = await submit.submit_bulk(["a", "", "  ", "b"], ["perplexity", "claude"])
    assert len(items) == 2 and all(i.query.batch_id == batch_id for i in items)
    assert all(len(i.results) == 2 for i in items)
    with pytest.raises(InvalidRequest):
        await submit.submit_bulk(["", " "])


async def test_claim_orders_by_priority_then_fifo(submit, repo):
    await submit.submit("normal-1")
    await submit.submit("normal-2")
    high = await submit.submit("ask", priority=PRIORITY_HIGH)
    now = datetime.now(timezone.utc)
    claimed = await repo.claim_pending(now, 10)
    assert claimed[0].id == high.results[0].id
    assert len(claimed) == 3
    assert await repo.claim_pending(now, 10) == []  # 이미 processing


async def test_retry_backoff_and_failure_flow(submit, repo):
    s = await submit.submit("q")
    rid = s.results[0].id
    now = datetime.now(timezone.utc)
    await repo.claim_pending(now, 1)
    await repo.schedule_retry(rid, "boom", now + timedelta(seconds=30))
    assert await repo.claim_pending(now, 1) == []  # backoff 중
    assert len(await repo.claim_pending(now + timedelta(seconds=31), 1)) == 1
    await repo.mark_failed(rid, "boom2")
    r = await repo.get_result(rid)
    assert (r.status, r.retry_count) == (ResultStatus.FAILED, 2)

    await RetryResult(repo).execute(s.query.id, rid)
    r = await repo.get_result(rid)
    assert (r.status, r.retry_count, r.error_message) == (ResultStatus.PENDING, 0, None)
    with pytest.raises(Conflict):
        await RetryResult(repo).execute(s.query.id, rid)
    with pytest.raises(NotFound):
        await RetryResult(repo).execute("q_other", rid)


async def test_add_provider_is_idempotent(submit, repo):
    s = await submit.submit("q")
    add = AddProviderToQuery(repo, AVAILABLE)
    added = await add.execute(s.query.id, ["claude", "perplexity"])
    assert [r.provider for r in added] == ["claude"]
    assert await add.execute(s.query.id, ["claude"]) == []
    assert (await repo.get_query(s.query.id)).providers == ["perplexity", "claude"]
    with pytest.raises(NotFound):
        await add.execute("q_missing", ["claude"])


async def test_recover_done_and_cleanup(submit, repo):
    s = await submit.submit("q")
    rid = s.results[0].id
    await repo.claim_pending(datetime.now(timezone.utc), 1)
    assert await repo.recover_processing() == 1
    await repo.claim_pending(datetime.now(timezone.utc), 1)
    await repo.mark_done(rid, "ans", ["http://a"], "answers/x.md")
    r = await repo.get_result(rid)
    assert (r.status, r.answer, r.citations) == (ResultStatus.DONE, "ans", ["http://a"])

    assert await repo.find_expired(datetime.now(timezone.utc) - timedelta(days=1)) == []
    expired = await repo.find_expired(datetime.now(timezone.utc) + timedelta(days=1))
    await repo.delete_results([e.id for e in expired])
    assert await repo.get_query(s.query.id) is None  # 결과가 모두 정리되면 queries도 삭제


async def test_list_queries_pagination_and_filter(submit, repo):
    for i in range(5):
        await submit.submit(f"q{i}")
    p1 = await repo.list_queries(None, None, 2, None)
    assert len(p1.items) == 2 and p1.next_cursor
    p2 = await repo.list_queries(None, None, 2, p1.next_cursor)
    p3 = await repo.list_queries(None, None, 2, p2.next_cursor)
    ids = [q.id for q, _ in p1.items + p2.items + p3.items]
    assert len(set(ids)) == 5 and p3.next_cursor is None
    assert (await repo.list_queries("done", None, 10, None)).items == []
