import { buildApp } from "./adapters/inbound/rest/app";
import { startBackground } from "./background";
import { loadDotEnv, loadSettings } from "./config";
import { buildContainer } from "./container";

async function main(): Promise<void> {
  loadDotEnv();
  const settings = loadSettings();
  const container = buildContainer(settings);
  await container.repo.init();

  const recovered = await container.repo.recoverProcessing();
  if (recovered > 0) console.log(`processing 잔여 ${recovered}건을 pending으로 복구`);

  const app = await buildApp(container, { logger: true });
  const stopBackground = startBackground(container);

  const shutdown = async (signal: string) => {
    console.log(`${signal} 수신, 종료합니다`);
    stopBackground();
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await app.listen({ host: settings.host, port: settings.port });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
