import { SiteError, type Answer, type ErrorCode, type ProviderDescriptor, type TabRef } from "../../../domain/model";
import type { SiteAutomationPort } from "../../../domain/ports";
import type { SiteReply, SiteRequest } from "../providers/contentProtocol";

const PING_ATTEMPTS = 24;
const PING_INTERVAL_MS = 500;
const INJECT_AFTER_ATTEMPT = 3;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 서비스 워커 → 콘텐츠 스크립트 메시징 프록시 (SiteAutomationPort 구현) */
export class ChromeSiteAutomation implements SiteAutomationPort {
  isLoggedIn(tab: TabRef, provider: ProviderDescriptor): Promise<boolean> {
    return this.call<boolean>(tab, provider, "isLoggedIn", []);
  }
  submit(tab: TabRef, provider: ProviderDescriptor, prompt: string): Promise<void> {
    return this.call<void>(tab, provider, "submit", [prompt]);
  }
  waitForCompletion(tab: TabRef, provider: ProviderDescriptor): Promise<void> {
    return this.call<void>(tab, provider, "waitForCompletion", []);
  }
  extract(tab: TabRef, provider: ProviderDescriptor): Promise<Answer> {
    return this.call<Answer>(tab, provider, "extract", []);
  }

  private async call<T>(tab: TabRef, provider: ProviderDescriptor, method: SiteRequest["method"], args: unknown[]): Promise<T> {
    await this.ensureContentScript(tab, provider);
    const request: SiteRequest = { kind: "site-call", provider: provider.id, method, args };
    const reply = (await chrome.tabs.sendMessage(tab.id, request).catch((e: unknown) => {
      throw new SiteError("retryable", `콘텐츠 스크립트 호출 실패: ${e instanceof Error ? e.message : String(e)}`);
    })) as SiteReply<T> | undefined;
    if (!reply) throw new SiteError("retryable", "콘텐츠 스크립트가 응답하지 않았습니다.");
    if (!reply.ok) throw new SiteError(reply.code as ErrorCode, reply.message);
    return reply.value;
  }

  /** 페이지 로딩 직후에는 콘텐츠 스크립트가 아직 없을 수 있어 응답할 때까지 확인한다. 확장 설치 전에 열려 있던 탭은 직접 주입한다. */
  private async ensureContentScript(tab: TabRef, provider: ProviderDescriptor): Promise<void> {
    for (let attempt = 0; attempt < PING_ATTEMPTS; attempt++) {
      try {
        const reply = (await chrome.tabs.sendMessage(tab.id, { kind: "site-ping", provider: provider.id })) as { ok?: boolean } | undefined;
        if (reply?.ok) return;
      } catch {
        /* Receiving end does not exist — 아직 주입 전 */
      }
      if (attempt === INJECT_AFTER_ATTEMPT) {
        await chrome.scripting
          .executeScript({ target: { tabId: tab.id }, files: [`content/${provider.id}.js`] })
          .catch(() => {});
      }
      await sleep(PING_INTERVAL_MS);
    }
    throw new SiteError("retryable", `${provider.name} 페이지에서 콘텐츠 스크립트를 찾을 수 없습니다.`);
  }
}
