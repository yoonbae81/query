import type { ClientMessage, ServerMessage } from "../../protocol";
import { ExtensionService } from "../src/application/extensionService";
import {
  DEFAULT_SETTINGS,
  SiteError,
  type Answer,
  type ConnectionStatus,
  type ExtensionSettings,
  type ProviderDescriptor,
  type TabRef,
} from "../src/domain/model";
import type {
  ClockPort,
  ServerGatewayPort,
  SettingsStorePort,
  SiteAutomationPort,
  TabControllerPort,
} from "../src/domain/ports";

export const PERPLEXITY: ProviderDescriptor = {
  id: "perplexity",
  name: "Perplexity",
  matches: ["https://www.perplexity.ai/*"],
  newThreadUrl: "https://www.perplexity.ai/",
};
export const CLAUDE: ProviderDescriptor = {
  id: "claude",
  name: "Claude",
  matches: ["https://claude.ai/*"],
  newThreadUrl: "https://claude.ai/new",
};

export class FakeGateway implements ServerGatewayPort {
  sent: ClientMessage[] = [];
  connectedWith: ExtensionSettings | null = null;
  connectCalls = 0;
  disconnectCalls = 0;
  private messageHandler: (m: ServerMessage) => void = () => {};
  private statusHandler: (s: ConnectionStatus) => void = () => {};
  private openHandler: () => void = () => {};

  connect(settings: ExtensionSettings): void {
    this.connectCalls++;
    this.connectedWith = settings;
  }
  disconnect(): void {
    this.disconnectCalls++;
    this.connectedWith = null;
    this.statusHandler("disconnected");
  }
  send(message: ClientMessage): boolean {
    this.sent.push(message);
    return true;
  }
  onMessage(h: (m: ServerMessage) => void) {
    this.messageHandler = h;
  }
  onStatusChange(h: (s: ConnectionStatus) => void) {
    this.statusHandler = h;
  }
  onOpen(h: () => void) {
    this.openHandler = h;
  }

  /** 서버 쪽에서 연결이 수립된 것처럼 동작시킨다 */
  open(): void {
    this.statusHandler("connected");
    this.openHandler();
  }
  receive(m: ServerMessage): void {
    this.messageHandler(m);
  }
  ofType<T extends ClientMessage["type"]>(type: T): Extract<ClientMessage, { type: T }>[] {
    return this.sent.filter((m) => m.type === type) as Extract<ClientMessage, { type: T }>[];
  }
}

export class FakeTabs implements TabControllerPort {
  tabs = new Map<string, TabRef>();
  navigated: { tab: TabRef; url: string }[] = [];
  private handler: () => void = () => {};

  findTab(p: ProviderDescriptor): Promise<TabRef | null> {
    return Promise.resolve(this.tabs.get(p.id) ?? null);
  }
  navigate(tab: TabRef, url: string): Promise<void> {
    this.navigated.push({ tab, url });
    return Promise.resolve();
  }
  onTabsChanged(h: () => void) {
    this.handler = h;
  }
  fireChanged() {
    this.handler();
  }
}

export class FakeSite implements SiteAutomationPort {
  loggedIn = new Map<string, boolean>();
  calls: string[] = [];
  submitted: string[] = [];
  answer: Answer = { text: "ANS", citations: ["http://s"] };
  failAt: { step: "submit" | "wait" | "extract" | "isLoggedIn"; error: Error } | null = null;
  /** waitForCompletion을 수동으로 끝내고 싶을 때 */
  waitGate: Promise<void> | null = null;

  async isLoggedIn(_tab: TabRef, p: ProviderDescriptor): Promise<boolean> {
    this.calls.push("isLoggedIn");
    if (this.failAt?.step === "isLoggedIn") throw this.failAt.error;
    return this.loggedIn.get(p.id) ?? true;
  }
  async submit(_tab: TabRef, _p: ProviderDescriptor, prompt: string): Promise<void> {
    this.calls.push("submit");
    if (this.failAt?.step === "submit") throw this.failAt.error;
    this.submitted.push(prompt);
  }
  async waitForCompletion(): Promise<void> {
    this.calls.push("wait");
    if (this.failAt?.step === "wait") throw this.failAt.error;
    await this.waitGate;
  }
  async extract(): Promise<Answer> {
    this.calls.push("extract");
    if (this.failAt?.step === "extract") throw this.failAt.error;
    return this.answer;
  }
}

export class FakeClock implements ClockPort {
  time = 1_000_000;
  sleeps: number[] = [];
  now(): number {
    return this.time;
  }
  async sleep(ms: number): Promise<void> {
    this.sleeps.push(ms);
    this.time += ms;
  }
}

export class FakeStore implements SettingsStorePort {
  settings: ExtensionSettings = { ...DEFAULT_SETTINGS, serverUrl: "http://server:8000", minIntervalSeconds: 10 };
  active = false;
  async loadSettings() {
    return { ...this.settings };
  }
  async saveSettings(s: ExtensionSettings) {
    this.settings = { ...s };
  }
  async loadActive() {
    return this.active;
  }
  async saveActive(a: boolean) {
    this.active = a;
  }
  async loadClientId() {
    return "client-1";
  }
}

export interface Harness {
  service: ExtensionService;
  gateway: FakeGateway;
  tabs: FakeTabs;
  site: FakeSite;
  clock: FakeClock;
  store: FakeStore;
}

export function makeHarness(opts: { registry?: ProviderDescriptor[]; active?: boolean } = {}): Harness {
  const gateway = new FakeGateway();
  const tabs = new FakeTabs();
  const site = new FakeSite();
  const clock = new FakeClock();
  const store = new FakeStore();
  store.active = opts.active ?? false;
  const service = new ExtensionService({
    registry: opts.registry ?? [PERPLEXITY],
    gateway,
    tabs,
    site,
    store,
    clock,
    version: "test",
  });
  return { service, gateway, tabs, site, clock, store };
}

/** 비동기 후속 처리(void 프로미스)가 끝날 때까지 기다린다 */
export async function settle(times = 20): Promise<void> {
  for (let i = 0; i < times; i++) await new Promise((r) => setImmediate(r));
}

export { SiteError };
