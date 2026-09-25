import { PRIORITY_HIGH, type QueryResult } from "../domain/entities";
import { InvalidRequest } from "../domain/errors";
import type { PresencePort, QueryRepositoryPort } from "../domain/ports";
import type { SubmitQuery } from "./submitQuery";

export interface AskOutcome {
  queryId: string;
  results: QueryResult[];
  note?: string;
}

const isTerminal = (r: QueryResult) => r.status === "done" || r.status === "failed";
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * 동기 질의 (PLAN §4.6, PLAN2 §5.2): 높은 우선순위로 등록한 뒤 완료/타임아웃까지 대기한다.
 * 요청 시점에 처리 가능한(online) provider만 기다리고, offline provider는 기다리지 않는다.
 */
export class AskQuery {
  constructor(
    private readonly submit: SubmitQuery,
    private readonly repo: QueryRepositoryPort,
    private readonly presence: PresencePort,
    private readonly defaultTimeoutSeconds = 60,
    private readonly maxTimeoutSeconds = 300,
    private readonly pollMs = 500,
  ) {}

  async execute(p: { question: string; providers?: string[] | null; timeoutSeconds?: number }): Promise<AskOutcome> {
    if (p.timeoutSeconds !== undefined && !(p.timeoutSeconds > 0)) {
      throw new InvalidRequest("timeout_seconds는 0보다 커야 합니다.");
    }
    const timeout = Math.min(p.timeoutSeconds ?? this.defaultTimeoutSeconds, this.maxTimeoutSeconds);

    const { query, results: created } = await this.submit.submit(p.question, p.providers, PRIORITY_HIGH);
    const queryId = query.id;
    const waitFor = new Set(created.filter((r) => this.presence.isProviderOnline(r.provider)).map((r) => r.id));
    const offline = created.filter((r) => !waitFor.has(r.id)).map((r) => r.provider);

    const deadline = Date.now() + timeout * 1000;
    let timedOut = false;
    let results = await this.repo.getResults(queryId);
    while (waitFor.size > 0 && !results.filter((r) => waitFor.has(r.id)).every(isTerminal)) {
      if (Date.now() >= deadline) {
        timedOut = true;
        break;
      }
      await sleep(Math.min(this.pollMs, Math.max(deadline - Date.now(), 0)));
      results = await this.repo.getResults(queryId);
    }

    const notes: string[] = [];
    if (offline.length > 0) {
      notes.push(`확장이 연결되어 있지 않거나 처리할 수 없는 provider: ${offline.join(", ")}.`);
    }
    if (timedOut) notes.push("일부 provider가 시간 내 완료되지 않았습니다.");
    const note = notes.length > 0 ? `${notes.join(" ")} GET /queries/${queryId} 으로 계속 조회하세요.` : undefined;
    return { queryId, results, note };
  }
}
