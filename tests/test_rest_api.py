import asyncio

import httpx
import pytest

from src.adapters.inbound.rest.app import create_app
from src.adapters.inbound.rest.sse import stream_events
from src.adapters.outbound.config.file_system_prompt_adapter import FileSystemPromptAdapter
from src.adapters.outbound.repository.sqlite_query_repository_adapter import SqliteQueryRepositoryAdapter
from src.adapters.outbound.storage.file_answer_storage_adapter import FileAnswerStorageAdapter
from src.application.cleanup_expired_results import CleanupExpiredResults
from src.application.process_pending_result import ProcessPendingResult
from src.config import Settings
from src.container import build_container
from src.worker import WorkerLoop
from tests.test_worker import FakeProvider

BASE = "/api/v1"


@pytest.fixture
async def ctx(tmp_path):
    user = tmp_path / "user"
    settings = Settings(
        db_path=str(user / "q.db"),
        system_prompt_path=str(user / "config" / "system_prompt.md"),
        answers_dir=str(user / "answers"),
        _env_file=None,
    )
    provider = FakeProvider(delay=0.05)
    container = build_container(settings, registry={"perplexity": provider, "claude": FakeProvider()})
    await container.repo.init()
    client = httpx.AsyncClient(transport=httpx.ASGITransport(app=create_app(container)), base_url="http://t")
    yield client, container, provider
    await client.aclose()


def start_worker(container):
    s = container.settings
    storage = FileAnswerStorageAdapter(s.answers_dir)
    proc = ProcessPendingResult(
        container.repo, container.registry, storage, FileSystemPromptAdapter(s.system_prompt_path),
        max_retry=0, retry_backoff_seconds=0,
    )
    loop = WorkerLoop(container.repo, proc, CleanupExpiredResults(container.repo, storage, 7), poll_interval=0.01)
    stop = asyncio.Event()
    return stop, asyncio.create_task(loop.run(stop))


async def test_providers_and_error_format(ctx):
    client, *_ = ctx
    body = (await client.get(f"{BASE}/providers")).json()
    avail = {p["id"]: p["available"] for p in body["providers"]}
    assert avail == {"perplexity": True, "claude": True, "gemini": False, "chatgpt": False}

    r = await client.post(f"{BASE}/queries", json={"query": "  "})
    assert r.status_code == 400 and r.json()["error"]["code"] == "INVALID_REQUEST"
    r = await client.post(f"{BASE}/queries", json={"query": "q", "providers": ["gemini"]})
    assert r.status_code == 400
    r = await client.post(f"{BASE}/queries", json={})  # 스키마 위반도 동일 포맷
    assert r.status_code == 400 and r.json()["error"]["code"] == "INVALID_REQUEST"
    assert (await client.get(f"{BASE}/queries/q_nope")).status_code == 404
    assert (await client.get(f"{BASE}/queries/q_nope/stream")).status_code == 404
    assert (await client.get(f"{BASE}/queries", params={"limit": 500})).status_code == 400


async def test_submit_list_detail_and_add_provider(ctx):
    client, *_ = ctx
    r = await client.post(f"{BASE}/queries", json={"query": "hello"})
    assert r.status_code == 201
    body = r.json()
    assert body["created_at"].endswith("+09:00")
    qid = body["query_id"]
    assert body["results"][0]["provider"] == "perplexity"

    bulk = await client.post(f"{BASE}/queries/bulk", json={"queries": ["a", "", "b"]})
    assert bulk.status_code == 201 and len(bulk.json()["items"]) == 2

    added = await client.post(f"{BASE}/queries/{qid}/providers", json={"providers": ["claude", "perplexity"]})
    assert added.status_code == 201 and [x["provider"] for x in added.json()["results"]] == ["claude"]
    again = await client.post(f"{BASE}/queries/{qid}/providers", json={"providers": ["claude"]})
    assert again.status_code == 200 and again.json()["results"] == []

    detail = (await client.get(f"{BASE}/queries/{qid}")).json()
    assert {x["provider"] for x in detail["results"]} == {"perplexity", "claude"}
    listing = (await client.get(f"{BASE}/queries", params={"limit": 2})).json()
    assert len(listing["items"]) == 2 and listing["next_cursor"]
    assert (await client.get(f"{BASE}/queries", params={"cursor": "%%bad"})).status_code == 400


async def test_system_prompt_roundtrip(ctx):
    client, *_ = ctx
    assert (await client.get(f"{BASE}/config/system-prompt")).json()["content"] == ""
    put = await client.put(f"{BASE}/config/system-prompt", json={"content": "SYS"})
    assert put.json()["content"] == "SYS"
    assert (await client.get(f"{BASE}/config/system-prompt")).json()["content"] == "SYS"


async def test_ask_waits_for_worker(ctx):
    client, container, _ = ctx
    stop, task = start_worker(container)
    r = await client.post(f"{BASE}/ask", json={"question": "hi", "providers": ["perplexity", "claude"]})
    stop.set()
    await task
    body = r.json()
    assert r.status_code == 200 and "note" not in body
    assert {x["provider"]: x["status"] for x in body["results"]} == {"perplexity": "done", "claude": "done"}
    assert body["results"][0]["citations"] == ["http://src"]


async def test_ask_timeout_returns_processing_note(ctx):
    client, *_ = ctx  # 워커 없음 → pending 그대로
    r = await client.post(f"{BASE}/ask", params={"timeout_seconds": 0.3}, json={"question": "hi"})
    body = r.json()
    assert r.status_code == 200 and body["results"][0]["status"] == "pending" and "note" in body
    assert (await client.post(f"{BASE}/ask", params={"timeout_seconds": 0}, json={"question": "hi"})).status_code == 400


async def test_retry_endpoint(ctx):
    client, container, _ = ctx
    qid = (await client.post(f"{BASE}/queries", json={"query": "q"})).json()["query_id"]
    rid = (await client.get(f"{BASE}/queries/{qid}")).json()["results"][0]["result_id"]
    assert (await client.post(f"{BASE}/queries/{qid}/results/{rid}/retry")).status_code == 409  # pending
    await container.repo.mark_failed(rid, "x")
    r = await client.post(f"{BASE}/queries/{qid}/results/{rid}/retry")
    assert r.status_code == 200 and r.json()["status"] == "pending"
    assert (await client.post(f"{BASE}/queries/{qid}/results/r_nope/retry")).status_code == 404


async def test_stream_events_snapshot_update_added(ctx):
    client, container, _ = ctx
    qid = (await client.post(f"{BASE}/queries", json={"query": "q"})).json()["query_id"]
    events: list[tuple[str, dict]] = []

    async def consume():
        async for ev in stream_events(container.repo, qid, interval=0.02, idle_timeout=2):
            events.append(ev)

    task = asyncio.create_task(consume())
    await asyncio.sleep(0.1)
    rid = (await container.repo.get_results(qid))[0].id
    await container.repo.set_progress(rid, "답변 대기 중")
    await client.post(f"{BASE}/queries/{qid}/providers", json={"providers": ["claude"]})
    await asyncio.sleep(0.2)
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)

    kinds = [(e, d["provider"], d["status"]) for e, d in events]
    assert kinds[0] == ("result_update", "perplexity", "pending")  # 초기 스냅샷
    assert ("result_update", "perplexity", "pending") in kinds[1:]  # progress 변경
    assert ("result_added", "claude", "pending") in kinds


async def test_web_pages_and_static(ctx):
    client, *_ = ctx
    idx = await client.get("/")
    assert idx.status_code == 200 and 'data-base=""' in idx.text and "시스템 프롬프트" in idx.text
    det = await client.get("/queries/q_abc123")
    assert det.status_code == 200 and 'data-query-id="q_abc123"' in det.text
    for path in ("app.css", "app.js", "index.js", "detail.js", "vendor/lucide.min.js", "vendor/marked.min.js", "vendor/purify.min.js"):
        assert (await client.get(f"/static/{path}")).status_code == 200, path


async def test_web_base_path_prefix(tmp_path):
    settings = Settings(base_path="/query", db_path=str(tmp_path / "q.db"), _env_file=None)
    container = build_container(settings, registry={})
    client = httpx.AsyncClient(transport=httpx.ASGITransport(app=create_app(container)), base_url="http://t")
    page = await client.get("/")
    await client.aclose()
    assert 'data-base="/query"' in page.text and 'href="/query/static/app.css"' in page.text
