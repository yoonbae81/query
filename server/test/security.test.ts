import { afterEach, describe, expect, it } from "vitest";

import { RateLimiter, isOriginAllowed, safeEqual } from "../src/adapters/inbound/security/security";
import { makeServer, type TestServer } from "./appHelpers";

let srv: TestServer;
afterEach(async () => srv?.close());

const post = (url: string, payload: unknown, headers: Record<string, string> = {}) =>
  srv.app.inject({ method: "POST", url, payload: payload as object, headers });

describe("ASVS 보안 강화", () => {
  it("보안 헤더와 no-store를 붙인다 (V3.4.x, V14.3.2)", async () => {
    srv = await makeServer();
    const res = await srv.app.inject({ method: "GET", url: "/api/v1/providers" });
    expect(res.headers["strict-transport-security"]).toContain("max-age=");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("교차 출처 요청은 403 (V3.5.x)", async () => {
    srv = await makeServer();
    const res = await post("/api/v1/queries", { query: "q" }, { origin: "https://evil.example", host: "localhost:8000" });
    expect(res.statusCode).toBe(403);
    const ok = await post("/api/v1/queries", { query: "q" }, { origin: "http://localhost:8000", host: "localhost:8000" });
    expect(ok.statusCode).toBe(201);
  });

  it("JSON이 아닌 본문은 415", async () => {
    srv = await makeServer();
    const res = await srv.app.inject({
      method: "POST",
      url: "/api/v1/queries",
      payload: "query=q",
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    expect(res.statusCode).toBe(415);
  });

  it("알 수 없는 필드와 잘못된 식별자는 400 (V2.2.1)", async () => {
    srv = await makeServer();
    expect((await post("/api/v1/queries", { query: "q", admin: true })).statusCode).toBe(400);
    expect((await srv.app.inject({ method: "GET", url: "/api/v1/queries/a%20b" })).statusCode).toBe(400);
  });

  it("본문 크기 제한 (V2.2.x)", async () => {
    srv = await makeServer({ MAX_BODY_BYTES: "100" });
    const res = await post("/api/v1/queries", { query: "x".repeat(500) });
    expect(res.statusCode).toBe(413);
  });

  it("API_TOKEN이 있으면 Bearer가 필요하다 (V8.2.1)", async () => {
    srv = await makeServer({ API_TOKEN: "s3cret" });
    expect((await srv.app.inject({ method: "GET", url: "/api/v1/providers" })).statusCode).toBe(401);
    const res = await srv.app.inject({ method: "GET", url: "/api/v1/providers", headers: { authorization: "Bearer s3cret" } });
    expect(res.statusCode).toBe(200);
  });

  it("API_TOKEN을 쉼표로 여러 개 등록하면 그중 어느 것이든 통과한다", async () => {
    srv = await makeServer({ API_TOKEN: "first, second" });
    for (const tok of ["first", "second"]) {
      const res = await srv.app.inject({ method: "GET", url: "/api/v1/providers", headers: { authorization: `Bearer ${tok}` } });
      expect(res.statusCode).toBe(200);
    }
    const bad = await srv.app.inject({ method: "GET", url: "/api/v1/providers", headers: { authorization: "Bearer third" } });
    expect(bad.statusCode).toBe(401);
  });

  it("인증 실패가 반복되면 429 (V6.3.1)", async () => {
    srv = await makeServer({ API_TOKEN: "s3cret" });
    for (let i = 0; i < 11; i++) await srv.app.inject({ method: "GET", url: "/api/v1/providers" });
    const res = await srv.app.inject({ method: "GET", url: "/api/v1/providers", headers: { authorization: "Bearer s3cret" } });
    expect(res.statusCode).toBe(429);
  });

  it("rate limit (V6.1.1)", async () => {
    srv = await makeServer({ RATE_LIMIT_PER_MINUTE: "3" });
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await srv.app.inject({ method: "GET", url: "/api/v1/providers" })).statusCode);
    expect(codes.slice(0, 3)).toEqual([200, 200, 200]);
    expect(codes[4]).toBe(429);
  });

  it("단위: safeEqual / isOriginAllowed / RateLimiter", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(isOriginAllowed(undefined, "h", [])).toBe(true);
    expect(isOriginAllowed("chrome-extension://x", "h", [])).toBe(true);
    expect(isOriginAllowed("null", "h", [])).toBe(false);
    expect(isOriginAllowed("https://a.b", "h", ["https://a.b"])).toBe(true);
    const l = new RateLimiter(1, 1000);
    expect(l.hit("k", 0)).toBe(false);
    expect(l.hit("k", 1)).toBe(true);
    expect(l.hit("k", 2000)).toBe(false);
  });
});
