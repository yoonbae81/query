import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";

// 서버가 index.html의 %BASE_HREF%를 basePath로 치환한다. 개발 서버에서는 "/"로 치환한다.
export default defineConfig({
  base: "./",
  plugins: [
    svelte(),
    {
      name: "base-href-dev",
      transformIndexHtml: {
        order: "pre",
        handler: (html, ctx) => (ctx.server ? html.replaceAll("%BASE_HREF%", "/") : html),
      },
    },
  ],
  server: { proxy: { "/api": "http://127.0.0.1:4444" } },
  build: { outDir: "dist", emptyOutDir: true },
  resolve: process.env.VITEST ? { conditions: ["browser"] } : undefined,
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
    setupFiles: ["./src/test-setup.ts"],
  },
});
