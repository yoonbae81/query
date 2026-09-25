/** 서비스 워커 ↔ 콘텐츠 스크립트 메시지 (chrome.tabs.sendMessage) */

export type SiteMethod = "isLoggedIn" | "submit" | "waitForCompletion" | "extract";

export interface SiteRequest {
  kind: "site-call";
  provider: string;
  method: SiteMethod;
  args: unknown[];
}

export interface SitePing {
  kind: "site-ping";
  provider: string;
}

export type SiteReply<T = unknown> = { ok: true; value: T } | { ok: false; code: string; message: string };

export const SITE_METHODS: readonly SiteMethod[] = ["isLoggedIn", "submit", "waitForCompletion", "extract"];
