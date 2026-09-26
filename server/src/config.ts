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
  /** 카테고리별 답변작성 지침 디렉터리 (<category>.md, 기본 general.md) */
  promptsDir: string;
  answersDir: string;
  webDistDir: string;
  maxQueryLength: number;
  askDefaultTimeoutSeconds: number;
  askMaxTimeoutSeconds: number;
  displayTimezone: string;
  /** 허용할 API 토큰(쉼표로 여러 개). 비어 있으면 REST(/api)·MCP·확장 WebSocket 모두 무인증. 설정 시 `Authorization: Bearer`(WebSocket은 `?token=`도) 필수 (ASVS V8.2.1) */
  apiTokens: string[];
  /** 브라우저 Origin 허용 목록. 비어 있으면 요청 Host와 동일한 Origin만 허용 (ASVS V3.5.x, V4.4.2) */
  allowedOrigins: string[];
  /** 요청 본문 최대 바이트 (ASVS V2.2.x) */
  maxBodyBytes: number;
  /** IP당 분당 요청 한도 (ASVS V6.1.1, V2.4.1). 0이면 비활성 */
  rateLimitPerMinute: number;
  /** reverse proxy 뒤에서 X-Forwarded-*를 신뢰할지 */
  trustProxy: boolean;
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
  const supportedProviders = ["perplexity", "claude", "chatgpt", "gemini"]; // 확장에 콘텐츠 스크립트가 있는 provider
  return {
    host: env.QUERY_HOST || "127.0.0.1",
    port: int(env.QUERY_PORT, 4444),
    basePath: (env.BASE_PATH ?? "").replace(/\/+$/, ""),
    supportedProviders,
    defaultProviders: list(env.DEFAULT_PROVIDERS, ["perplexity"]),
    maxRetry: int(env.MAX_RETRY, 2),
    retryBackoffSeconds: int(env.RETRY_BACKOFF_SECONDS, 30),
    leaseSeconds: int(env.LEASE_SECONDS, 120),
    leaseSweepIntervalSeconds: int(env.LEASE_SWEEP_INTERVAL_SECONDS, 10),
    cleanupIntervalHours: int(env.CLEANUP_INTERVAL_HOURS, 24),
    retentionDays: int(env.RETENTION_DAYS, 7),
    dbPath: path(env.DB_PATH, "user/database/query.db"),
    promptsDir: path(env.PROMPTS_DIR, "user/prompts"),
    answersDir: path(env.ANSWERS_DIR, "user/answers"),
    webDistDir: path(env.WEB_DIST_DIR, "server/web/dist"),
    maxQueryLength: int(env.MAX_QUERY_LENGTH, 4000),
    askDefaultTimeoutSeconds: int(env.ASK_DEFAULT_TIMEOUT_SECONDS, 60),
    askMaxTimeoutSeconds: int(env.ASK_MAX_TIMEOUT_SECONDS, 300),
    displayTimezone: env.DISPLAY_TIMEZONE || "Asia/Seoul",
    apiTokens: list(env.API_TOKEN, []),
    allowedOrigins: list(env.ALLOWED_ORIGINS, []).map((o) => o.replace(/\/+$/, "")),
    maxBodyBytes: int(env.MAX_BODY_BYTES, 256 * 1024),
    rateLimitPerMinute: int(env.RATE_LIMIT_PER_MINUTE, 300),
    trustProxy: env.TRUST_PROXY === "true" || env.TRUST_PROXY === "1",
  };
}

/** 저장소 루트의 .env를 process.env에 로드 (이미 설정된 값은 덮어쓰지 않는다). */
export function loadDotEnv(root: string = REPO_ROOT): void {
  const file = resolve(root, ".env");
  if (existsSync(file)) process.loadEnvFile(file);
}
