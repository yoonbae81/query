import type { ProviderAnswer, Query, QueryResult } from "./entities";

export interface QueryWithResults {
  query: Query;
  results: QueryResult[];
}

export interface QueryPage {
  items: QueryWithResults[];
  nextCursor: string | null;
}

export interface ListQueriesParams {
  status?: string;
  batchId?: string;
  limit: number;
  cursor?: string;
}

export interface ClaimParams {
  now: Date;
  provider: string;
  claimedBy: string;
  leaseSeconds: number;
}

export interface QueryRepositoryPort {
  init(): Promise<void>;
  createQueries(items: QueryWithResults[]): Promise<void>;
  /** 이미 (queryId, provider)가 존재하는 결과는 건너뛰고, 실제 추가된 것만 반환 */
  addResults(queryId: string, results: QueryResult[]): Promise<QueryResult[]>;
  getQuery(queryId: string): Promise<Query | null>;
  getResults(queryId: string): Promise<QueryResult[]>;
  getResult(resultId: string): Promise<QueryResult | null>;
  listQueries(params: ListQueriesParams): Promise<QueryPage>;

  /** provider의 다음 pending을 priority DESC, created_at ASC 순으로 원자적으로 claim (임대 설정 포함) */
  claimNext(params: ClaimParams): Promise<QueryResult | null>;
  setProgress(resultId: string, message: string | null): Promise<void>;
  setSystemPromptSnapshot(resultId: string, snapshot: string): Promise<void>;
  extendLease(resultId: string, leaseExpiresAt: Date): Promise<void>;
  /** 해당 클라이언트가 임대 중인 모든 processing 결과의 임대를 연장 */
  extendLeasesOf(clientId: string, leaseExpiresAt: Date): Promise<void>;
  markDone(resultId: string, answer: string, citations: string[], answerFilePath: string): Promise<void>;
  /** retry_count += 1, status='pending' */
  scheduleRetry(resultId: string, errorMessage: string, nextAttemptAt: Date): Promise<void>;
  /** retry_count += 1, status='failed' */
  markFailed(resultId: string, errorMessage: string): Promise<void>;
  /** retry_count 증가 없이 pending으로 되돌림 (login_required) */
  releaseToPending(resultId: string, message: string): Promise<void>;
  /** failed 상태일 때만 retry_count=0, pending으로 리셋. 리셋했으면 true */
  resetForRetry(resultId: string): Promise<boolean>;
  /** 서버 기동 시 processing 잔여 행을 pending으로 복구 (횟수 증가 없음). 복구 건수 반환 */
  recoverProcessing(): Promise<number>;
  findExpiredLeases(now: Date): Promise<QueryResult[]>;
  /** 해당 클라이언트의 processing 임대를 즉시 만료 처리(연결 끊김). 처리 건수 반환 */
  expireLeasesOf(clientId: string, now: Date): Promise<number>;
  /** claim 가능한 pending 건수 (재시도 대기 경과 포함) */
  countClaimable(now: Date): Promise<number>;
  /** done/failed이며 updated_at < cutoff */
  findExpired(cutoff: Date): Promise<QueryResult[]>;
  /** 결과 삭제 후 결과가 하나도 없는 queries 행도 함께 삭제 */
  deleteResults(resultIds: string[]): Promise<void>;
}

export interface AnswerFileStoragePort {
  /** 저장 후 상대 경로 반환 (예: answers/250925_q_abc123_perplexity.md) */
  save(params: {
    queryId: string;
    provider: string;
    systemPrompt: string;
    question: string;
    answer: ProviderAnswer;
    createdAt: Date;
    answeredAt: Date;
  }): Promise<string>;
  delete(path: string): Promise<void>;
}

export interface SystemPromptConfigPort {
  /** 파일이 없으면 ("", 현재시각) */
  read(): Promise<{ content: string; updatedAt: Date }>;
  write(content: string): Promise<Date>;
}

export type ProviderStateValue = "ready" | "login_required" | "no_tab";

export interface PresenceSnapshot {
  clients: number;
  providers: { id: string; online: boolean; states: ProviderStateValue[] }[];
}

/** 확장 접속 상태 (PLAN2 §4.5). provider는 ready 상태의 클라이언트가 하나 이상이면 online */
export interface PresencePort {
  isProviderOnline(provider: string): boolean;
  snapshot(supportedProviders: string[]): PresenceSnapshot;
}

/** 새 작업이 생겼음을 접속 중인 확장에 알린다 (PLAN2 §4.4 wake) */
export interface ExtensionNotifierPort {
  wake(): void;
}
