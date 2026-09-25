import type { ExtensionStatus, ProviderInfo, QueryDetail, QueryPage } from "./types";

/** index.html의 <base href>(서버가 basePath로 치환)를 기준으로 URL을 만든다. */
export function apiUrl(path: string): string {
  return new URL(`api/v1${path}`, document.baseURI).toString();
}

export class ApiError extends Error {}

async function request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(apiUrl(path), {
    method: init.method ?? "GET",
    headers: init.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* 본문 없음 */
  }
  if (!res.ok) {
    const message = (data as { error?: { message?: string } } | null)?.error?.message;
    throw new ApiError(message ?? `요청 실패 (${res.status})`);
  }
  return data as T;
}

export const api = {
  providers: () => request<{ providers: ProviderInfo[] }>("/providers").then((r) => r.providers),
  extensionStatus: () => request<ExtensionStatus>("/extension/status"),
  systemPrompt: () => request<{ content: string }>("/config/system-prompt").then((r) => r.content),
  saveSystemPrompt: (content: string) => request("/config/system-prompt", { method: "PUT", body: { content } }),
  submit: (query: string, providers: string[]) =>
    request<{ query_id: string }>("/queries", { method: "POST", body: { query, providers } }),
  submitBulk: (queries: string[], providers: string[]) =>
    request<{ items: unknown[] }>("/queries/bulk", { method: "POST", body: { queries, providers } }),
  listQueries: (limit: number, cursor?: string | null) =>
    request<QueryPage>(`/queries?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`),
  getQuery: (id: string) => request<QueryDetail>(`/queries/${encodeURIComponent(id)}`),
  addProvider: (id: string, provider: string) =>
    request<{ results: { result_id: string; provider: string; status: string }[] }>(
      `/queries/${encodeURIComponent(id)}/providers`,
      { method: "POST", body: { providers: [provider] } },
    ),
  retry: (id: string, resultId: string) =>
    request(`/queries/${encodeURIComponent(id)}/results/${encodeURIComponent(resultId)}/retry`, { method: "POST" }),
};
