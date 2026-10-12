import type { PersistedState } from "../../../domain/model";
import type { SessionStorePort } from "../../../domain/ports";

/** chrome.storage.session 기반 상태 저장소. 서비스 워커 재시작을 넘겨 유지된다(브라우저 세션 한정). */
export class ChromeSessionStore implements SessionStorePort {
  private static readonly KEY = "persisted";

  async load(): Promise<PersistedState | null> {
    const stored = await chrome.storage.session.get(ChromeSessionStore.KEY);
    return (stored[ChromeSessionStore.KEY] as PersistedState | undefined) ?? null;
  }

  async save(state: PersistedState): Promise<void> {
    await chrome.storage.session.set({ [ChromeSessionStore.KEY]: state });
  }
}
