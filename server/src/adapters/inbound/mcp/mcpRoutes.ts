import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { FastifyInstance } from "fastify";

import type { Container } from "../../../container";
import { createMcpServer } from "./mcpServer";

const jsonRpcError = (message: string) => ({ jsonrpc: "2.0", error: { code: -32000, message }, id: null });

/**
 * MCP 전송 (PLAN §7.2).
 * - SSE: GET /mcp/sse (서버→클라이언트), POST /mcp/messages (클라이언트→서버)
 * - Streamable HTTP(현재 표준): POST /mcp (stateless)
 * basePath는 reverse proxy가 제거해서 전달하므로 라우트는 /mcp부터다. 단 SSE가 클라이언트에 알려주는
 * 메시지 전송 URL에는 외부에서 보이는 경로이므로 basePath를 붙인다.
 */
export function registerMcpRoutes(app: FastifyInstance, c: Container): void {
  const sessions = new Map<string, SSEServerTransport>();

  app.get("/mcp/sse", async (req, reply) => {
    reply.hijack();
    const transport = new SSEServerTransport(`${c.settings.basePath}/mcp/messages`, reply.raw);
    sessions.set(transport.sessionId, transport);
    reply.raw.on("close", () => sessions.delete(transport.sessionId));
    await createMcpServer(c).connect(transport);
    req.log.debug({ sessionId: transport.sessionId }, "mcp sse connected");
  });

  app.post<{ Querystring: { sessionId?: string } }>("/mcp/messages", async (req, reply) => {
    const transport = req.query.sessionId ? sessions.get(req.query.sessionId) : undefined;
    if (!transport) return reply.code(400).send(jsonRpcError("유효하지 않은 sessionId입니다."));
    reply.hijack();
    await transport.handlePostMessage(req.raw, reply.raw, req.body);
  });

  app.post("/mcp", async (req, reply) => {
    reply.hijack();
    const server = createMcpServer(c);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    reply.raw.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req.raw, reply.raw, req.body);
  });

  // stateless 모드: 서버 주도 스트림/세션 종료는 지원하지 않는다
  const notAllowed = async (_req: unknown, reply: { code(n: number): { send(b: unknown): unknown } }) =>
    reply.code(405).send(jsonRpcError("Method not allowed."));
  app.get("/mcp", notAllowed);
  app.delete("/mcp", notAllowed);
}
