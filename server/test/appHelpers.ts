import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FastifyInstance } from "fastify";

import { buildApp } from "../src/adapters/inbound/rest/app";
import { loadSettings } from "../src/config";
import { buildContainer, type Container } from "../src/container";

export interface TestServer {
  app: FastifyInstance;
  container: Container;
  dir: string;
  /** ws://127.0.0.1:PORT (listen이 호출된 경우) */
  wsUrl: string;
  listen(): Promise<void>;
  close(): Promise<void>;
}

export async function makeServer(env: Record<string, string> = {}, opts: { withDist?: boolean } = {}): Promise<TestServer> {
  const dir = mkdtempSync(join(tmpdir(), "query-app-"));
  const distDir = join(dir, "dist");
  if (opts.withDist) {
    mkdirSync(join(distDir, "assets"), { recursive: true });
    writeFileSync(join(distDir, "index.html"), '<!doctype html><base href="%BASE_HREF%"><div id="app"></div>');
    writeFileSync(join(distDir, "assets", "app.js"), "console.log('app')");
  }
  const settings = loadSettings(
    {
      DB_PATH: join(dir, "q.db"),
      SYSTEM_PROMPT_PATH: join(dir, "config", "system_prompt.md"),
      ANSWERS_DIR: join(dir, "answers"),
      WEB_DIST_DIR: distDir,
      ...env,
    },
    dir,
  );
  const container = buildContainer(settings);
  await container.repo.init();
  const app = await buildApp(container);
  const server: TestServer = {
    app,
    container,
    dir,
    wsUrl: "",
    async listen() {
      await app.listen({ host: "127.0.0.1", port: 0 });
      const addr = app.server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      server.wsUrl = `ws://127.0.0.1:${port}`;
    },
    async close() {
      await app.close();
    },
  };
  return server;
}

/** 테스트용 가짜 확장 클라이언트 (Node 내장 WebSocket) */
export class FakeExtension {
  private queue: Record<string, unknown>[] = [];
  private waiters: (() => void)[] = [];
  closed: { code: number } | null = null;

  private constructor(readonly ws: WebSocket) {
    ws.addEventListener("message", (ev) => {
      this.queue.push(JSON.parse(String(ev.data)) as Record<string, unknown>);
      this.waiters.splice(0).forEach((w) => w());
    });
    ws.addEventListener("close", (ev) => {
      this.closed = { code: ev.code };
      this.waiters.splice(0).forEach((w) => w());
    });
  }

  static async connect(url: string): Promise<FakeExtension> {
    const ws = new WebSocket(url);
    const ext = new FakeExtension(ws);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener("error", () => reject(new Error("ws connect failed")), { once: true });
      ws.addEventListener("close", () => resolve(), { once: true });
    });
    return ext;
  }

  send(message: Record<string, unknown>): void {
    this.ws.send(JSON.stringify(message));
  }

  hello(providers: { id: string; state: string }[] = [{ id: "perplexity", state: "ready" }], clientId = "ext-1"): void {
    this.send({ type: "hello", client_id: clientId, version: "test", providers });
  }

  /** 조건에 맞는 다음 메시지를 기다린다 (그 이전 메시지는 버린다) */
  async next(type: string, timeoutMs = 3000): Promise<Record<string, unknown>> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const idx = this.queue.findIndex((m) => m.type === type);
      if (idx >= 0) return this.queue.splice(idx, 1)[0]!;
      if (this.closed) throw new Error(`연결이 닫혔습니다 (code ${this.closed.code})`);
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`${type} 메시지 대기 시간 초과`);
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, left);
        this.waiters.push(() => (clearTimeout(t), resolve()));
      });
    }
  }

  async waitClosed(timeoutMs = 3000): Promise<number> {
    const deadline = Date.now() + timeoutMs;
    while (!this.closed) {
      if (Date.now() > deadline) throw new Error("close 대기 시간 초과");
      await new Promise((r) => setTimeout(r, 10));
    }
    return this.closed.code;
  }

  close(): void {
    this.ws.close();
  }
}

export async function until(cond: () => boolean | Promise<boolean>, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await cond())) {
    if (Date.now() > deadline) throw new Error("조건 대기 시간 초과");
    await new Promise((r) => setTimeout(r, 10));
  }
}
