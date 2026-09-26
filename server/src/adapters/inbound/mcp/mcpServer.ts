import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Container } from "../../../container";
import { DomainError } from "../../../domain/errors";
import * as p from "../rest/presenters";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

const ok = (payload: unknown): ToolResult => ({
  content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
});

const fail = (e: unknown): ToolResult => {
  if (e instanceof DomainError) return { content: [{ type: "text", text: `${e.code}: ${e.message}` }], isError: true };
  throw e;
};

/**
 * MCP 서버 (PLAN §7). REST와 같은 유스케이스를 호출하는 또 하나의 드라이빙 어댑터다.
 * 전송(SSE / Streamable HTTP)마다 연결당 인스턴스를 새로 만든다.
 */
export function createMcpServer(c: Container): McpServer {
  const server = new McpServer({ name: "query", version: "0.1.0" });
  const tz = c.settings.displayTimezone;

  server.registerTool(
    "query_ask",
    {
      description:
        "질문을 보내고 답변이 나올 때까지 기다렸다가 반환한다. providers를 생략하면 Perplexity만 사용한다. " +
        "시간 내 끝나지 않은 provider는 status가 pending/processing으로 오며 query_status로 이어서 확인한다.",
      inputSchema: {
        question: z.string().describe("질문"),
        providers: z.array(z.string()).optional().describe("질의할 provider id 목록 (기본 perplexity)"),
        category: z.string().optional().describe("질문 카테고리. 해당 카테고리의 시스템 프롬프트가 적용된다 (기본 general)"),
        timeout_seconds: z.number().optional().describe("대기 시간(초). 기본 60, 최대 300"),
      },
    },
    async ({ question, providers, category, timeout_seconds }): Promise<ToolResult> => {
      try {
        return ok(p.askPayload(await c.ask.execute({ question, providers, category, timeoutSeconds: timeout_seconds })));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "query_status",
    {
      description: "이전에 등록한 질의의 현재 상태와 provider별 답변을 조회한다(대기하지 않음).",
      inputSchema: { query_id: z.string().describe("query_ask 등이 반환한 query_id") },
    },
    async ({ query_id }): Promise<ToolResult> => {
      try {
        const { query, results } = await c.getQuery.execute(query_id);
        return ok(p.queryDetail(query, results, tz));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "query_providers",
    { description: "사용 가능한 provider 목록과 현재 처리 가능 여부(online)를 조회한다." },
    async (): Promise<ToolResult> => ok(p.providersPayload(c)),
  );

  return server;
}
