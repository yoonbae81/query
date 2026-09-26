import { getToken, setToken } from "./auth";
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

/** 인증 헤더를 붙여 호출한다. 401이면 API 토큰을 물어 저장한 뒤 한 번 다시 시도한다. */
async function authFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const send = () => {
    const token = getToken();
    const headers = new Headers(init.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return fetch(url, { ...init, headers });
  };
  let res = await send();
  if (res.status === 401) {
    const entered = typeof window.prompt === "function" ? window.prompt("서버 API 토큰을 입력하세요") : null;
    if (entered?.trim()) {
      setToken(entered.trim());
      res = await send();
      if (res.status === 401) setToken("");
    }
  }
  return res;
}

async function request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await authFetch(apiUrl(path), {
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

/** 저장된 마크다운 파일을 인증 헤더와 함께 받아 브라우저 다운로드로 저장한다(<a href>는 헤더를 못 붙인다). */
async function downloadFile(path: string): Promise<void> {
  const res = await authFetch(apiUrl(path));
  if (!res.ok) throw new ApiError(`다운로드 실패 (${res.status})`);
  const name = /filename*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(res.headers.get("Content-Disposition") ?? "")?.[1];
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = name ? decodeURIComponent(name) : "answer.md";
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * SSE 스트림을 fetch로 읽는다(EventSource는 인증 헤더를 못 붙인다). 서버가 스트림을 끝내면 정상 종료하고,
 * 연결 실패·비정상 종료는 예외로 알린다. signal로 중단한다.
 */
async function streamEvents(path: string, onEvent: (event: string, data: string) => void, signal: AbortSignal): Promise<void> {
  const res = await authFetch(apiUrl(path), { headers: { Accept: "text/event-stream" }, signal });
  if (!res.ok || !res.body) throw new ApiError(`스트림 연결 실패 (${res.status})`);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buf += value;
    let cut: number;
    while ((cut = buf.indexOf("\n\n")) >= 0) {
      const frame = buf.slice(0, cut);
      buf = buf.slice(cut + 2);
      let event = "message";
      const data: string[] = [];
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
      }
      if (data.length) onEvent(event, data.join("\n")); // ':' 로 시작하는 keepalive 주석은 건너뛴다
    }
  }
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
  /** 질문의 결과 변경을 실시간으로 받는다(SSE) */
  stream: (id: string, onEvent: (event: string, data: string) => void, signal: AbortSignal) =>
    streamEvents(`/queries/${enc(id)}/stream`, onEvent, signal),
  /** 저장된 질문/답변 마크다운 파일 내려받기 */
  download: (id: string, resultId: string) => downloadFile(`/queries/${enc(id)}/results/${enc(resultId)}/download`),
};
