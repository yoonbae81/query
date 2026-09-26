import { afterEach, describe, expect, it } from "vitest";

import { FakeExtension, makeServer, type TestServer, until } from "./appHelpers";

let srv: TestServer;
let exts: FakeExtension[] = [];

afterEach(async () => {
  exts.forEach((e) => e.close());
  exts = [];
  await srv?.close();
});

async function connect(env: Record<string, string> = {}, url = "/ext/ws"): Promise<FakeExtension> {
  srv = await makeServer(env);
  await srv.listen();
  const ext = await FakeExtension.connect(srv.wsUrl + url);
  exts.push(ext);
  return ext;
}

const online = () => srv.container.presence.isProviderOnline("perplexity");

describe("확장 WebSocket 프로토콜", () => {
  it("hello로 접속 상태가 등록되고 연결이 끊기면 offline이 된다", async () => {
    const ext = await connect();
    expect(online()).toBe(false);
    ext.hello();
    await until(online);
    expect((await srv.app.inject("/api/v1/extension/status")).json()).toMatchObject({ connected: true, clients: 1 });
    expect((await srv.app.inject("/api/v1/providers")).json().providers[0].online).toBe(true);

    ext.close();
    await until(() => !online());
  });

  it("state 메시지로 provider 상태가 바뀌고, 미지원 provider는 무시된다", async () => {
    const ext = await connect();
    ext.hello([{ id: "perplexity", state: "no_tab" }, { id: "unknown-site", state: "ready" }]);
    await new Promise((r) => setTimeout(r, 50));
    expect(online()).toBe(false);
    expect(srv.container.presence.isProviderOnline("unknown-site")).toBe(false);
    ext.send({ type: "state", providers: [{ id: "perplexity", state: "ready" }] });
    await until(online);
  });

  it("claim → job → progress → result로 done이 되고 다음 claim은 idle이다", async () => {
    const ext = await connect();
    await srv.container.prompts.put("general", "SYS");
    const s = await srv.container.submit.submit("hello");
    ext.hello();
    await until(online);

    ext.send({ type: "claim", provider: "perplexity" });
    const job = await ext.next("job");
    expect(job).toMatchObject({
      result_id: s.results[0]!.id,
      provider: "perplexity",
      prompt: "hello\n\n---\n\nSYS",
      lease_seconds: 120,
    });

    // 순차 처리: 처리 중에는 같은 provider claim이 거절된다
    await srv.container.submit.submit("second");
    ext.send({ type: "claim", provider: "perplexity" });
    expect((await ext.next("idle")).provider).toBe("perplexity");

    ext.send({ type: "progress", result_id: job.result_id, message: "답변 대기 중" });
    await until(async () => (await srv.container.repo.getResult(s.results[0]!.id))?.progressMessage === "답변 대기 중");

    ext.send({ type: "result", result_id: job.result_id, answer: "ANS", citations: ["http://a"] });
    await until(async () => (await srv.container.repo.getResult(s.results[0]!.id))?.status === "done");
    const r = (await srv.container.repo.getResult(s.results[0]!.id))!;
    expect(r).toMatchObject({ answer: "ANS", citations: ["http://a"], systemPromptSnapshot: "SYS" });

    // 완료 후에는 다음 작업을 가져갈 수 있고, 그 작업이 끝나기 전에는 다시 idle이다
    ext.send({ type: "claim", provider: "perplexity" });
    expect((await ext.next("job")).prompt).toBe("second\n\n---\n\nSYS");
    ext.send({ type: "claim", provider: "perplexity" });
    await ext.next("idle");
  });

  it("ready가 아닌 provider의 claim은 idle이고, pending이 없어도 idle이다", async () => {
    const ext = await connect();
    await srv.container.submit.submit("q");
    ext.hello([{ id: "perplexity", state: "login_required" }]);
    await new Promise((r) => setTimeout(r, 30));
    ext.send({ type: "claim", provider: "perplexity" });
    await ext.next("idle");
    expect((await srv.container.repo.countClaimable(new Date()))).toBe(1);

    ext.send({ type: "state", providers: [{ id: "perplexity", state: "ready" }] });
    ext.send({ type: "claim", provider: "perplexity" });
    await ext.next("job");
    ext.send({ type: "claim", provider: "nope" });
    await ext.next("idle");
  });

  it("새 질의가 등록되면 접속한 확장에 wake를 보낸다", async () => {
    const ext = await connect();
    ext.hello();
    await until(online);
    await srv.app.inject({ method: "POST", url: "/api/v1/queries", payload: { query: "q" } });
    await ext.next("wake");
  });

  it("error(login_required)는 재시도 횟수를 늘리지 않고 provider를 login_required로 표시한다", async () => {
    const ext = await connect();
    const s = await srv.container.submit.submit("q");
    ext.hello();
    await until(online);
    ext.send({ type: "claim", provider: "perplexity" });
    const job = await ext.next("job");
    ext.send({ type: "error", result_id: job.result_id, code: "login_required", message: "로그인 필요" });
    await until(() => !online());
    expect(await srv.container.repo.getResult(s.results[0]!.id)).toMatchObject({ status: "pending", retryCount: 0 });
  });

  it("error(timeout)는 재시도 정책을 따른다", async () => {
    const ext = await connect({ MAX_RETRY: "0" });
    const s = await srv.container.submit.submit("q");
    ext.hello();
    await until(online);
    ext.send({ type: "claim", provider: "perplexity" });
    const job = await ext.next("job");
    ext.send({ type: "error", result_id: job.result_id, code: "timeout", message: "답변 미완료" });
    await until(async () => (await srv.container.repo.getResult(s.results[0]!.id))?.status === "failed");
    expect((await srv.container.repo.getResult(s.results[0]!.id))?.errorMessage).toBe("timeout: 답변 미완료");
  });

  it("잘못된 메시지와 hello 이전 메시지는 protocol_error로 거절한다", async () => {
    const ext = await connect();
    ext.ws.send("not json");
    expect((await ext.next("protocol_error")).message).toContain("JSON");
    ext.send({ type: "claim", provider: "perplexity" });
    expect((await ext.next("protocol_error")).message).toContain("hello");
    ext.send({ type: "bogus" });
    await ext.next("protocol_error");
    ext.hello();
    await until(online);
    ext.send({ type: "progress", result_id: "r_none", message: "x" });
    expect((await ext.next("protocol_error")).message).toContain("임대");
  });

  it("다른 클라이언트의 작업에 대한 result는 무시된다", async () => {
    const a = await connect();
    const s = await srv.container.submit.submit("q");
    a.hello([{ id: "perplexity", state: "ready" }], "ext-a");
    await until(online);
    a.send({ type: "claim", provider: "perplexity" });
    const job = await a.next("job");

    const b = await FakeExtension.connect(srv.wsUrl + "/ext/ws");
    exts.push(b);
    b.hello([{ id: "perplexity", state: "ready" }], "ext-b");
    await new Promise((r) => setTimeout(r, 30));
    b.send({ type: "result", result_id: job.result_id, answer: "hijack", citations: [] });
    await b.next("protocol_error");
    expect((await srv.container.repo.getResult(s.results[0]!.id))?.status).toBe("processing");
  });

  it("여러 클라이언트가 있으면 한 곳만 claim하고 이후 작업은 round-robin으로 분배된다", async () => {
    const a = await connect();
    const ready = [{ id: "perplexity", state: "ready" as const }];
    a.hello(ready, "ext-a");
    const b = await FakeExtension.connect(srv.wsUrl + "/ext/ws");
    const c = await FakeExtension.connect(srv.wsUrl + "/ext/ws");
    exts.push(b, c);
    b.hello(ready, "ext-b");
    c.hello(ready, "ext-c");
    await until(() => srv.container.presence.snapshot(["perplexity"]).clients === 3);

    await srv.container.submit.submit("q1");
    await srv.container.submit.submit("q2");
    await srv.container.submit.submit("q3");

    // 차례가 아닌 b가 먼저 claim해도 idle이고, 차례인 a가 wake를 받아 가져간다
    b.send({ type: "claim", provider: "perplexity" });
    await b.next("idle");
    await a.next("wake");
    a.send({ type: "claim", provider: "perplexity" });
    await a.next("job");

    // 다음 차례는 b, 그 다음은 c
    a.send({ type: "claim", provider: "perplexity" }); // a는 처리 중
    await a.next("idle");
    c.send({ type: "claim", provider: "perplexity" });
    await c.next("idle");
    b.send({ type: "claim", provider: "perplexity" });
    await b.next("job");
    c.send({ type: "claim", provider: "perplexity" });
    await c.next("job");
  });

  it("연결이 끊기면 임대가 만료 처리되어 sweep이 재시도로 돌린다", async () => {
    const ext = await connect();
    const s = await srv.container.submit.submit("q");
    ext.hello();
    await until(online);
    ext.send({ type: "claim", provider: "perplexity" });
    await ext.next("job");
    ext.close();
    await until(() => !online());
    await until(async () => (await srv.container.repo.findExpiredLeases(new Date())).length === 1);
    expect(await srv.container.sweepLeases.execute()).toBe(1);
    expect(await srv.container.repo.getResult(s.results[0]!.id)).toMatchObject({ status: "pending", retryCount: 1 });
  });

  it("같은 client_id로 재접속하면 이전 연결의 임대는 즉시 만료 처리된다", async () => {
    const first = await connect();
    const s = await srv.container.submit.submit("q");
    first.hello();
    await until(online);
    first.send({ type: "claim", provider: "perplexity" });
    await first.next("job");

    const second = await FakeExtension.connect(srv.wsUrl + "/ext/ws");
    exts.push(second);
    second.hello();
    await until(async () => (await srv.container.repo.findExpiredLeases(new Date())).length === 1);
    expect(await first.waitClosed()).toBeGreaterThan(0);
    expect(srv.container.hub.connectionCount).toBe(1);
    expect((await srv.container.repo.getResult(s.results[0]!.id))?.status).toBe("processing");
  });

  it("/ask는 확장이 처리해 줄 때까지 기다렸다가 결과를 돌려준다", async () => {
    const ext = await connect();
    ext.hello();
    await until(online);
    const worker = (async () => {
      await ext.next("wake");
      ext.send({ type: "claim", provider: "perplexity" });
      const job = await ext.next("job");
      ext.send({ type: "progress", result_id: job.result_id, message: "답변 추출 중" });
      ext.send({ type: "result", result_id: job.result_id, answer: `답: ${String(job.prompt)}`, citations: ["http://s"] });
    })();
    const res = await srv.app.inject({ method: "POST", url: "/api/v1/ask?timeout_seconds=10", payload: { question: "Q" } });
    await worker;
    expect(res.statusCode).toBe(200);
    expect(res.json().note).toBeUndefined();
    expect(res.json().results[0]).toMatchObject({ provider: "perplexity", status: "done", answer: "답: Q", citations: ["http://s"] });
  });

  it("API_TOKEN이 설정되면 토큰이 없거나 틀린 연결은 4401로 닫히고, 등록된 토큰이면 어느 것이든 허용된다", async () => {
    const denied = await connect({ API_TOKEN: "secret, other" });
    expect(await denied.waitClosed()).toBe(4401);

    const wrong = await FakeExtension.connect(srv.wsUrl + "/ext/ws?token=nope");
    exts.push(wrong);
    expect(await wrong.waitClosed()).toBe(4401);

    const allowed = await FakeExtension.connect(srv.wsUrl + "/ext/ws?token=other");
    exts.push(allowed);
    allowed.hello();
    await until(online);
    expect(allowed.closed).toBeNull();
  });
});
