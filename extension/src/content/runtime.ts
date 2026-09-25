import { SiteError } from "../domain/model";
import type { SiteProviderPort } from "../domain/ports";
import { SITE_METHODS, type SitePing, type SiteReply, type SiteRequest } from "../adapters/outbound/providers/contentProtocol";

/**
 * 콘텐츠 스크립트 공통 런타임: 서비스 워커의 호출을 사이트 모듈(SiteProviderPort)에 연결한다.
 * 같은 탭에 중복 주입돼도 리스너가 한 번만 등록되도록 전역 플래그를 둔다.
 */
export function runSiteProvider(providerId: string, site: SiteProviderPort): void {
  const flag = `__query_site_${providerId}`;
  const g = globalThis as Record<string, unknown>;
  if (g[flag]) return;
  g[flag] = true;

  chrome.runtime.onMessage.addListener((message: SiteRequest | SitePing, _sender, sendResponse: (r: SiteReply | { ok: true }) => void) => {
    if (message?.kind === "site-ping" && message.provider === providerId) {
      sendResponse({ ok: true });
      return;
    }
    if (message?.kind !== "site-call" || message.provider !== providerId) return;
    if (!SITE_METHODS.includes(message.method)) {
      sendResponse({ ok: false, code: "retryable", message: `알 수 없는 메서드: ${message.method}` });
      return;
    }
    (async () => {
      try {
        const fn = site[message.method] as (...args: unknown[]) => Promise<unknown>;
        sendResponse({ ok: true, value: await fn.apply(site, message.args) });
      } catch (e) {
        sendResponse({
          ok: false,
          code: e instanceof SiteError ? e.code : "retryable",
          message: e instanceof Error ? e.message : String(e),
        });
      }
    })();
    return true; // 비동기 응답
  });
}
