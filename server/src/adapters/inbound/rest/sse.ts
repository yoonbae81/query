import type { QueryResult } from "../../../domain/entities";
import type { QueryRepositoryPort } from "../../../domain/ports";

export interface SseEvent {
  event: "result_update" | "result_added";
  data: Record<string, unknown>;
}

function payload(r: QueryResult): Record<string, unknown> {
  const data: Record<string, unknown> = {
    result_id: r.id,
    provider: r.provider,
    status: r.status,
    progress_message: r.progressMessage,
  };
  if (r.status === "done") Object.assign(data, { answer: r.answer, citations: r.citations });
  else if (r.status === "failed") data.error_message = r.errorMessage;
  return data;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
  });

/**
 * DB 폴링 → 변경분만 이벤트로 내보내는 브릿지.
 * 첫 폴링은 현재 스냅샷을 result_update로, 이후 새로 생긴 결과는 result_added로 보낸다.
 * 자동 종료하지 않으며 idleTimeoutMs가 지나거나 signal이 abort되면 끝난다.
 */
export async function* streamEvents(
  repo: QueryRepositoryPort,
  queryId: string,
  opts: { intervalMs?: number; idleTimeoutMs?: number; signal?: AbortSignal } = {},
): AsyncGenerator<SseEvent> {
  const { intervalMs = 1000, idleTimeoutMs = 30 * 60 * 1000, signal } = opts;
  const known = new Map<string, string>();
  const started = Date.now();
  let first = true;
  while (!signal?.aborted && Date.now() - started < idleTimeoutMs) {
    for (const r of await repo.getResults(queryId)) {
      const sig = `${r.status}|${r.progressMessage}|${r.updatedAt.getTime()}`;
      const prev = known.get(r.id);
      if (prev === undefined) yield { event: first ? "result_update" : "result_added", data: payload(r) };
      else if (prev !== sig) yield { event: "result_update", data: payload(r) };
      known.set(r.id, sig);
    }
    first = false;
    await sleep(intervalMs, signal);
  }
}
