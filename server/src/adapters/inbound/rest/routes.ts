import type { FastifyInstance } from "fastify";

import { PROVIDER_NAMES, type Container } from "../../../container";
import * as p from "./presenters";
import { addProvidersBody, askBody, bulkBody, numberParam, parseBody, submitBody, systemPromptBody } from "./schemas";
import { streamEvents } from "./sse";

/** 동시 SSE 스트림 상한 (ASVS V2.4.1) */
const MAX_STREAMS = 100;

type IdParams = { Params: { id: string } };

/** REST API (PLAN §4). basePath는 reverse proxy가 제거해서 전달하므로 라우트는 /api/v1부터다. */
export function registerRestRoutes(app: FastifyInstance, c: Container): void {
  const tz = c.settings.displayTimezone;
  const supported = c.settings.supportedProviders;

  app.get("/providers", async () => p.providersPayload(c));

  app.get("/extension/status", async () => {
    const snap = c.presence.snapshot(supported);
    return {
      connected: snap.clients > 0,
      clients: snap.clients,
      providers: snap.providers.map((pr) => ({
        id: pr.id,
        name: PROVIDER_NAMES[pr.id] ?? pr.id,
        online: pr.online,
        states: pr.states,
      })),
    };
  });

  app.post("/queries", async (req, reply) => {
    const body = parseBody(submitBody, req.body);
    const s = await c.submit.submit(body.query, body.providers, undefined, body.category);
    return reply.code(201).send({
      query_id: s.query.id,
      created_at: p.fmt(s.query.createdAt, tz),
      results: s.results.map(p.resultCreated),
    });
  });

  app.post("/queries/bulk", async (req, reply) => {
    const body = parseBody(bulkBody, req.body);
    const { batchId, items } = await c.submit.submitBulk(body.queries, body.providers, body.category);
    return reply.code(201).send({
      batch_id: batchId,
      items: items.map((i) => ({ query_id: i.query.id, results: i.results.map(p.resultCreated) })),
    });
  });

  app.post<IdParams>("/queries/:id/providers", async (req, reply) => {
    const body = parseBody(addProvidersBody, req.body);
    const added = await c.addProvider.execute(req.params.id, body.providers);
    return reply
      .code(added.length > 0 ? 201 : 200)
      .send({ query_id: req.params.id, results: added.map(p.resultCreated) });
  });

  app.post<{ Querystring: { timeout_seconds?: string } }>("/ask", async (req) => {
    const body = parseBody(askBody, req.body);
    const out = await c.ask.execute({
      question: body.question,
      providers: body.providers,
      category: body.category,
      timeoutSeconds: numberParam("timeout_seconds", req.query.timeout_seconds),
    });
    return p.askPayload(out);
  });

  // ---- 카테고리별 답변작성 지침 (user/prompts/<category>.md, PLAN3 §4)
  app.get("/categories", async () => ({
    categories: (await c.categories.execute()).map((v) => ({
      category: v.category,
      has_prompt: v.hasPrompt,
      prompt_size: v.promptSize,
      query_count: v.queryCount,
    })),
  }));

  const promptPayload = (v: { category: string; content: string; updatedAt: Date }) => ({
    category: v.category,
    content: v.content,
    updated_at: p.fmt(v.updatedAt, tz),
  });
  app.get<{ Params: { category: string } }>("/prompts/:category", async (req) =>
    promptPayload(await c.prompts.get(req.params.category)),
  );
  app.put<{ Params: { category: string } }>("/prompts/:category", async (req) => {
    const body = parseBody(systemPromptBody, req.body);
    return promptPayload(await c.prompts.put(req.params.category, body.content));
  });
  app.delete<{ Params: { category: string } }>("/prompts/:category", async (req, reply) => {
    await c.prompts.remove(req.params.category);
    return reply.code(204).send();
  });

  // 하위 호환: 예전 단일 답변작성 지침 API는 general 답변작성 지침를 가리킨다
  app.get("/config/system-prompt", async () => promptPayload(await c.prompts.get("general")));
  app.put("/config/system-prompt", async (req) => {
    const body = parseBody(systemPromptBody, req.body);
    return promptPayload(await c.prompts.put("general", body.content));
  });

  app.get("/stats", async () => {
    const st = await c.stats.execute();
    return { queries: st.queries, results: st.results };
  });

  app.get<{
    Querystring: { status?: string; batch_id?: string; category?: string; search?: string; limit?: string; cursor?: string };
  }>(
    "/queries",
    async (req) => {
      const q = req.query;
      const page = await c.listQueries.execute({
        status: q.status || undefined,
        batchId: q.batch_id || undefined,
        category: q.category || undefined,
        search: q.search || undefined,
        limit: numberParam("limit", q.limit),
        cursor: q.cursor || undefined,
      });
      return {
        items: page.items.map((i) => p.querySummary(i.query, i.results, tz)),
        next_cursor: page.nextCursor,
      };
    },
  );

  app.get<IdParams>("/queries/:id", async (req) => {
    const { query, results } = await c.getQuery.execute(req.params.id);
    return p.queryDetail(query, results, tz);
  });

  let activeStreams = 0;
  app.get<IdParams>("/queries/:id/stream", async (req, reply) => {
    await c.getQuery.execute(req.params.id); // 없으면 404 (스트림 시작 전)
    if (activeStreams >= MAX_STREAMS) {
      return reply.code(429).send({ error: { code: "RATE_LIMITED", message: "동시 스트림 한도를 초과했습니다." } });
    }
    activeStreams++;
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      ...(reply.getHeaders() as Record<string, string>), // hijack 시 onRequest에서 설정한 보안 헤더 유지
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const abort = new AbortController();
    req.raw.on("close", () => abort.abort());
    const keepalive = setInterval(() => res.write(": keepalive\n\n"), 15_000);
    try {
      for await (const ev of streamEvents(c.repo, req.params.id, { signal: abort.signal })) {
        res.write(`event: ${ev.event}\ndata: ${JSON.stringify(ev.data)}\n\n`);
      }
    } finally {
      activeStreams--;
      clearInterval(keepalive);
      res.end();
    }
  });

  // 질문 전체(모든 provider 결과)를 삭제한다. 처리 중인 결과가 있으면 409
  app.delete<IdParams>("/queries/:id", async (req, reply) => {
    await c.deleteResults.deleteQuery(req.params.id);
    return reply.code(204).send();
  });

  // provider 결과 하나를 삭제한다. 마지막 결과였다면 질문도 함께 삭제된다(query_deleted=true)
  app.delete<{ Params: { id: string; resultId: string } }>("/queries/:id/results/:resultId", async (req) => {
    const { queryDeleted } = await c.deleteResults.deleteResult(req.params.id, req.params.resultId);
    return { query_deleted: queryDeleted };
  });

  // 저장된 질문/답변 마크다운 파일 내려받기 (답변 열람/백업용)
  app.get<{ Params: { id: string; resultId: string } }>("/queries/:id/results/:resultId/download", async (req, reply) => {
    const { filename, content } = await c.answerFile.execute(req.params.id, req.params.resultId);
    return reply
      .header("Content-Type", "text/markdown; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="${filename}"`)
      .send(content);
  });

  app.post<{ Params: { id: string; resultId: string } }>("/queries/:id/results/:resultId/retry", async (req) => {
    const r = await c.retry.execute(req.params.id, req.params.resultId);
    return p.resultCreated(r);
  });
}
