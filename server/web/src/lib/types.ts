export type Status = "pending" | "processing" | "done" | "failed";

export interface ProviderInfo {
  id: string;
  name: string;
  available: boolean;
  online: boolean;
}

export interface ResultSummary {
  provider: string;
  status: Status;
}

export interface QuerySummary {
  query_id: string;
  batch_id: string | null;
  category: string;
  query: string;
  created_at: string;
  /** 첫 완료 답변의 앞부분 (없으면 null) */
  answer_preview: string | null;
  results_summary: ResultSummary[];
}

export interface QueryPage {
  items: QuerySummary[];
  next_cursor: string | null;
}

export interface ResultDetail {
  result_id: string;
  provider: string;
  status: Status;
  answer: string | null;
  citations: string[] | null;
  answer_file_path?: string | null;
  progress_message: string | null;
  error_message: string | null;
  retry_count: number;
}

export interface QueryDetail {
  query_id: string;
  batch_id: string | null;
  category: string;
  query: string;
  created_at: string;
  results: ResultDetail[];
}

export type ProviderState = "ready" | "login_required" | "no_tab";

export interface ExtensionStatus {
  connected: boolean;
  clients: number;
  providers: { id: string; name: string; online: boolean; states: ProviderState[] }[];
}

export interface CategoryInfo {
  category: string;
  has_prompt: boolean;
  prompt_size: number;
  query_count: number;
}

export interface Stats {
  queries: number;
  results: Record<Status, number>;
}

export interface Prompt {
  category: string;
  content: string;
  updated_at: string;
}

export interface ListParams {
  limit: number;
  cursor?: string | null;
  category?: string | null;
  search?: string;
  status?: string;
}

/** SSE로 받는 결과 갱신 (PLAN §4.11) */
export interface ResultEvent {
  result_id: string;
  provider: string;
  status: Status;
  progress_message: string | null;
  answer?: string | null;
  citations?: string[] | null;
  error_message?: string | null;
}
