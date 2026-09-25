import { createElement, ExternalLink, LoaderCircle, Settings } from "lucide";

import type { ConnectionStatus, ProviderState, StatusSnapshot } from "../../../domain/model";
import { requestUi, type StatusBroadcast } from "../uiProtocol";

const CONNECTION_LABEL: Record<ConnectionStatus, string> = {
  connected: "연결됨",
  connecting: "연결 중",
  disconnected: "끊김",
};
const STATE_LABEL: Record<ProviderState, string> = {
  ready: "준비됨",
  login_required: "로그인 필요",
  no_tab: "탭 없음",
};

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | ((e: Event) => void)> = {},
  ...children: (Node | string | null)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === "function") el.addEventListener(k.replace(/^on/, ""), v);
    else if (typeof v === "boolean") el.toggleAttribute(k, v);
    else el.setAttribute(k, v);
  }
  el.append(...children.filter((c): c is Node | string => c !== null));
  return el;
}

const icon = (node: Parameters<typeof createElement>[0], cls = "") => {
  const svg = createElement(node, { width: 16, height: 16 });
  if (cls) svg.setAttribute("class", cls);
  return svg;
};

async function toggle(active: boolean): Promise<void> {
  try {
    render(await requestUi<StatusSnapshot>({ kind: "ui", op: "setActive", active }));
  } catch (e) {
    alertError(e);
  }
}

function alertError(e: unknown): void {
  const box = document.getElementById("error");
  if (box) box.textContent = e instanceof Error ? e.message : String(e);
}

function render(s: StatusSnapshot): void {
  const root = document.getElementById("root")!;
  const toggleInput = h("input", { type: "checkbox", role: "switch", "aria-label": "사용", onchange: (e) => void toggle((e.target as HTMLInputElement).checked) });
  toggleInput.checked = s.active;

  const children: (Node | null)[] = [
    h("div", { class: "row between" }, h("strong", {}, "Query"), h("label", { class: "switch" }, toggleInput, h("span", { class: "slider" }))),
    h("div", { class: "row" }, h("span", { class: `badge ${s.connection === "connected" ? "st-done" : "st-pending"}` }, CONNECTION_LABEL[s.connection])),
    h(
      "ul",
      { class: "providers" },
      ...s.providers.map((p) =>
        h(
          "li",
          { class: "row between" },
          h("span", {}, p.name),
          h("span", { class: "row" }, h("span", { class: `badge ${p.state === "ready" ? "st-done" : "st-pending"}` }, STATE_LABEL[p.state]), p.tabId !== undefined
            ? h("button", { class: "btn small", onclick: () => void requestUi({ kind: "ui", op: "focusTab", tabId: p.tabId! }).catch(alertError) }, "탭으로 이동")
            : null),
        ),
      ),
    ),
    s.currentJob
      ? h("div", { class: "row job" }, icon(LoaderCircle, "spin"), `${s.currentJob.provider}: ${s.currentJob.message}`)
      : null,
    s.lastError ? h("div", { class: "error" }, s.lastError) : null,
    h("div", { id: "error", class: "error" }),
    h(
      "div",
      { class: "row footer" },
      h("button", { class: "btn", onclick: () => void requestUi({ kind: "ui", op: "openWebUi" }).catch(alertError) }, icon(ExternalLink), "웹 UI 열기"),
      h("button", { class: "btn", onclick: () => void chrome.runtime.openOptionsPage() }, icon(Settings), "설정"),
    ),
  ];
  root.replaceChildren(...children.filter((c): c is Node => c !== null));
}

chrome.runtime.onMessage.addListener((message: StatusBroadcast) => {
  if (message?.kind === "status") render(message.status);
});

requestUi<StatusSnapshot>({ kind: "ui", op: "getStatus" }).then(render).catch(alertError);
