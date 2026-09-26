import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";

const NOT_BUILT = `<!doctype html><meta charset="utf-8"><title>Query</title>
<p>웹 UI가 아직 빌드되지 않았습니다. <code>npm --prefix server/web run build</code></p>`;

/**
 * 웹 UI(Svelte SPA 빌드 결과)를 서빙한다.
 * index.html의 `%BASE_HREF%`를 basePath로 치환해 `<base href>`를 주입하므로,
 * 프런트는 basePath를 몰라도 상대 경로로 자산/API를 호출할 수 있다.
 */
export async function registerWebRoutes(app: FastifyInstance, distDir: string, basePath: string): Promise<void> {
  const baseHref = `${basePath}/`;
  const indexPath = join(distDir, "index.html");

  if (existsSync(distDir)) {
    await app.register(fastifyStatic, { root: distDir, index: false, wildcard: false });
  }

  const sendIndex = async (reply: { type(t: string): { send(b: string): unknown } }) => {
    const html = existsSync(indexPath)
      ? (await readFile(indexPath, "utf8")).replaceAll("%BASE_HREF%", baseHref)
      : NOT_BUILT;
    return reply.type("text/html; charset=utf-8").send(html);
  };

  app.get("/", (_req, reply) => sendIndex(reply));
  app.get("/queries/:id", (_req, reply) => sendIndex(reply));
}
