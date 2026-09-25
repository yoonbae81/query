import type { ExtensionSettings } from "../../../domain/model";
import { requestUi } from "../uiProtocol";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function readForm(): ExtensionSettings {
  return {
    serverUrl: $<HTMLInputElement>("serverUrl").value,
    authToken: $<HTMLInputElement>("authToken").value,
    minIntervalSeconds: Number($<HTMLInputElement>("minInterval").value),
  };
}

function show(message: string, isError = false): void {
  const el = $("result");
  el.textContent = message;
  el.className = isError ? "error" : "ok";
}

async function load(): Promise<void> {
  const s = await requestUi<ExtensionSettings>({ kind: "ui", op: "getSettings" });
  $<HTMLInputElement>("serverUrl").value = s.serverUrl;
  $<HTMLInputElement>("authToken").value = s.authToken;
  $<HTMLInputElement>("minInterval").value = String(s.minIntervalSeconds);
}

$("save").addEventListener("click", async () => {
  try {
    const saved = await requestUi<ExtensionSettings>({ kind: "ui", op: "saveSettings", settings: readForm() });
    $<HTMLInputElement>("serverUrl").value = saved.serverUrl;
    show("저장되었습니다");
  } catch (e) {
    show(e instanceof Error ? e.message : String(e), true);
  }
});

$("test").addEventListener("click", async () => {
  show("확인 중…");
  try {
    const r = await requestUi<{ ok: boolean; message: string }>({ kind: "ui", op: "testConnection", settings: readForm() });
    show(r.message, !r.ok);
  } catch (e) {
    show(e instanceof Error ? e.message : String(e), true);
  }
});

load().catch((e: unknown) => show(e instanceof Error ? e.message : String(e), true));
