import { createElement, ExternalLink, LoaderCircle, Settings } from "lucide";

import type { ConnectionStatus, ProviderState, ProviderStatus, StatusSnapshot } from "../../../domain/model";
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

// 팝업은 상태 갱신마다 다시 그려지므로 오류 문구는 따로 보관해 다시 그릴 때도 유지한다
let uiError = "";
let lastStatus: StatusSnapshot | null = null;

async function toggle(active: boolean): Promise<void> {
  try {
    uiError = "";
    render(await requestUi<StatusSnapshot>({ kind: "ui", op: "setActive", active }));
  } catch (e) {
    alertError(e);
  }
}

function alertError(e: unknown): void {
  uiError = e instanceof Error ? e.message : String(e);
  if (lastStatus) render(lastStatus);
}

/** provider 한 줄: 이름, 상태 뱃지, 탭 이동 버튼, (탭과 통신이 안 될 때) 이유 */
function providerRow(p: ProviderStatus): HTMLElement {
  const open = () => void requestUi({ kind: "ui", op: "openProviderTab", provider: p.id }).catch(alertError);
  const focus = () => void requestUi({ kind: "ui", op: "focusTab", tabId: p.tabId! }).catch(alertError);

  // 탭이 없거나 탭과 통신이 안 되면 상태 뱃지가 곧 "열기" 버튼이다.
  // 탭이 없으면 새 탭으로 열고, 탭이 있으면 새로고침해서 콘텐츠 스크립트를 다시 주입한다.
  const badge =
    p.state === "no_tab"
      ? h("button", { class: "badge clickable st-pending", onclick: open }, p.tabId === undefined ? STATE_LABEL.no_tab : "탭 응답 없음", icon(ExternalLink))
      : h("span", { class: `badge ${p.state === "ready" ? "st-done" : "st-pending"}` }, STATE_LABEL[p.state]);

  return h(
    "li",
    {},
    h(
      "div",
      { class: "row between" },
      h("span", {}, p.name),
      h("span", { class: "row" }, badge, p.tabId !== undefined ? h("button", { class: "btn small", onclick: focus }, "탭으로 이동") : null),
    ),
    p.detail ? h("div", { class: "detail" }, p.detail) : null,
  );
}

function render(s: StatusSnapshot): void {
  lastStatus = s;
  const root = document.getElementById("root")!;
  const toggleInput = h("input", { type: "checkbox", role: "switch", "aria-label": "사용", onchange: (e) => void toggle((e.target as HTMLInputElement).checked) });
  toggleInput.checked = s.active;

  const children: (Node | null)[] = [
    h(
      "div",
      { class: "row between" },
      h("span", { class: "row" }, h("strong", {}, "Query"), h("span", { class: `badge ${s.connection === "connected" ? "st-done" : "st-pending"}` }, CONNECTION_LABEL[s.connection])),
      h("label", { class: "switch" }, toggleInput, h("span", { class: "slider" })),
    ),
    h("ul", { class: "providers" }, ...s.providers.map(providerRow)),
    s.currentJob
      ? h("div", { class: "row job" }, icon(LoaderCircle, "spin"), `${s.currentJob.provider}: ${s.currentJob.message}`)
      : null,
    s.lastError ? h("div", { class: "error" }, s.lastError) : null,
    uiError ? h("div", { class: "error" }, uiError) : null,
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
