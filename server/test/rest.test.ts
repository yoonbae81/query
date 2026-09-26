import { afterEach, describe, expect, it } from "vitest";

import { streamEvents } from "../src/adapters/inbound/rest/sse";
import { makeServer, type TestServer, until } from "./appHelpers";

let srv: TestServer;
afterEach(async () => {
  await srv?.close();
});

const json = (payload: unknown) => ({ payload: payload as object });

describe("REST API", () => {
  it("providers와 공통 에러 포맷", async () => {
    srv = await makeServer();
    const body = (await srv.app.inject("/api/v1/providers")).json();
    expect(body.providers).toEqual([
      { id: "perplexity", name: "Perplexity", available: true, online: false },
      { id: "claude", name: "Claude", available: true, online: false },
      { id: "gemini", name: "Gemini", available: true, online: false },
      { id: "chatgpt", name: "ChatGPT", available: true, online: false },
    ]);

    const bad = await srv.app.inject({ method: "POST", url: "/api/v1/queries", ...json({ query: "  " }) });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe("INVALID_REQUEST");
    const unknownProvider = await srv.app.inject({ method: "POST", url: "/api/v1/queries", ...json({ query: "q", providers: ["grok"] }) });
    expect(unknownProvider.statusCode).toBe(400);
    const schema = await srv.app.inject({ method: "POST", url: "/api/v1/queries", ...json({}) });
    expect(schema.statusCode).toBe(400);
    expect(schema.json().error.code).toBe("INVALID_REQUEST");
    const broken = await srv.app.inject({ method: "POST", url: "/api/v1/queries", headers: { "content-type": "application/json" }, payload: "{oops" });
    expect(broken.statusCode).toBe(400);
    expect((await srv.app.inject("/api/v1/queries/q_nope")).statusCode).toBe(404);
    expect((await srv.app.inject("/api/v1/queries/q_nope/stream")).statusCode).toBe(404);
    expect((await srv.app.inject("/api/v1/queries?limit=500")).statusCode).toBe(400);
    expect((await srv.app.inject("/api/v1/queries?limit=abc")).statusCode).toBe(400);
    expect((await srv.app.inject("/api/v1/nothing")).json().error.code).toBe("NOT_FOUND");
  });

  it("등록/벌크/조회/provider 추가", async () => {
    srv = await makeServer();
    const created = await srv.app.inject({ method: "POST", url: "/api/v1/queries", ...json({ query: "hello" }) });
    expect(created.statusCode).toBe(201);
    const body = created.json();
    expect(body.created_at).toMatch(/\+09:00$/);
    expect(body.results[0]).toMatchObject({ provider: "perplexity", status: "pending" });
    const qid = body.query_id as string;

    const bulk = await srv.app.inject({ method: "POST", url: "/api/v1/queries/bulk", ...json({ queries: ["a", "", "b"] }) });
    expect(bulk.statusCode).toBe(201);
    expect(bulk.json().items).toHaveLength(2);

    const detail = (await srv.app.inject(`/api/v1/queries/${qid}`)).json();
    expect(detail).toMatchObject({ query_id: qid, query: "hello", batch_id: null });
    expect(detail.results[0]).toMatchObject({ status: "pending", retry_count: 0, answer: null });

    const list = (await srv.app.inject("/api/v1/queries?limit=2")).json();
    expect(list.items).toHaveLength(2);
    expect(list.next_cursor).toBeTruthy();
    const next = (await srv.app.inject(`/api/v1/queries?limit=2&cursor=${list.next_cursor}`)).json();
    expect(next.items).toHaveLength(1);
    expect(next.next_cursor).toBeNull();
    expect((await srv.app.inject("/api/v1/queries?cursor=%25%25bad")).statusCode).toBe(400);
  });

  it("provider 추가 API는 지원하지 않는 provider를 400으로 거절한다", async () => {
    srv = await makeServer();
    const qid = (await srv.app.inject({ method: "POST", url: "/api/v1/queries", ...json({ query: "q" }) })).json().query_id as string;
    const dup = await srv.app.inject({ method: "POST", url: `/api/v1/queries/${qid}/providers`, ...json({ providers: ["perplexity"] }) });
    expect(dup.statusCode).toBe(200);
    expect(dup.json().results).toEqual([]);
    const bad = await srv.app.inject({ method: "POST", url: `/api/v1/queries/${qid}/providers`, ...json({ providers: ["grok"] }) });
    expect(bad.statusCode).toBe(400);
    const missing = await srv.app.inject({ method: "POST", url: "/api/v1/queries/q_none/providers", ...json({ providers: ["perplexity"] }) });
    expect(missing.statusCode).toBe(404);
  });

  it("답변 작성 지침 조회/수정", async () => {
    srv = await makeServer();
    expect((await srv.app.inject("/api/v1/config/system-prompt")).json().content).toBe("");
    const put = await srv.app.inject({ method: "PUT", url: "/api/v1/config/system-prompt", ...json({ content: "SYS" }) });
    expect(put.json()).toMatchObject({ content: "SYS" });
    expect(put.json().updated_at).toMatch(/\+09:00$/);
    expect((await srv.app.inject("/api/v1/config/system-prompt")).json().content).toBe("SYS");
  });

  it("확장이 없으면 /ask는 즉시 pending과 note를 반환한다", async () => {
    srv = await makeServer();
    const started = Date.now();
    const r = await srv.app.inject({ method: "POST", url: "/api/v1/ask?timeout_seconds=30", ...json({ question: "hi" }) });
    expect(Date.now() - started).toBeLessThan(1500);
    expect(r.statusCode).toBe(200);
    expect(r.json().results[0]).toMatchObject({ provider: "perplexity", status: "pending", answer: null });
    expect(r.json().note).toContain("perplexity");
    expect((await srv.app.inject({ method: "POST", url: "/api/v1/ask?timeout_seconds=0", ...json({ question: "hi" }) })).statusCode).toBe(400);
  });

  it("retry API: pending은 409, 없는 result는 404, failed는 pending으로", async () => {
    srv = await makeServer({ MAX_RETRY: "0" });
    const created = (await srv.app.inject({ method: "POST", url: "/api/v1/queries", ...json({ query: "q" }) })).json();
    const qid = created.query_id as string;
    const rid = created.results[0].result_id as string;
    expect((await srv.app.inject({ method: "POST", url: `/api/v1/queries/${qid}/results/${rid}/retry` })).statusCode).toBe(409);
    await srv.container.repo.markFailed(rid, "x");
    const ok = await srv.app.inject({ method: "POST", url: `/api/v1/queries/${qid}/results/${rid}/retry` });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ result_id: rid, status: "pending" });
    expect((await srv.app.inject({ method: "POST", url: `/api/v1/queries/${qid}/results/r_nope/retry` })).statusCode).toBe(404);
  });

  it("/extension/status는 접속 상태를 보여준다", async () => {
    srv = await makeServer();
    expect((await srv.app.inject("/api/v1/extension/status")).json()).toMatchObject({ connected: false, clients: 0 });
    srv.container.presence.connect("c", [["perplexity", "login_required"]]);
    const s = (await srv.app.inject("/api/v1/extension/status")).json();
    expect(s.connected).toBe(true);
    expect(s.providers[0]).toMatchObject({ id: "perplexity", online: false, states: ["login_required"] });
  });
});

describe("SSE 브릿지", () => {
  it("스냅샷 → 진행 갱신 → 새 provider 추가를 이벤트로 내보낸다", async () => {
    srv = await makeServer();
    const { repo } = srv.container;
    const s = await srv.container.submit.submit("q");
    const events: { event: string; data: Record<string, unknown> }[] = [];
    const abort = new AbortController();
    const consumer = (async () => {
      for await (const ev of streamEvents(repo, s.query.id, { intervalMs: 20, signal: abort.signal })) events.push(ev);
    })();

    await until(() => events.length >= 1);
    await repo.setProgress(s.results[0]!.id, "답변 대기 중");
    await until(() => events.some((e) => e.data.progress_message === "답변 대기 중"));
    const { newQueryResult } = await import("../src/domain/entities");
    await repo.addResults(s.query.id, [newQueryResult(s.query.id, "claude", 0)]);
    await until(() => events.some((e) => e.event === "result_added"));
    abort.abort();
    await consumer;

    expect(events[0]).toMatchObject({ event: "result_update", data: { provider: "perplexity", status: "pending" } });
    expect(events.at(-1)).toMatchObject({ event: "result_added", data: { provider: "claude" } });
  });

  it("엔드포인트가 text/event-stream으로 스냅샷을 내려준다", async () => {
    srv = await makeServer();
    await srv.listen();
    const s = await srv.container.submit.submit("q");
    const ac = new AbortController();
    const res = await fetch(srv.wsUrl.replace("ws:", "http:") + `/api/v1/queries/${s.query.id}/stream`, { signal: ac.signal });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body!.getReader();
    const chunk = new TextDecoder().decode((await reader.read()).value);
    expect(chunk).toContain("event: result_update");
    expect(chunk).toContain('"provider":"perplexity"');
    ac.abort();
  });
});

describe("웹 UI 서빙", () => {
  it("빌드 결과가 없으면 안내 페이지를 준다", async () => {
    srv = await makeServer();
    const r = await srv.app.inject("/");
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toContain("text/html");
  });

  it("index.html에 basePath를 주입하고 정적 파일과 SPA 경로를 서빙한다", async () => {
    srv = await makeServer({ BASE_PATH: "/query/" }, { withDist: true });
    for (const url of ["/", "/queries/q_abc123"]) {
      const r = await srv.app.inject(url);
      expect(r.statusCode).toBe(200);
      expect(r.body).toContain('<base href="/query/">');
    }
    const asset = await srv.app.inject("/assets/app.js");
    expect(asset.statusCode).toBe(200);
    expect(asset.body).toContain("console.log");
  });

  it("basePath가 없으면 base는 /", async () => {
    srv = await makeServer({}, { withDist: true });
    expect((await srv.app.inject("/")).body).toContain('<base href="/">');
  });
});
