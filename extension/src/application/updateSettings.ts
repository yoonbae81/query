import type { ExtensionSettings } from "../domain/model";

/** 설정 입력을 검증·정규화한다. 잘못된 값이면 사용자에게 보여줄 메시지로 Error를 던진다. */
export function normalizeSettings(input: ExtensionSettings): ExtensionSettings {
  const serverUrl = input.serverUrl.trim().replace(/\/+$/, "");
  if (serverUrl) {
    let url: URL;
    try {
      url = new URL(serverUrl);
    } catch {
      throw new Error("서버 주소 형식이 올바르지 않습니다.");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("서버 주소는 http:// 또는 https://로 시작해야 합니다.");
    }
  }
  const minIntervalSeconds = Number(input.minIntervalSeconds);
  if (!Number.isFinite(minIntervalSeconds) || minIntervalSeconds < 0 || minIntervalSeconds > 3600) {
    throw new Error("최소 질의 간격은 0~3600초여야 합니다.");
  }
  return { serverUrl, authToken: input.authToken.trim(), minIntervalSeconds };
}

/** http(s) 서버 주소를 확장 WebSocket 주소로 변환한다 */
export function toWebSocketUrl(settings: ExtensionSettings): string {
  const url = new URL(settings.serverUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/ext/ws`;
  if (settings.authToken) url.searchParams.set("token", settings.authToken);
  return url.toString();
}
