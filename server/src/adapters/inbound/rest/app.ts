import websocket from "@fastify/websocket";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";

import type { Container } from "../../../container";
import { Conflict, DomainError, InvalidRequest, NotFound } from "../../../domain/errors";
import type { SocketLike } from "../extension/extensionHub";
import { registerMcpRoutes } from "../mcp/mcpRoutes";
import { registerWebRoutes } from "../web/webRoutes";
import { registerRestRoutes } from "./routes";

const STATUS = new Map<Function, number>([
  [InvalidRequest, 400],
  [NotFound, 404],
  [Conflict, 409],
]);

const errorBody = (code: string, message: string) => ({ error: { code, message } });

/**
 * 인증 훅 (PLAN2 §4.1). 지금은 확장 WebSocket만 AUTH_TOKEN이 설정된 경우에 검사하고,
 * 나머지는 무인증이다. 향후 웹 UI/REST 토큰 도입 시 이 함수만 확장한다.
 */
export function isAuthorized(authToken: string, headers: Record<string, unknown>, query: Record<string, unknown>): boolean {
  if (!authToken) return true;
  const bearer = typeof headers.authorization === "string" ? headers.authorization.replace(/^Bearer\s+/i, "") : "";
  return bearer === authToken || query.token === authToken;
}

export async function buildApp(c: Container, opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false });

  app.setErrorHandler((err: FastifyError | Error, _req, reply) => {
    if (err instanceof DomainError) {
      return reply.code(STATUS.get(err.constructor) ?? 400).send(errorBody(err.code, err.message));
    }
    const status = (err as FastifyError).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.code(status).send(errorBody("INVALID_REQUEST", err.message));
    }
    app.log.error(err);
    return reply.code(500).send(errorBody("INTERNAL_ERROR", "서버 내부 오류"));
  });

  app.setNotFoundHandler((_req, reply) => reply.code(404).send(errorBody("NOT_FOUND", "존재하지 않는 경로입니다.")));

  await app.register(websocket);
  app.get("/ext/ws", { websocket: true }, (socket, req) => {
    if (!isAuthorized(c.settings.authToken, req.headers, req.query as Record<string, unknown>)) {
      socket.close(4401, "unauthorized");
      return;
    }
    c.hub.handleConnection(socket as unknown as SocketLike);
  });

  await app.register(async (api) => registerRestRoutes(api, c), { prefix: "/api/v1" });
  registerMcpRoutes(app, c);
  await registerWebRoutes(app, c.settings.webDistDir, c.settings.basePath);
  return app;
}
