import type { AddressInfo } from "node:net";
import { WebSocketServer, type WebSocket as ServerSocket } from "ws";
import { afterEach, describe, expect, it } from "vitest";

import { testConnection, WebSocketServerGateway } from "../src/adapters/outbound/gateway/webSocketServerGateway";
import type { ServerMessage } from "../../protocol";
import type { ConnectionStatus } from "../src/domain/model";

let wss: WebSocketServer | undefined;
let gateway: WebSocketServerGateway | undefined;

afterEach(async () => {
  gateway?.disconnect();
  gateway = undefined;
  await new Promise<void>((r) => (wss ? wss.close(() => r()) : r()));
  wss = undefined;
});

async function startServer(onConn?: (s: ServerSocket, url: string) => void): Promise<{ url: string; sockets: ServerSocket[]; urls: string[] }> {
  const sockets: ServerSocket[] = [];
  const urls: string[] = [];
  wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  wss.on("connection", (s, req) => {
    sockets.push(s);
    urls.push(req.url ?? "");
    onConn?.(s, req.url ?? "");
  });
  await new Promise<void>((r) => wss!.once("listening", () => r()));
  return { url: `http://127.0.0.1:${(wss.address() as AddressInfo).port}`, sockets, urls };
}

const until = async (cond: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("조건 대기 시간 초과");
    await new Promise((r) => setTimeout(r, 10));
  }
};
const settings = (serverUrl: string, authToken = "") => ({ serverUrl, authToken, minIntervalSeconds: 10 });

describe("WebSocketServerGateway", () => {
  it("연결되면 상태와 onOpen을 알리고 메시지를 주고받는다", async () => {
    const srv = await startServer((s) => s.on("message", (d) => s.send(JSON.stringify({ type: "echo", got: JSON.parse(String(d)) }))));
    gateway = new WebSocketServerGateway();
    const statuses: ConnectionStatus[] = [];
    const received: unknown[] = [];
    let opened = 0;
    gateway.onStatusChange((s) => statuses.push(s));
    gateway.onMessage((m: ServerMessage) => received.push(m));
    gateway.onOpen(() => opened++);

    expect(gateway.send({ type: "ping" })).toBe(false); // 연결 전
    gateway.connect(settings(srv.url));
    await until(() => opened === 1);
    expect(statuses).toEqual(["connecting", "connected"]);
    expect(srv.urls[0]).toBe("/ext/ws");

    expect(gateway.send({ type: "claim", provider: "perplexity" })).toBe(true);
    await until(() => received.length === 1);
    expect(received[0]).toEqual({ type: "echo", got: { type: "claim", provider: "perplexity" } });
  });

  it("토큰은 쿼리 파라미터로 전달한다", async () => {
    const srv = await startServer();
    gateway = new WebSocketServerGateway();
    gateway.connect(settings(srv.url, "s3cret"));
    await until(() => srv.urls.length === 1);
    expect(srv.urls[0]).toBe("/ext/ws?token=s3cret");
  });

  it("서버가 끊으면 백오프 후 다시 연결하고 onOpen을 다시 호출한다", async () => {
    const srv = await startServer();
    gateway = new WebSocketServerGateway({ backoffMs: [20] });
    let opened = 0;
    gateway.onOpen(() => opened++);
    gateway.connect(settings(srv.url));
    await until(() => opened === 1);
    srv.sockets[0]!.terminate();
    await until(() => opened === 2);
    expect(srv.sockets).toHaveLength(2);
  });

  it("disconnect 후에는 재연결하지 않는다", async () => {
    const srv = await startServer();
    gateway = new WebSocketServerGateway({ backoffMs: [20] });
    const statuses: ConnectionStatus[] = [];
    gateway.onStatusChange((s) => statuses.push(s));
    gateway.connect(settings(srv.url));
    await until(() => srv.sockets.length === 1);
    gateway.disconnect();
    await new Promise((r) => setTimeout(r, 150));
    expect(srv.sockets).toHaveLength(1);
    expect(statuses.at(-1)).toBe("disconnected");
    expect(gateway.send({ type: "ping" })).toBe(false);
  });

  it("연결된 동안 주기적으로 ping을 보낸다", async () => {
    const pings: unknown[] = [];
    const srv = await startServer((s) => s.on("message", (d) => pings.push(JSON.parse(String(d)))));
    gateway = new WebSocketServerGateway({ pingIntervalMs: 30 });
    gateway.connect(settings(srv.url));
    await until(() => pings.length >= 2);
    expect(pings[0]).toEqual({ type: "ping" });
  });

  it("서버가 없으면 계속 재시도하며 연결 상태가 끊김/연결 중을 오간다", async () => {
    gateway = new WebSocketServerGateway({ backoffMs: [20] });
    const statuses: ConnectionStatus[] = [];
    gateway.onStatusChange((s) => statuses.push(s));
    gateway.connect(settings("http://127.0.0.1:1"));
    await until(() => statuses.filter((s) => s === "connecting").length >= 2);
    expect(statuses).not.toContain("connected");
  });
});

describe("testConnection", () => {
  it("핸드셰이크가 되면 성공한다", async () => {
    const srv = await startServer((s) => s.on("message", () => s.send(JSON.stringify({ type: "pong" }))));
    expect(await testConnection(settings(srv.url))).toEqual({ ok: true, message: "연결되었습니다." });
  });

  it("서버 주소가 비었거나 연결할 수 없으면 실패한다", async () => {
    expect((await testConnection(settings(""))).ok).toBe(false);
    const r = await testConnection(settings("http://127.0.0.1:1"), 2000);
    expect(r.ok).toBe(false);
  });

  it("4401로 닫히면 인증 실패로 안내한다", async () => {
    const srv = await startServer((s) => s.close(4401, "unauthorized"));
    const r = await testConnection(settings(srv.url));
    expect(r.ok).toBe(false);
    expect(r.message).toContain("인증");
  });
});
