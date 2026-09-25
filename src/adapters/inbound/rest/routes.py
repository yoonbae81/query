import json

from fastapi import APIRouter, Depends, Query, Response
from sse_starlette.sse import EventSourceResponse

from src.adapters.inbound.rest import presenters as p
from src.adapters.inbound.rest.deps import get_container, get_current_user
from src.adapters.inbound.rest.schemas import (
    AddProvidersRequest,
    AskRequest,
    BulkSubmitRequest,
    SubmitRequest,
    SystemPromptRequest,
)
from src.adapters.inbound.rest.sse import stream_events
from src.bootstrap import ALL_PROVIDERS
from src.container import Container

router = APIRouter(dependencies=[Depends(get_current_user)])


@router.get("/providers")
async def list_providers(c: Container = Depends(get_container)):
    return {
        "providers": [
            {"id": pid, "name": name, "available": pid in c.registry} for pid, name in ALL_PROVIDERS.items()
        ]
    }


@router.post("/queries", status_code=201)
async def submit_query(body: SubmitRequest, c: Container = Depends(get_container)):
    s = await c.submit.submit(body.query, body.providers)
    return {
        "query_id": s.query.id,
        "created_at": p.fmt_time(s.query.created_at, c.settings.display_timezone),
        "results": [p.result_created(r) for r in s.results],
    }


@router.post("/queries/bulk", status_code=201)
async def submit_bulk(body: BulkSubmitRequest, c: Container = Depends(get_container)):
    batch_id, items = await c.submit.submit_bulk(body.queries, body.providers)
    return {
        "batch_id": batch_id,
        "items": [{"query_id": i.query.id, "results": [p.result_created(r) for r in i.results]} for i in items],
    }


@router.post("/queries/{query_id}/providers")
async def add_providers(
    query_id: str, body: AddProvidersRequest, response: Response, c: Container = Depends(get_container)
):
    added = await c.add_provider.execute(query_id, body.providers)
    response.status_code = 201 if added else 200
    return {"query_id": query_id, "results": [p.result_created(r) for r in added]}


@router.post("/ask")
async def ask(
    body: AskRequest, timeout_seconds: float | None = Query(None), c: Container = Depends(get_container)
):
    outcome = await c.ask.execute(body.question, body.providers, timeout_seconds)
    data = {"query_id": outcome.query_id, "results": [p.result_ask(r) for r in outcome.results]}
    if outcome.timed_out:
        data["note"] = (
            f"일부 provider가 시간 내 완료되지 않았습니다. GET /queries/{outcome.query_id} 으로 계속 조회하세요."
        )
    return data


@router.get("/config/system-prompt")
async def get_system_prompt(c: Container = Depends(get_container)):
    content, updated_at = await c.system_prompt.get()
    return {"content": content, "updated_at": p.fmt_time(updated_at, c.settings.display_timezone)}


@router.put("/config/system-prompt")
async def put_system_prompt(body: SystemPromptRequest, c: Container = Depends(get_container)):
    content, updated_at = await c.system_prompt.update(body.content)
    return {"content": content, "updated_at": p.fmt_time(updated_at, c.settings.display_timezone)}


@router.get("/queries")
async def list_queries(
    status: str | None = None,
    batch_id: str | None = None,
    limit: int = 20,
    cursor: str | None = None,
    c: Container = Depends(get_container),
):
    page = await c.list_queries.execute(status, batch_id, limit, cursor)
    tz = c.settings.display_timezone
    return {"items": [p.query_summary(q, rs, tz) for q, rs in page.items], "next_cursor": page.next_cursor}


@router.get("/queries/{query_id}")
async def get_query(query_id: str, c: Container = Depends(get_container)):
    q, results = await c.get_query.execute(query_id)
    return p.query_detail(q, results, c.settings.display_timezone)


@router.get("/queries/{query_id}/stream")
async def stream_query(query_id: str, c: Container = Depends(get_container)):
    await c.get_query.execute(query_id)  # 없으면 404 (스트림 시작 전)

    async def events():
        async for event, data in stream_events(c.repo, query_id):
            yield {"event": event, "data": json.dumps(data, ensure_ascii=False)}

    return EventSourceResponse(events())


@router.post("/queries/{query_id}/results/{result_id}/retry")
async def retry_result(query_id: str, result_id: str, c: Container = Depends(get_container)):
    r = await c.retry.execute(query_id, result_id)
    return p.result_created(r)
