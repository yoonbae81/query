import type { ExtensionSettings, StatusSnapshot } from "../../domain/model";

/** 팝업/설정 페이지 → 서비스 워커 요청 (chrome.runtime.sendMessage) */
export type UiRequest =
  | { kind: "ui"; op: "getStatus" }
  | { kind: "ui"; op: "setActive"; active: boolean }
  | { kind: "ui"; op: "getSettings" }
  | { kind: "ui"; op: "saveSettings"; settings: ExtensionSettings }
  | { kind: "ui"; op: "testConnection"; settings: ExtensionSettings }
  | { kind: "ui"; op: "focusTab"; tabId: number }
  | { kind: "ui"; op: "openProviderTab"; provider: string }
  | { kind: "ui"; op: "openWebUi" };

export type UiReply<T = unknown> = { ok: true; value: T } | { ok: false; message: string };

/** 서비스 워커 → 열려 있는 팝업으로 상태 변경 통지 */
export interface StatusBroadcast {
  kind: "status";
  status: StatusSnapshot;
}

/** UI 페이지에서 서비스 워커로 요청을 보내고 오류 응답이면 Error로 던진다 */
export async function requestUi<T>(request: UiRequest): Promise<T> {
  const reply = (await chrome.runtime.sendMessage(request)) as UiReply<T> | undefined;
  if (!reply) throw new Error("확장 서비스 워커가 응답하지 않습니다.");
  if (!reply.ok) throw new Error(reply.message);
  return reply.value;
}
