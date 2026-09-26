import type { ProviderDescriptor, ProviderStatus } from "../domain/model";
import type { ServerGatewayPort, SiteAutomationPort, TabControllerPort } from "../domain/ports";
import type { StatusStore } from "./statusStore";

export interface ReporterDeps {
  registry: readonly ProviderDescriptor[];
  tabs: TabControllerPort;
  site: SiteAutomationPort;
  gateway: ServerGatewayPort;
  status: StatusStore;
  clientId: () => Promise<string>;
  version: string;
  /** 작업 처리 중인 provider의 탭은 이동 중일 수 있으므로 상태를 건드리지 않는다 */
  busyProviders: () => ReadonlySet<string>;
}

/** 지원 사이트별 탭/로그인 상태를 감지해 서버에 알린다 (PLAN2 §4.2 hello/state). */
export class ReportProviderStates {
  private lastSent = "";

  constructor(private readonly d: ReporterDeps) {}

  private async detect(): Promise<ProviderStatus[]> {
    const busy = this.d.busyProviders();
    const previous = new Map(this.d.status.get().providers.map((p) => [p.id, p]));
    const out: ProviderStatus[] = [];
    for (const desc of this.d.registry) {
      const prev = previous.get(desc.id);
      if (busy.has(desc.id) && prev) {
        out.push(prev);
        continue;
      }
      const tab = await this.d.tabs.findTab(desc).catch(() => null);
      if (!tab) {
        out.push({ id: desc.id, name: desc.name, state: "no_tab" });
        continue;
      }
      try {
        const loggedIn = await this.d.site.isLoggedIn(tab, desc);
        out.push({ id: desc.id, name: desc.name, state: loggedIn ? "ready" : "login_required", tabId: tab.id });
      } catch (e) {
        // 페이지가 로딩 중이거나 콘텐츠 스크립트에 닿지 않는 경우 — 다음 갱신에서 다시 확인한다
        out.push({
          id: desc.id,
          name: desc.name,
          state: "no_tab",
          tabId: tab.id,
          detail: e instanceof Error ? e.message : String(e),
        });
      }
    }
    return out;
  }

  private entries(providers: ProviderStatus[]) {
    return providers.map((p) => ({ id: p.id, state: p.state }));
  }

  /** 연결이 수립되면 hello로 현재 상태를 통지한다 */
  async sendHello(): Promise<void> {
    const providers = await this.detect();
    this.d.status.update({ providers });
    this.lastSent = JSON.stringify(this.entries(providers));
    this.d.gateway.send({
      type: "hello",
      client_id: await this.d.clientId(),
      version: this.d.version,
      providers: this.entries(providers),
    });
  }

  /** 상태를 다시 감지하고 바뀐 경우에만 state 메시지를 보낸다 */
  async refresh(): Promise<void> {
    const providers = await this.detect();
    this.d.status.update({ providers });
    const serialized = JSON.stringify(this.entries(providers));
    if (serialized === this.lastSent) return;
    if (this.d.gateway.send({ type: "state", providers: this.entries(providers) })) this.lastSent = serialized;
  }

  /** 서버가 이미 알고 있는 상태를 무효화한다(재연결 시) */
  reset(): void {
    this.lastSent = "";
  }
}
