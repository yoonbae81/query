import websocket from "@fastify/websocket";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";

import type { Container } from "../../../container";
import { Conflict, DomainError, InvalidRequest, NotFound } from "../../../domain/errors";
import type { SocketLike } from "../extension/extensionHub";
import { registerMcpRoutes } from "../mcp/mcpRoutes";
import { registerWebRoutes } from "../web/webRoutes";
import { isAuthorized, isOriginAllowed, redactUrl, registerSecurity } from "../security/security";
import { registerRestRoutes } from "./routes";

const STATUS = new Map<Function, number>([
  [InvalidRequest, 400],
  [NotFound, 404],
  [Conflict, 409],
]);

const errorBody = (code: string, message: string) => ({ error: { code, message } });

export async function buildApp(c: Container, opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    // 로그에 query string(토큰)이 남지 않게 한다 (ASVS V14.2.1, V16.2.5)
    logger: opts.logger
      ? { serializers: { req: (r) => ({ method: r.method, url: redactUrl(r.url), host: r.host, remoteAddress: r.ip }) } }
      : false,
    bodyLimit: c.settings.maxBodyBytes,
    trustProxy: c.settings.trustProxy,
  });
  app.removeContentTypeParser("text/plain"); // JSON 외 본문 거부 (415)
  registerSecurity(app, c.settings);

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

  await app.register(websocket, { options: { maxPayload: 2 * 1024 * 1024 } });
  app.get("/ext/ws", { websocket: true }, (socket, req) => {
    if (!isOriginAllowed(req.headers.origin, req.headers.host, c.settings.allowedOrigins)) {
      socket.close(4403, "forbidden origin");
      return;
    }
    if (!isAuthorized(c.settings.authToken, req.headers, req.query as Record<string, unknown>)) {
      req.log.warn({ ip: req.ip }, "extension websocket authentication failed");
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
