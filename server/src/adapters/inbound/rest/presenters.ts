import type { AskOutcome } from "../../../application/askQuery";
import { PROVIDER_NAMES, type Container } from "../../../container";
import type { Query, QueryResult } from "../../../domain/entities";
import { formatIso } from "../../../util/time";

export const fmt = (d: Date | null, tz: string): string | null => (d ? formatIso(d, tz) : null);

const PREVIEW_CHARS = 160;

function preview(results: QueryResult[]): string | null {
  const done = results.find((r) => r.status === "done" && r.answer);
  if (!done?.answer) return null;
  const flat = done.answer
    .replace(/\[\d+\]/g, "") // 인용 번호 [1]
    .replace(/(^|\n)\s*\d+\.\s/g, " ") // 번호 목록 표시
    .replace(/[#*`>_\[\]-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS)}…` : flat;
}

export function resultCreated(r: QueryResult) {
  return { result_id: r.id, provider: r.provider, status: r.status };
}

export function resultDetail(r: QueryResult, tz: string) {
  return {
    result_id: r.id,
    provider: r.provider,
    status: r.status,
    answer: r.answer,
    citations: r.citations,
    answer_file_path: r.answerFilePath,
    system_prompt_snapshot: r.systemPromptSnapshot,
    progress_message: r.progressMessage,
    error_message: r.errorMessage,
    retry_count: r.retryCount,
    updated_at: fmt(r.updatedAt, tz),
  };
}

export function resultAsk(r: QueryResult) {
  const data: Record<string, unknown> = {
    provider: r.provider,
    status: r.status,
    answer: r.answer,
    citations: r.citations,
  };
  if (r.status === "failed" && r.errorMessage) data.error_message = r.errorMessage;
  return data;
}

export function queryDetail(q: Query, results: QueryResult[], tz: string) {
  return {
    query_id: q.id,
    batch_id: q.batchId,
    category: q.category,
    query: q.queryText,
    created_at: fmt(q.createdAt, tz),
    results: results.map((r) => resultDetail(r, tz)),
  };
}

export function querySummary(q: Query, results: QueryResult[], tz: string) {
  return {
    query_id: q.id,
    batch_id: q.batchId,
    category: q.category,
    query: q.queryText,
    created_at: fmt(q.createdAt, tz),
    /** 목록에서 답변을 미리 볼 수 있도록 첫 완료 답변의 앞부분을 준다 */
    answer_preview: preview(results),
    results_summary: results.map((r) => ({ provider: r.provider, status: r.status })),
  };
}

/** POST /ask, MCP query_ask 공통 응답 (PLAN §4.6) */
export function askPayload(out: AskOutcome): Record<string, unknown> {
  const data: Record<string, unknown> = { query_id: out.queryId, results: out.results.map(resultAsk) };
  if (out.note) data.note = out.note;
  return data;
}

/** GET /providers, MCP query_providers 공통 응답 (PLAN2 §5.3) */
export function providersPayload(c: Container) {
  return {
    providers: Object.entries(PROVIDER_NAMES).map(([id, name]) => ({
      id,
      name,
      available: c.settings.supportedProviders.includes(id),
      online: c.presence.isProviderOnline(id),
    })),
  };
}
