import type { ProviderDescriptor, TabRef } from "../../../domain/model";
import type { TabControllerPort } from "../../../domain/ports";

const LOAD_TIMEOUT_MS = 30_000;
const CHANGE_DEBOUNCE_MS = 500;

/** chrome.tabs 기반 탭 탐색/이동 (이미 열려 있는 탭을 사용) */
export class ChromeTabController implements TabControllerPort {
  private handler: () => void = () => {};
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    const changed = () => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.handler(), CHANGE_DEBOUNCE_MS);
    };
    chrome.tabs.onCreated.addListener(changed);
    chrome.tabs.onRemoved.addListener(changed);
    chrome.tabs.onActivated.addListener(changed);
    chrome.tabs.onUpdated.addListener((_id, info) => {
      if (info.url || info.status === "complete") changed();
    });
  }

  onTabsChanged(handler: () => void): void {
    this.handler = handler;
  }

  async findTab(provider: ProviderDescriptor): Promise<TabRef | null> {
    const tabs = (await chrome.tabs.query({ url: provider.matches })).filter((t) => t.id !== undefined);
    if (tabs.length === 0) return null;
    // 여러 개면 가장 최근에 활성화된 탭 (lastAccessed는 Chrome 121+, 없으면 활성 탭/큰 id 순)
    const best = tabs.reduce((a, b) => (score(b) > score(a) ? b : a));
    return { id: best.id!, url: best.url ?? "" };
  }

  async navigate(tab: TabRef, url: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      let started = false;
      const cleanup = () => {
        clearTimeout(timeout);
        clearTimeout(fallback);
        chrome.tabs.onUpdated.removeListener(listener);
      };
      const listener = (id: number, info: { status?: string }) => {
        if (id !== tab.id) return;
        if (info.status === "loading") started = true;
        if (info.status === "complete" && started) {
          cleanup();
          resolve();
        }
      };
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("페이지 로딩 시간 초과"));
      }, LOAD_TIMEOUT_MS);
      // loading 이벤트를 놓친 경우를 대비해 잠시 뒤 현재 상태를 직접 확인한다
      const fallback = setTimeout(async () => {
        const current = await chrome.tabs.get(tab.id).catch(() => null);
        if (!started && current?.status === "complete") {
          cleanup();
          resolve();
        }
      }, 3000);
      chrome.tabs.onUpdated.addListener(listener);
      chrome.tabs.update(tab.id, { url }).catch((e: unknown) => {
        cleanup();
        reject(e instanceof Error ? e : new Error(String(e)));
      });
    });
  }
}

function score(tab: chrome.tabs.Tab): number {
  const accessed = (tab as { lastAccessed?: number }).lastAccessed ?? 0;
  return accessed || (tab.active ? Number.MAX_SAFE_INTEGER / 2 : 0) + (tab.id ?? 0);
}
