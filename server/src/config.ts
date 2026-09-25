import { existsSync } from "node:fs";
import { resolve } from "node:path";

export interface Settings {
  host: string;
  port: number;
  /** reverse proxy가 매핑하는 basePath. 프록시가 접두사를 제거해 전달하므로 라우트는 항상 "/"부터다. */
  basePath: string;
  supportedProviders: string[];
  defaultProviders: string[];
  maxRetry: number;
  retryBackoffSeconds: number;
  leaseSeconds: number;
  leaseSweepIntervalSeconds: number;
  cleanupIntervalHours: number;
  retentionDays: number;
  dbPath: string;
  systemPromptPath: string;
  answersDir: string;
  webDistDir: string;
  maxQueryLength: number;
  askDefaultTimeoutSeconds: number;
  askMaxTimeoutSeconds: number;
  displayTimezone: string;
  /** 비어 있으면 무인증 (PLAN2 §4.1, 향후 토큰 도입) */
  authToken: string;
}

/** 저장소 루트: server/src(또는 server/dist)에서 두 단계 위 */
export const REPO_ROOT = resolve(import.meta.dirname, "../..");

type Env = Record<string, string | undefined>;

function list(value: string | undefined, fallback: string[]): string[] {
  if (!value?.trim()) return fallback;
  const v = value.trim();
  if (v.startsWith("[")) return (JSON.parse(v) as unknown[]).map(String);
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

function int(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return value !== undefined && value !== "" && Number.isFinite(n) ? n : fallback;
}

export function loadSettings(env: Env = process.env, root: string = REPO_ROOT): Settings {
  const path = (value: string | undefined, fallback: string) => resolve(root, value || fallback);
  const supportedProviders = ["perplexity"]; // MVP: 콘텐츠 스크립트가 있는 provider (PLAN2 §1.2)
  return {
    host: env.QUERY_HOST || "127.0.0.1",
    port: int(env.QUERY_PORT, 8000),
    basePath: (env.BASE_PATH ?? "").replace(/\/+$/, ""),
    supportedProviders,
    defaultProviders: list(env.DEFAULT_PROVIDERS, ["perplexity"]),
    maxRetry: int(env.MAX_RETRY, 2),
    retryBackoffSeconds: int(env.RETRY_BACKOFF_SECONDS, 30),
    leaseSeconds: int(env.LEASE_SECONDS, 120),
    leaseSweepIntervalSeconds: int(env.LEASE_SWEEP_INTERVAL_SECONDS, 10),
    cleanupIntervalHours: int(env.CLEANUP_INTERVAL_HOURS, 24),
    retentionDays: int(env.RETENTION_DAYS, 7),
    dbPath: path(env.DB_PATH, "user/query.db"),
    systemPromptPath: path(env.SYSTEM_PROMPT_PATH, "user/config/system_prompt.md"),
    answersDir: path(env.ANSWERS_DIR, "user/answers"),
    webDistDir: path(env.WEB_DIST_DIR, "server/web/dist"),
    maxQueryLength: int(env.MAX_QUERY_LENGTH, 4000),
    askDefaultTimeoutSeconds: int(env.ASK_DEFAULT_TIMEOUT_SECONDS, 60),
    askMaxTimeoutSeconds: int(env.ASK_MAX_TIMEOUT_SECONDS, 300),
    displayTimezone: env.DISPLAY_TIMEZONE || "Asia/Seoul",
    authToken: env.AUTH_TOKEN ?? "",
  };
}

/** 저장소 루트의 .env를 process.env에 로드 (이미 설정된 값은 덮어쓰지 않는다). */
export function loadDotEnv(root: string = REPO_ROOT): void {
  const file = resolve(root, ".env");
  if (existsSync(file)) process.loadEnvFile(file);
}
