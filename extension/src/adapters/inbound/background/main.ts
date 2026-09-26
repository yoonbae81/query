import { ExtensionService } from "../../../application/extensionService";
import type { StatusSnapshot } from "../../../domain/model";
import { ChromeSiteAutomation } from "../../outbound/browser/chromeSiteAutomation";
import { ChromeStorageSettings } from "../../outbound/browser/chromeStorageSettings";
import { ChromeTabController } from "../../outbound/browser/chromeTabController";
import { testConnection, WebSocketServerGateway } from "../../outbound/gateway/webSocketServerGateway";
import { PROVIDERS } from "../../outbound/providers/registry";
import type { StatusBroadcast, UiReply, UiRequest } from "../uiProtocol";

/** 서비스 워커 진입점(조립 지점). MV3 서비스 워커는 언제든 재시작되므로 시작할 때마다 저장된 상태를 복원한다. */
const service = new ExtensionService({
  registry: PROVIDERS,
  gateway: new WebSocketServerGateway(),
  tabs: new ChromeTabController(),
  site: new ChromeSiteAutomation(),
  store: new ChromeStorageSettings(),
  clock: { now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) },
  version: chrome.runtime.getManifest().version,
});
const ready = service.init();

function updateBadge(s: StatusSnapshot): void {
  const text = !s.active ? "" : s.connection === "connected" ? "ON" : "…";
  const color = s.connection === "connected" ? "#15803d" : "#b45309";
  void chrome.action.setBadgeText({ text });
  void chrome.action.setBadgeBackgroundColor({ color });
}

service.status.subscribe((status) => {
  updateBadge(status);
  const message: StatusBroadcast = { kind: "status", status };
  chrome.runtime.sendMessage(message).catch(() => {
    /* 열린 팝업이 없으면 수신자가 없다 */
  });
});

async function handle(request: UiRequest): Promise<unknown> {
  switch (request.op) {
    case "getStatus":
      return service.getStatus();
    case "setActive":
      await service.setActive(request.active);
      return service.getStatus();
    case "getSettings":
      return service.getSettings();
    case "saveSettings":
      return service.saveSettings(request.settings);
    case "testConnection":
      return testConnection(request.settings);
    case "focusTab": {
      const tab = await chrome.tabs.update(request.tabId, { active: true });
      if (tab?.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
      return null;
    }
    case "openProviderTab": {
      const provider = PROVIDERS.find((p) => p.id === request.provider);
      if (!provider) throw new Error(`지원하지 않는 provider: ${request.provider}`);
      const existing = (await chrome.tabs.query({ url: provider.matches })).find((t) => t.id !== undefined);
      if (existing?.id !== undefined) {
        // 탭은 있는데 확장과 통신이 안 되는 경우(확장을 다시 로드하기 전에 열린 탭 등): 새로고침해서 콘텐츠 스크립트를 다시 주입한다
        await chrome.tabs.reload(existing.id);
        await chrome.tabs.update(existing.id, { active: true });
        if (existing.windowId !== undefined) await chrome.windows.update(existing.windowId, { focused: true });
      } else {
        await chrome.tabs.create({ url: provider.newThreadUrl });
      }
      return null;
    }
    case "openWebUi": {
      const { serverUrl } = service.getSettings();
      if (!serverUrl) throw new Error("서버 주소가 설정되지 않았습니다.");
      await chrome.tabs.create({ url: serverUrl });
      return null;
    }
  }
}

chrome.runtime.onMessage.addListener((message: UiRequest, _sender, sendResponse: (reply: UiReply) => void) => {
  if (message?.kind !== "ui") return;
  (async () => {
    try {
      await ready;
      sendResponse({ ok: true, value: await handle(message) });
    } catch (e) {
      sendResponse({ ok: false, message: e instanceof Error ? e.message : String(e) });
    }
  })();
  return true;
});

// 서비스 워커를 깨우고 끊긴 연결을 복구하는 주기 점검 (최소 30초)
chrome.alarms.create("tick", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "tick") void ready.then(() => service.tick());
});
