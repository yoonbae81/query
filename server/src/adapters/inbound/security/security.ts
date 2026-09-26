import { timingSafeEqual } from "node:crypto";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { Settings } from "../../../config";

/** 상수 시간 비교 (ASVS V11.2.x 타이밍 공격 방지). 길이가 달라도 비교 시간이 새지 않도록 해시 길이를 맞춘다. */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  const len = Math.max(ba.length, bb.length, 1);
  const pa = Buffer.alloc(len);
  const pb = Buffer.alloc(len);
  ba.copy(pa);
  bb.copy(pb);
  return timingSafeEqual(pa, pb) && ba.length === bb.length;
}

function bearer(headers: Record<string, unknown>): string {
  const h = headers.authorization;
  return typeof h === "string" ? h.replace(/^Bearer\s+/i, "") : "";
}

/** 확장 WebSocket 토큰 검사. 브라우저 WebSocket은 헤더를 못 붙이므로 query token도 허용한다. */
export function isAuthorized(authToken: string, headers: Record<string, unknown>, query: Record<string, unknown>): boolean {
  if (!authToken) return true;
  const q = typeof query.token === "string" ? query.token : "";
  return safeEqual(bearer(headers), authToken) || safeEqual(q, authToken);
}

/**
 * Origin 허용 여부 (ASVS V3.4.2, V3.5.2, V4.4.2).
 * Origin이 없으면(비브라우저 클라이언트) 허용, 확장(chrome/moz-extension)은 허용,
 * 그 외에는 ALLOWED_ORIGINS 또는 요청 Host와 동일 출처만 허용한다.
 */
export function isOriginAllowed(origin: unknown, host: unknown, allowed: string[]): boolean {
  if (origin === undefined) return true;
  if (typeof origin !== "string" || origin === "null") return false;
  if (/^(chrome|moz)-extension:\/\//.test(origin)) return true;
  if (allowed.includes(origin.replace(/\/+$/, ""))) return true;
  try {
    return typeof host === "string" && new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** 고정 윈도 카운터. 메모리 누수를 막기 위해 만료 항목을 주기적으로 비운다. */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** 요청 1건을 기록하고 한도 초과 여부를 반환한다 (true = 차단). */
  hit(key: string, now = Date.now()): boolean {
    if (this.hits.size > 10_000) for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
    const cur = this.hits.get(key);
    if (!cur || cur.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return false;
    }
    cur.count += 1;
    return cur.count > this.limit;
  }

  blocked(key: string, now = Date.now()): boolean {
    const cur = this.hits.get(key);
    return !!cur && cur.resetAt > now && cur.count > this.limit;
  }
}

const ID_PARAM = /^[A-Za-z0-9_-]{1,64}$/;

const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join("; ");

const errorBody = (code: string, message: string) => ({ error: { code, message } });

/** URL에서 query 값(토큰 등)을 제거한 로그용 경로 (ASVS V14.2.1, V16.2.5) */
export const redactUrl = (url: string | undefined): string => (url ?? "").split("?")[0]!;

/**
 * 공통 보안 훅 (OWASP ASVS 5.0.0).
 * - V3.4.x/V4.1.1/V14.3.2: 보안 헤더, no-store
 * - V3.5.x: 브라우저 Origin 검증(CSRF), 상태 변경 메서드의 JSON Content-Type 강제
 * - V8.2.1/V6.3.1: API_TOKEN 인증 + 실패 횟수 제한
 * - V6.1.1/V2.4.1: IP별 rate limit
 * - V2.2.x: 경로 식별자 형식 검증
 */
export function registerSecurity(app: FastifyInstance, s: Settings): void {
  const limiter = s.rateLimitPerMinute > 0 ? new RateLimiter(s.rateLimitPerMinute, 60_000) : undefined;
  const authFailures = new RateLimiter(10, 5 * 60_000);

  app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Content-Security-Policy", CSP);
    reply.header("Cross-Origin-Opener-Policy", "same-origin");
    reply.header("Cross-Origin-Resource-Policy", "same-origin");
    reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

    const path = redactUrl(req.raw.url);
    const isApi = path.startsWith("/api/") || path.startsWith("/mcp");
    if (isApi) reply.header("Cache-Control", "no-store");

    if (limiter?.hit(req.ip)) {
      reply.header("Retry-After", "60");
      return reply.code(429).send(errorBody("RATE_LIMITED", "요청이 너무 많습니다."));
    }

    if (!isOriginAllowed(req.headers.origin, req.headers.host, s.allowedOrigins)) {
      return reply.code(403).send(errorBody("FORBIDDEN", "허용되지 않은 Origin입니다."));
    }

    if (!isApi) return;

    if (s.apiToken) {
      if (authFailures.blocked(req.ip)) {
        reply.header("Retry-After", "300");
        return reply.code(429).send(errorBody("RATE_LIMITED", "인증 시도가 너무 많습니다."));
      }
      if (!safeEqual(bearer(req.headers), s.apiToken)) {
        authFailures.hit(req.ip);
        req.log.warn({ ip: req.ip, path }, "api authentication failed");
        reply.header("WWW-Authenticate", "Bearer");
        return reply.code(401).send(errorBody("UNAUTHORIZED", "인증이 필요합니다."));
      }
    }

    const hasBody = Number(req.headers["content-length"] ?? 0) > 0 || req.headers["transfer-encoding"] !== undefined;
    if (hasBody && !/^application\/json\b/i.test(req.headers["content-type"] ?? "")) {
      return reply.code(415).send(errorBody("UNSUPPORTED_MEDIA_TYPE", "Content-Type은 application/json이어야 합니다."));
    }
  });

  app.addHook("preHandler", async (req, reply) => {
    const params = (req.params ?? {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(params)) {
      if (k === "*") continue; // 404 핸들러의 와일드카드
      if (typeof v !== "string" || !ID_PARAM.test(v)) {
        return reply.code(400).send(errorBody("INVALID_REQUEST", "잘못된 식별자 형식입니다."));
      }
    }
  });
}
