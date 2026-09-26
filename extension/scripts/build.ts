import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

import { PROVIDERS } from "../src/adapters/outbound/providers/registry";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
const at = (p: string) => resolve(root, p);

async function main(): Promise<void> {
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });

  const common = { bundle: true, target: "chrome116", sourcemap: false, logLevel: "warning" as const };

  // 서비스 워커(ES module) / 팝업·설정 페이지 / provider별 콘텐츠 스크립트(iife)
  await build({ ...common, format: "esm", entryPoints: { background: at("src/adapters/inbound/background/main.ts") }, outdir: dist });
  await build({
    ...common,
    format: "iife",
    entryPoints: {
      "popup/popup": at("src/adapters/inbound/popup/popup.ts"),
      "options/options": at("src/adapters/inbound/options/options.ts"),
    },
    outdir: dist,
  });
  await build({
    ...common,
    format: "iife",
    entryPoints: Object.fromEntries(PROVIDERS.map((p) => [`content/${p.id}`, at(`src/content/${p.id}.ts`)])),
    outdir: dist,
  });

  await mkdir(resolve(dist, "popup"), { recursive: true });
  await mkdir(resolve(dist, "options"), { recursive: true });
  await cp(at("static/popup.html"), resolve(dist, "popup/popup.html"));
  await cp(at("static/options.html"), resolve(dist, "options/options.html"));
  await cp(at("static/ui.css"), resolve(dist, "ui.css"));
  await cp(at("static/icons"), resolve(dist, "icons"), { recursive: true });

  // manifest.json은 provider 등록부에서 생성한다: 새 사이트를 추가해도 매니페스트를 손대지 않는다 (PLAN2 §12.4)
  const pkg = JSON.parse(await readFile(at("package.json"), "utf8")) as { version: string };
  const icons = { 16: "icons/16.png", 32: "icons/32.png", 48: "icons/48.png", 128: "icons/128.png" };
  const matches = PROVIDERS.flatMap((p) => p.matches);
  const manifest = {
    manifest_version: 3,
    name: "Query",
    version: pkg.version,
    description: "웹서버에 쌓인 질의를 로그인된 브라우저에서 대신 질의하고 결과를 서버로 돌려줍니다.",
    minimum_chrome_version: "116",
    permissions: ["storage", "alarms", "scripting"],
    host_permissions: matches,
    background: { service_worker: "background.js", type: "module" },
    icons,
    action: { default_title: "Query", default_popup: "popup/popup.html", default_icon: icons },
    options_ui: { page: "options/options.html", open_in_tab: true },
    content_scripts: PROVIDERS.map((p) => ({ matches: p.matches, js: [`content/${p.id}.js`], run_at: "document_idle" })),
  };
  await writeFile(resolve(dist, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
  console.log(`built ${PROVIDERS.map((p) => p.id).join(", ")} → ${dist}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
