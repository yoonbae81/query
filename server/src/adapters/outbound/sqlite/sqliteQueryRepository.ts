import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

import type { Query, QueryResult, ResultStatus } from "../../../domain/entities";
import type {
  ClaimParams,
  ListQueriesParams,
  QueryPage,
  QueryRepositoryPort,
  QueryWithResults,
} from "../../../domain/ports";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS queries (
    id TEXT PRIMARY KEY,
    query_text TEXT NOT NULL,
    batch_id TEXT,
    providers TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS query_results (
    id TEXT PRIMARY KEY,
    query_id TEXT NOT NULL REFERENCES queries(id),
    provider TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    progress_message TEXT,
    answer TEXT,
    citations TEXT,
    answer_file_path TEXT,
    system_prompt_snapshot TEXT,
    error_message TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT,
    priority INTEGER NOT NULL DEFAULT 0,
    lease_expires_at TEXT,
    claimed_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (query_id, provider)
);
CREATE INDEX IF NOT EXISTS idx_results_pending ON query_results (status, provider, priority DESC, created_at);
CREATE INDEX IF NOT EXISTS idx_queries_created ON queries (created_at DESC, id DESC);
`;

type Row = Record<string, unknown>;

const ts = (d: Date): string => d.toISOString();
const dt = (v: unknown): Date | null => (typeof v === "string" ? new Date(v) : null);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

function toQuery(r: Row): Query {
  return {
    id: r.id as string,
    queryText: r.query_text as string,
    providers: JSON.parse(r.providers as string) as string[],
    batchId: str(r.batch_id),
    createdAt: new Date(r.created_at as string),
  };
}

function toResult(r: Row): QueryResult {
  return {
    id: r.id as string,
    queryId: r.query_id as string,
    provider: r.provider as string,
    status: r.status as ResultStatus,
    priority: Number(r.priority),
    progressMessage: str(r.progress_message),
    answer: str(r.answer),
    citations: typeof r.citations === "string" ? (JSON.parse(r.citations) as string[]) : null,
    answerFilePath: str(r.answer_file_path),
    systemPromptSnapshot: str(r.system_prompt_snapshot),
    errorMessage: str(r.error_message),
    retryCount: Number(r.retry_count),
    nextAttemptAt: dt(r.next_attempt_at),
    leaseExpiresAt: dt(r.lease_expires_at),
    claimedBy: str(r.claimed_by),
    createdAt: new Date(r.created_at as string),
    updatedAt: new Date(r.updated_at as string),
  };
}

const INSERT_RESULT =
  "INSERT OR IGNORE INTO query_results " +
  "(id, query_id, provider, status, priority, retry_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)";

function resultParams(r: QueryResult): SQLInputValue[] {
  return [r.id, r.queryId, r.provider, r.status, r.priority, r.retryCount, ts(r.createdAt), ts(r.updatedAt)];
}

/** node:sqlite(내장, 동기) 기반 저장소. 단일 프로세스 안에서 사용한다. */
export class SqliteQueryRepository implements QueryRepositoryPort {
  private db!: DatabaseSync;

  constructor(private readonly dbPath: string) {}

  async init(): Promise<void> {
    if (this.dbPath !== ":memory:") mkdirSync(dirname(this.dbPath), { recursive: true });
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec("PRAGMA journal_mode=WAL");
    this.db.exec("PRAGMA busy_timeout=5000");
    this.db.exec("PRAGMA foreign_keys=ON");
    this.db.exec(SCHEMA);
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  /** 이전 스키마(임대 컬럼 없음)로 만들어진 DB 대응 */
  private migrate(): void {
    const cols = new Set(
      (this.db.prepare("PRAGMA table_info(query_results)").all() as Row[]).map((c) => c.name as string),
    );
    if (!cols.has("lease_expires_at")) this.db.exec("ALTER TABLE query_results ADD COLUMN lease_expires_at TEXT");
    if (!cols.has("claimed_by")) this.db.exec("ALTER TABLE query_results ADD COLUMN claimed_by TEXT");
  }

  private tx<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      this.db.exec("COMMIT");
      return out;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  private run(sql: string, ...params: SQLInputValue[]): number {
    return Number(this.db.prepare(sql).run(...params).changes);
  }

  private all(sql: string, ...params: SQLInputValue[]): Row[] {
    return this.db.prepare(sql).all(...params) as Row[];
  }

  private get(sql: string, ...params: SQLInputValue[]): Row | undefined {
    return this.db.prepare(sql).get(...params) as Row | undefined;
  }

  async createQueries(items: QueryWithResults[]): Promise<void> {
    this.tx(() => {
      for (const { query: q, results } of items) {
        this.run(
          "INSERT INTO queries (id, query_text, batch_id, providers, created_at) VALUES (?, ?, ?, ?, ?)",
          q.id,
          q.queryText,
          q.batchId,
          JSON.stringify(q.providers),
          ts(q.createdAt),
        );
        for (const r of results) this.run(INSERT_RESULT, ...resultParams(r));
      }
    });
  }

  async addResults(queryId: string, results: QueryResult[]): Promise<QueryResult[]> {
    return this.tx(() => {
      const added: QueryResult[] = [];
      for (const r of results) {
        if (this.run(INSERT_RESULT, ...resultParams(r)) === 1) added.push(r);
      }
      if (added.length > 0) {
        const row = this.get("SELECT providers FROM queries WHERE id=?", queryId);
        const providers: string[] = row ? (JSON.parse(row.providers as string) as string[]) : [];
        for (const r of added) if (!providers.includes(r.provider)) providers.push(r.provider);
        this.run("UPDATE queries SET providers=? WHERE id=?", JSON.stringify(providers), queryId);
      }
      return added;
    });
  }

  async getQuery(queryId: string): Promise<Query | null> {
    const row = this.get("SELECT * FROM queries WHERE id=?", queryId);
    return row ? toQuery(row) : null;
  }

  async getResults(queryId: string): Promise<QueryResult[]> {
    return this.all("SELECT * FROM query_results WHERE query_id=? ORDER BY created_at, rowid", queryId).map(toResult);
  }

  async getResult(resultId: string): Promise<QueryResult | null> {
    const row = this.get("SELECT * FROM query_results WHERE id=?", resultId);
    return row ? toResult(row) : null;
  }

  async listQueries(p: ListQueriesParams): Promise<QueryPage> {
    const where: string[] = [];
    const params: SQLInputValue[] = [];
    if (p.status) {
      where.push("EXISTS (SELECT 1 FROM query_results r WHERE r.query_id=q.id AND r.status=?)");
      params.push(p.status);
    }
    if (p.batchId) {
      where.push("q.batch_id=?");
      params.push(p.batchId);
    }
    if (p.cursor) {
      const c = JSON.parse(Buffer.from(p.cursor, "base64url").toString("utf8")) as {
        created_at: string;
        id: string;
      };
      where.push("(q.created_at, q.id) < (?, ?)");
      params.push(c.created_at, c.id);
    }
    let sql = "SELECT q.* FROM queries q";
    if (where.length) sql += " WHERE " + where.join(" AND ");
    sql += " ORDER BY q.created_at DESC, q.id DESC LIMIT ?";
    params.push(p.limit + 1);

    const rows = this.all(sql, ...params);
    const hasMore = rows.length > p.limit;
    const page = rows.slice(0, p.limit);
    const queries = page.map(toQuery);
    const byQuery = new Map<string, QueryResult[]>(queries.map((q) => [q.id, []]));
    if (queries.length > 0) {
      const marks = queries.map(() => "?").join(",");
      const results = this.all(
        `SELECT * FROM query_results WHERE query_id IN (${marks}) ORDER BY created_at, rowid`,
        ...queries.map((q) => q.id),
      );
      for (const r of results) byQuery.get(r.query_id as string)?.push(toResult(r));
    }
    let nextCursor: string | null = null;
    const last = page[page.length - 1];
    if (hasMore && last) {
      nextCursor = Buffer.from(JSON.stringify({ created_at: last.created_at, id: last.id })).toString("base64url");
    }
    return { items: queries.map((q) => ({ query: q, results: byQuery.get(q.id) ?? [] })), nextCursor };
  }

  async claimNext(p: ClaimParams): Promise<QueryResult | null> {
    return this.tx(() => {
      const row = this.get(
        "SELECT id FROM query_results WHERE status='pending' AND provider=? " +
          "AND (next_attempt_at IS NULL OR next_attempt_at <= ?) " +
          "ORDER BY priority DESC, created_at ASC, rowid ASC LIMIT 1",
        p.provider,
        ts(p.now),
      );
      if (!row) return null;
      const lease = new Date(p.now.getTime() + p.leaseSeconds * 1000);
      const changed = this.run(
        "UPDATE query_results SET status='processing', progress_message='시작', claimed_by=?, " +
          "lease_expires_at=?, updated_at=? WHERE id=? AND status='pending'",
        p.claimedBy,
        ts(lease),
        ts(p.now),
        row.id as string,
      );
      if (changed !== 1) return null;
      return toResult(this.get("SELECT * FROM query_results WHERE id=?", row.id as string)!);
    });
  }

  private update(resultId: string, sets: string, ...params: SQLInputValue[]): number {
    return this.run(`UPDATE query_results SET ${sets}, updated_at=? WHERE id=?`, ...params, ts(new Date()), resultId);
  }

  async setProgress(resultId: string, message: string | null): Promise<void> {
    this.update(resultId, "progress_message=?", message);
  }

  async setSystemPromptSnapshot(resultId: string, snapshot: string): Promise<void> {
    this.update(resultId, "system_prompt_snapshot=?", snapshot);
  }

  async extendLease(resultId: string, leaseExpiresAt: Date): Promise<void> {
    this.update(resultId, "lease_expires_at=?", ts(leaseExpiresAt));
  }

  async extendLeasesOf(clientId: string, leaseExpiresAt: Date): Promise<void> {
    this.run(
      "UPDATE query_results SET lease_expires_at=? WHERE status='processing' AND claimed_by=?",
      ts(leaseExpiresAt),
      clientId,
    );
  }

  async markDone(resultId: string, answer: string, citations: string[], answerFilePath: string): Promise<void> {
    this.update(
      resultId,
      "status='done', answer=?, citations=?, answer_file_path=?, progress_message=NULL, error_message=NULL, " +
        "lease_expires_at=NULL",
      answer,
      JSON.stringify(citations),
      answerFilePath,
    );
  }

  async scheduleRetry(resultId: string, errorMessage: string, nextAttemptAt: Date): Promise<void> {
    this.update(
      resultId,
      "status='pending', retry_count=retry_count+1, error_message=?, progress_message=NULL, " +
        "next_attempt_at=?, lease_expires_at=NULL, claimed_by=NULL",
      errorMessage,
      ts(nextAttemptAt),
    );
  }

  async markFailed(resultId: string, errorMessage: string): Promise<void> {
    this.update(
      resultId,
      "status='failed', retry_count=retry_count+1, error_message=?, progress_message=NULL, lease_expires_at=NULL",
      errorMessage,
    );
  }

  async releaseToPending(resultId: string, message: string): Promise<void> {
    this.update(
      resultId,
      "status='pending', error_message=?, progress_message=NULL, lease_expires_at=NULL, claimed_by=NULL",
      message,
    );
  }

  async resetForRetry(resultId: string): Promise<boolean> {
    return (
      this.run(
        "UPDATE query_results SET status='pending', retry_count=0, error_message=NULL, progress_message=NULL, " +
          "next_attempt_at=NULL, lease_expires_at=NULL, claimed_by=NULL, updated_at=? WHERE id=? AND status='failed'",
        ts(new Date()),
        resultId,
      ) === 1
    );
  }

  async recoverProcessing(): Promise<number> {
    return this.run(
      "UPDATE query_results SET status='pending', progress_message=NULL, lease_expires_at=NULL, claimed_by=NULL, " +
        "updated_at=? WHERE status='processing'",
      ts(new Date()),
    );
  }

  async findExpiredLeases(now: Date): Promise<QueryResult[]> {
    return this.all(
      "SELECT * FROM query_results WHERE status='processing' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?",
      ts(now),
    ).map(toResult);
  }

  async expireLeasesOf(clientId: string, now: Date): Promise<number> {
    return this.run(
      "UPDATE query_results SET lease_expires_at=? WHERE status='processing' AND claimed_by=?",
      ts(now),
      clientId,
    );
  }

  async countClaimable(now: Date): Promise<number> {
    const row = this.get(
      "SELECT COUNT(*) AS n FROM query_results WHERE status='pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)",
      ts(now),
    );
    return Number(row?.n ?? 0);
  }

  async findExpired(cutoff: Date): Promise<QueryResult[]> {
    return this.all(
      "SELECT * FROM query_results WHERE status IN ('done','failed') AND updated_at < ?",
      ts(cutoff),
    ).map(toResult);
  }

  async deleteResults(resultIds: string[]): Promise<void> {
    if (resultIds.length === 0) return;
    const marks = resultIds.map(() => "?").join(",");
    this.tx(() => {
      this.run(`DELETE FROM query_results WHERE id IN (${marks})`, ...resultIds);
      this.run("DELETE FROM queries WHERE NOT EXISTS (SELECT 1 FROM query_results r WHERE r.query_id=queries.id)");
    });
  }
}
