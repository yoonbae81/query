import { DEFAULT_SETTINGS, type ExtensionSettings } from "../../../domain/model";
import type { SettingsStorePort } from "../../../domain/ports";

/** chrome.storage.local 기반 설정 저장소 */
export class ChromeStorageSettings implements SettingsStorePort {
  async loadSettings(): Promise<ExtensionSettings> {
    const { settings } = await chrome.storage.local.get("settings");
    return { ...DEFAULT_SETTINGS, ...(settings as Partial<ExtensionSettings> | undefined) };
  }

  async saveSettings(settings: ExtensionSettings): Promise<void> {
    await chrome.storage.local.set({ settings });
  }

  async loadActive(): Promise<boolean> {
    const { active } = await chrome.storage.local.get("active");
    return active === true;
  }

  async saveActive(active: boolean): Promise<void> {
    await chrome.storage.local.set({ active });
  }

  async loadClientId(): Promise<string> {
    const { clientId } = await chrome.storage.local.get("clientId");
    if (typeof clientId === "string" && clientId) return clientId;
    const created = crypto.randomUUID();
    await chrome.storage.local.set({ clientId: created });
    return created;
  }
}
