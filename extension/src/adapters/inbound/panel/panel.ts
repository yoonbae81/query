import { Check, Copy, createElement, ExternalLink, LoaderCircle, Settings } from "lucide";

import type { ConnectionStatus, LogEntry, ProviderState, ProviderStatus, StatusSnapshot } from "../../../domain/model";
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
const TABS = ["status", "providers", "logs"] as const;
type TabName = (typeof TABS)[number];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

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

const icon = (node: Parameters<typeof createElement>[0], size = 16) => createElement(node, { width: size, height: size });

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

let status: StatusSnapshot | null = null;
let logs: LogEntry[] = [];
/** 상태를 다시 그려도 사라지지 않게 패널 작업 실패 문구는 따로 보관한다 */
let uiError = "";
let activeTab: TabName = "status";

function formatTime(at: number): string {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function logText(): string {
  return logs.map((l) => `[${formatTime(l.at)}] ${l.category.padEnd(5)} ${l.message}`).join("\n");
}

function renderConnection(s: StatusSnapshot): void {
  const el = $("connection");
  el.textContent = CONNECTION_LABEL[s.connection];
  el.className = `badge ${s.connection === "connected" ? "st-done" : "st-pending"}`;
  $<HTMLInputElement>("active").checked = s.active;
}

function renderStatusPane(s: StatusSnapshot): void {
  const job = $("job");
  if (s.currentJob) {
    const spinner = icon(LoaderCircle);
    spinner.setAttribute("class", "spin");
    job.replaceChildren(spinner, document.createTextNode(` ${s.currentJob.provider}: ${s.currentJob.message}`));
    job.hidden = false;
  } else {
    job.hidden = true;
  }

  const error = $("error");
  const text = uiError || s.lastError;
  error.textContent = text ?? "";
  error.hidden = !text;

  const idle = $("idle");
  if (s.currentJob || text) {
    idle.hidden = true;
  } else {
    idle.hidden = false;
    idle.textContent = !s.active ? "확장이 꺼져 있습니다." : s.connection !== "connected" ? "서버 연결을 기다리는 중입니다." : "대기 중입니다.";
  }
}

function providerRow(p: ProviderStatus): HTMLElement {
  const open = () => void requestUi({ kind: "ui", op: "openProviderTab", provider: p.id }).catch(fail);
  const focus = () => void requestUi({ kind: "ui", op: "focusTab", tabId: p.tabId! }).catch(fail);

  // 탭이 없거나 통신이 안 되면 상태 뱃지가 곧 "열기" 버튼이다(있으면 새로고침하고 열고, 없으면 새 탭으로 연다)
  const badge =
    p.state === "no_tab"
      ? h("button", { class: "badge clickable st-pending", onclick: open }, p.tabId === undefined ? STATE_LABEL.no_tab : "탭 응답 없음", icon(ExternalLink, 12))
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

function renderProviders(s: StatusSnapshot): void {
  $("providers").replaceChildren(...s.providers.map(providerRow));
}

function renderLogs(): void {
  const pre = $("logs");
  pre.textContent = logs.length ? logText() : "기록된 로그가 없습니다.";
  $("log-count").textContent = logs.length ? `${logs.length}건` : "";
}

function render(s: StatusSnapshot): void {
  status = s;
  renderConnection(s);
  renderStatusPane(s);
  renderProviders(s);
}

function fail(e: unknown): void {
  uiError = message(e);
  if (status) render(status);
}

function selectTab(name: TabName): void {
  activeTab = name;
  for (const t of TABS) {
    $(`tab-${t}`).setAttribute("aria-selected", String(t === name));
    $(`pane-${t}`).hidden = t !== name;
  }
  if (name === "logs") void refreshLogs();
}

async function refreshLogs(): Promise<void> {
  try {
    logs = await requestUi<LogEntry[]>({ kind: "ui", op: "getLogs" });
  } catch {
    /* 로그 조회 실패는 상태 표시를 막지 않는다 */
  }
  renderLogs();
}

const toggle = async (active: boolean): Promise<void> => {
  try {
    uiError = "";
    render(await requestUi<StatusSnapshot>({ kind: "ui", op: "setActive", active }));
  } catch (e) {
    fail(e);
  }
};

$("active").addEventListener("change", (e) => void toggle((e.target as HTMLInputElement).checked));
$("open-web").addEventListener("click", () => void requestUi({ kind: "ui", op: "openWebUi" }).catch(fail));
$("open-settings").addEventListener("click", () => void chrome.runtime.openOptionsPage());
for (const t of TABS) $(`tab-${t}`).addEventListener("click", () => selectTab(t));

$("clear-logs").addEventListener("click", () => {
  void (async () => {
    try {
      await requestUi({ kind: "ui", op: "clearLogs" });
      logs = [];
      renderLogs();
    } catch (e) {
      fail(e);
    }
  })();
});

$("copy-logs").addEventListener("click", () => {
  const button = $("copy-logs");
  void (async () => {
    try {
      await navigator.clipboard.writeText(logText());
      button.replaceChildren(icon(Check, 14), document.createTextNode(" 복사됨"));
      setTimeout(() => button.replaceChildren(icon(Copy, 14), document.createTextNode(" 복사")), 1500);
    } catch {
      fail(new Error("복사할 수 없습니다."));
    }
  })();
});

chrome.runtime.onMessage.addListener((msg: StatusBroadcast) => {
  if (msg?.kind !== "status") return;
  render(msg.status);
  if (activeTab === "logs") void refreshLogs();
});

selectTab(activeTab);
requestUi<StatusSnapshot>({ kind: "ui", op: "getStatus" })
  .then((s) => {
    render(s);
    return refreshLogs();
  })
  .catch(fail);
