import { buildApp } from "./adapters/inbound/rest/app";
import { startBackground } from "./background";
import { loadDotEnv, loadSettings } from "./config";
import { buildContainer } from "./container";

async function main(): Promise<void> {
  loadDotEnv();
  const settings = loadSettings();
  const loopback = ["127.0.0.1", "::1", "localhost"].includes(settings.host);
  if (!loopback && settings.apiTokens.length === 0) {
    throw new Error("QUERY_HOST가 loopback이 아닌데 API_TOKEN이 없습니다. 인증 없이 외부에 노출할 수 없습니다.");
  }
  const container = buildContainer(settings);
  await container.repo.init();

  const recovered = await container.repo.recoverProcessing();
  if (recovered > 0) console.log(`processing 잔여 ${recovered}건을 pending으로 복구`);

  const app = await buildApp(container, { logger: true });
  const stopBackground = startBackground(container);

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} 수신, 종료합니다`);
    stopBackground();
    await app.close();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  // Windows 콘솔 창/Ctrl+C/Ctrl+Break 종료 호환성
  if (process.platform === "win32") {
    try {
      const readline = await import("node:readline");
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.on("SIGINT", () => process.emit("SIGINT"));
    } catch {
      /* stdin이 TTY가 아닌 환경(백그라운드/서비스 등)에서는 readline 생성 실패 무시 */
    }
    process.on("SIGBREAK", () => void shutdown("SIGBREAK"));
  }

  await app.listen({ host: settings.host, port: settings.port });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
