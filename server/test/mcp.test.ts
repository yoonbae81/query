import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";

import { FakeExtension, makeServer, type TestServer, until } from "./appHelpers";

let srv: TestServer;
let client: Client | undefined;
let ext: FakeExtension | undefined;

afterEach(async () => {
  await client?.close();
  ext?.close();
  client = ext = undefined;
  await srv?.close();
});

type Kind = "sse" | "http";

async function connect(kind: Kind, env: Record<string, string> = {}): Promise<Client> {
  srv = await makeServer(env);
  await srv.listen();
  const base = srv.wsUrl.replace("ws:", "http:");
  client = new Client({ name: "test", version: "0.0.1" });
  const transport =
    kind === "sse"
      ? new SSEClientTransport(new URL(`${base}/mcp/sse`))
      : new StreamableHTTPClientTransport(new URL(`${base}/mcp`));
  await client.connect(transport);
  return client;
}

const text = (r: unknown) => ((r as { content: { text: string }[] }).content[0]!.text);

describe.each<Kind>(["sse", "http"])("MCP (%s)", (kind) => {
  it("세 개의 툴을 노출한다", async () => {
    const c = await connect(kind);
    const tools = (await c.listTools()).tools.map((t) => t.name).sort();
    expect(tools).toEqual(["query_ask", "query_providers", "query_status"]);
  });

  it("query_providers는 지원 여부와 online 상태를 돌려준다", async () => {
    const c = await connect(kind);
    const first = JSON.parse(text(await c.callTool({ name: "query_providers", arguments: {} })));
    expect(first.providers[0]).toEqual({ id: "perplexity", name: "Perplexity", available: true, online: false });
    srv.container.presence.connect("c", [["perplexity", "ready"]]);
    const second = JSON.parse(text(await c.callTool({ name: "query_providers", arguments: {} })));
    expect(second.providers[0].online).toBe(true);
  });

  it("query_ask는 확장이 없으면 즉시 pending과 note를 돌려주고 query_status로 이어서 조회한다", async () => {
    const c = await connect(kind);
    const ask = JSON.parse(text(await c.callTool({ name: "query_ask", arguments: { question: "hi", timeout_seconds: 30 } })));
    expect(ask.results[0]).toMatchObject({ provider: "perplexity", status: "pending" });
    expect(ask.note).toContain("perplexity");

    const status = JSON.parse(text(await c.callTool({ name: "query_status", arguments: { query_id: ask.query_id } })));
    expect(status).toMatchObject({ query_id: ask.query_id, query: "hi" });
    expect(status.results[0].status).toBe("pending");
  });

  it("query_ask는 확장이 처리해 줄 때까지 기다린다", async () => {
    const c = await connect(kind);
    ext = await FakeExtension.connect(srv.wsUrl + "/ext/ws");
    ext.hello();
    await until(() => srv.container.presence.isProviderOnline("perplexity"));
    const e = ext;
    const worker = (async () => {
      await e.next("wake");
      e.send({ type: "claim", provider: "perplexity" });
      const job = await e.next("job");
      e.send({ type: "result", result_id: job.result_id, answer: "MCP 답변", citations: ["http://s"] });
    })();
    const ask = JSON.parse(text(await c.callTool({ name: "query_ask", arguments: { question: "Q", timeout_seconds: 10 } })));
    await worker;
    expect(ask.note).toBeUndefined();
    expect(ask.results[0]).toMatchObject({ status: "done", answer: "MCP 답변", citations: ["http://s"] });
  });

  it("query_ask의 category는 생략하면 general, 지정하면 그 카테고리로 등록된다", async () => {
    const c = await connect(kind);
    const plain = JSON.parse(text(await c.callTool({ name: "query_ask", arguments: { question: "no category", timeout_seconds: 1 } })));
    const legal = JSON.parse(text(await c.callTool({ name: "query_ask", arguments: { question: "with category", category: "Legal", timeout_seconds: 1 } })));
    const status = async (id: string) => JSON.parse(text(await c.callTool({ name: "query_status", arguments: { query_id: id } })));
    expect((await status(plain.query_id)).category).toBe("general");
    expect((await status(legal.query_id)).category).toBe("legal"); // 소문자로 통일
    const bad = await c.callTool({ name: "query_ask", arguments: { question: "x", category: "../evil" } });
    expect(bad.isError).toBe(true);
    expect(text(bad)).toContain("INVALID_REQUEST");
  });

  it("도메인 오류는 isError 결과로 돌려준다", async () => {
    const c = await connect(kind);
    const empty = await c.callTool({ name: "query_ask", arguments: { question: "   " } });
    expect(empty.isError).toBe(true);
    expect(text(empty)).toContain("INVALID_REQUEST");
    const missing = await c.callTool({ name: "query_status", arguments: { query_id: "q_none" } });
    expect(missing.isError).toBe(true);
    expect(text(missing)).toContain("NOT_FOUND");
  });
});

describe("MCP 전송 세부", () => {
  it("SSE는 basePath가 붙은 메시지 전송 URL을 알려준다", async () => {
    srv = await makeServer({ BASE_PATH: "/query" });
    await srv.listen();
    const ac = new AbortController();
    const res = await fetch(srv.wsUrl.replace("ws:", "http:") + "/mcp/sse", { signal: ac.signal });
    const chunk = new TextDecoder().decode((await res.body!.getReader().read()).value);
    ac.abort();
    expect(chunk).toContain("event: endpoint");
    expect(chunk).toContain("/query/mcp/messages?sessionId=");
  });

  it("알 수 없는 세션과 stateless HTTP의 GET은 거절한다", async () => {
    srv = await makeServer();
    const bad = await srv.app.inject({ method: "POST", url: "/mcp/messages?sessionId=nope", payload: {} });
    expect(bad.statusCode).toBe(400);
    expect((await srv.app.inject({ method: "GET", url: "/mcp" })).statusCode).toBe(405);
  });
});
