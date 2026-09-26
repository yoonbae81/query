import type {
  CategoryInfo,
  ExtensionStatus,
  ListParams,
  Prompt,
  ProviderInfo,
  QueryDetail,
  QueryPage,
  Stats,
} from "./types";

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
    /* 본문 없음 (204 등) */
  }
  if (!res.ok) {
    const message = (data as { error?: { message?: string } } | null)?.error?.message;
    throw new ApiError(message ?? `요청 실패 (${res.status})`);
  }
  return data as T;
}

const enc = encodeURIComponent;

export const api = {
  providers: () => request<{ providers: ProviderInfo[] }>("/providers").then((r) => r.providers),
  extensionStatus: () => request<ExtensionStatus>("/extension/status"),
  stats: () => request<Stats>("/stats"),
  categories: () => request<{ categories: CategoryInfo[] }>("/categories").then((r) => r.categories),

  getPrompt: (category: string) => request<Prompt>(`/prompts/${enc(category)}`),
  savePrompt: (category: string, content: string) =>
    request<Prompt>(`/prompts/${enc(category)}`, { method: "PUT", body: { content } }),
  deletePrompt: (category: string) => request<null>(`/prompts/${enc(category)}`, { method: "DELETE" }),

  submit: (query: string, providers: string[], category: string) =>
    request<{ query_id: string }>("/queries", { method: "POST", body: { query, providers, category } }),
  submitBulk: (queries: string[], providers: string[], category: string) =>
    request<{ items: { query_id: string }[] }>("/queries/bulk", { method: "POST", body: { queries, providers, category } }),

  listQueries: (p: ListParams) => {
    const q = new URLSearchParams({ limit: String(p.limit) });
    if (p.cursor) q.set("cursor", p.cursor);
    if (p.category) q.set("category", p.category);
    if (p.search?.trim()) q.set("search", p.search.trim());
    if (p.status) q.set("status", p.status);
    return request<QueryPage>(`/queries?${q}`);
  },
  getQuery: (id: string) => request<QueryDetail>(`/queries/${enc(id)}`),
  addProvider: (id: string, provider: string) =>
    request<{ results: { result_id: string; provider: string; status: string }[] }>(`/queries/${enc(id)}/providers`, {
      method: "POST",
      body: { providers: [provider] },
    }),
  retry: (id: string, resultId: string) =>
    request(`/queries/${enc(id)}/results/${enc(resultId)}/retry`, { method: "POST" }),
  /** 질문 전체(모든 provider 결과)를 삭제한다. 처리 중인 결과가 있으면 409 */
  deleteQuery: (id: string) => request<null>(`/queries/${enc(id)}`, { method: "DELETE" }),
  /** provider 결과 하나를 삭제한다. 마지막 결과였다면 query_deleted=true */
  deleteResult: (id: string, resultId: string) =>
    request<{ query_deleted: boolean }>(`/queries/${enc(id)}/results/${enc(resultId)}`, { method: "DELETE" }),
  /** 저장된 질문/답변 마크다운 파일 내려받기 링크 */
  downloadUrl: (id: string, resultId: string) => apiUrl(`/queries/${enc(id)}/results/${enc(resultId)}/download`),
};
