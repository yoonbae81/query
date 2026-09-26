import { randomInt } from "node:crypto";

export type ResultStatus = "pending" | "processing" | "done" | "failed";

export const RESULT_STATUSES: readonly ResultStatus[] = ["pending", "processing", "done", "failed"];

export const PRIORITY_NORMAL = 0;
export const PRIORITY_HIGH = 1;

export interface Query {
  id: string;
  queryText: string;
  /** 질문 카테고리. 시스템 프롬프트 선택 기준 (기본 general) */
  category: string;
  providers: string[];
  batchId: string | null;
  createdAt: Date;
}

export interface QueryResult {
  id: string;
  queryId: string;
  provider: string;
  status: ResultStatus;
  priority: number;
  progressMessage: string | null;
  answer: string | null;
  citations: string[] | null;
  answerFilePath: string | null;
  systemPromptSnapshot: string | null;
  errorMessage: string | null;
  retryCount: number;
  nextAttemptAt: Date | null;
  leaseExpiresAt: Date | null;
  claimedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** 확장이 가져가 처리하는 작업 (PLAN2 §4.2 job) */
export interface Job {
  resultId: string;
  provider: string;
  prompt: string;
  leaseSeconds: number;
}

export interface ProviderAnswer {
  text: string;
  citations: string[];
}

let lastMs = 0;

/**
 * 프로세스 내에서 항상 이전보다 큰 시각을 돌려준다.
 * 같은 밀리초에 등록된 항목도 created_at이 구분되어 FIFO/페이지네이션 순서가 유지된다.
 */
export function monotonicNow(): Date {
  lastMs = Math.max(Date.now(), lastMs + 1);
  return new Date(lastMs);
}

const ID_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

/** `q_a3f9k2` 형태의 랜덤 ID (PLAN §3.0) */
export function newId(prefix: string): string {
  let out = "";
  for (let i = 0; i < 6; i++) out += ID_CHARS[randomInt(ID_CHARS.length)];
  return `${prefix}_${out}`;
}

export function newQueryResult(
  queryId: string,
  provider: string,
  priority: number,
  now: Date = monotonicNow(),
): QueryResult {
  return {
    id: newId("r"),
    queryId,
    provider,
    status: "pending",
    priority,
    progressMessage: null,
    answer: null,
    citations: null,
    answerFilePath: null,
    systemPromptSnapshot: null,
    errorMessage: null,
    retryCount: 0,
    nextAttemptAt: null,
    leaseExpiresAt: null,
    claimedBy: null,
    createdAt: now,
    updatedAt: now,
  };
}
