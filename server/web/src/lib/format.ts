import type { ProviderState } from "./types";

/** `2026-09-25T19:00:00+09:00` → `2026-09-25 19:00` (서버가 KST로 내려준 값을 그대로 자른다) */
export const fmtTime = (iso: string | null | undefined): string => (iso ? iso.slice(0, 16).replace("T", " ") : "");

const NAMES: Record<string, string> = { perplexity: "Perplexity", claude: "Claude", gemini: "Gemini", chatgpt: "ChatGPT" };
export const providerName = (id: string): string => NAMES[id] ?? id;

export const PROVIDER_STATE_LABEL: Record<ProviderState, string> = {
  ready: "준비됨",
  login_required: "로그인 필요",
  no_tab: "탭 없음",
};

/** 출처 링크는 http(s)만 허용한다 */
export const safeLinks = (urls: string[] | null | undefined): string[] => (urls ?? []).filter((u) => /^https?:\/\//i.test(u));
