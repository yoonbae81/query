import type { ExtensionSettings, ProviderDescriptor, StatusSnapshot } from "../domain/model";
import type {
  ClockPort,
  ServerGatewayPort,
  SettingsStorePort,
  SiteAutomationPort,
  TabControllerPort,
} from "../domain/ports";
import { ReportProviderStates } from "./reportProviderStates";
import { RunJobLoop } from "./runJobLoop";
import { StatusStore } from "./statusStore";
import { normalizeSettings } from "./updateSettings";

export interface ExtensionServiceDeps {
  registry: readonly ProviderDescriptor[];
  gateway: ServerGatewayPort;
  tabs: TabControllerPort;
  site: SiteAutomationPort;
  store: SettingsStorePort;
  clock: ClockPort;
  version: string;
}

/** 확장 코어의 진입점: 토글, 설정, 탭 변화, 주기 점검을 유스케이스로 연결한다. */
export class ExtensionService {
  readonly status = new StatusStore();
  private readonly reporter: ReportProviderStates;
  private readonly loop: RunJobLoop;
  private settings!: ExtensionSettings;

  constructor(private readonly d: ExtensionServiceDeps) {
    this.reporter = new ReportProviderStates({
      registry: d.registry,
      tabs: d.tabs,
      site: d.site,
      gateway: d.gateway,
      status: this.status,
      clientId: () => d.store.loadClientId(),
      version: d.version,
      busyProviders: () => this.loop.busyProviders,
    });
    this.loop = new RunJobLoop({
      registry: d.registry,
      gateway: d.gateway,
      tabs: d.tabs,
      site: d.site,
      status: this.status,
      reporter: this.reporter,
      clock: d.clock,
      settings: () => this.settings,
    });

    d.gateway.onMessage((m) => this.loop.handleMessage(m));
    d.gateway.onStatusChange((connection) => {
      // 연결에 성공하면 이전 연결 오류(서버 주소 미설정 등)는 더 이상 유효하지 않다
      this.status.update(connection === "connected" ? { connection, lastError: null } : { connection });
      if (connection !== "connected") this.reporter.reset();
    });
    d.gateway.onOpen(() => {
      void this.reporter.sendHello().then(() => this.loop.startRound());
    });
    d.tabs.onTabsChanged(() => void this.onTabsChanged());
  }

  /** 서비스 워커가 (재)시작될 때 저장된 상태를 복원한다 */
  async init(): Promise<void> {
    this.settings = await this.d.store.loadSettings();
    const active = await this.d.store.loadActive();
    this.status.update({ active });
    if (active) this.connectIfConfigured();
  }

  private connectIfConfigured(): void {
    if (!this.settings.serverUrl) {
      this.status.update({ lastError: "서버 주소가 설정되지 않았습니다." });
      return;
    }
    this.d.gateway.connect(this.settings);
  }

  getStatus(): StatusSnapshot {
    return this.status.get();
  }

  getSettings(): ExtensionSettings {
    return { ...this.settings };
  }

  /** ON/OFF 토글: ON일 때만 서버에 연결해 작업을 가져간다 (PLAN2 §6.2) */
  async setActive(active: boolean): Promise<void> {
    await this.d.store.saveActive(active);
    this.status.update({ active, lastError: null });
    if (active) this.connectIfConfigured();
    else this.d.gateway.disconnect();
  }

  async saveSettings(input: ExtensionSettings): Promise<ExtensionSettings> {
    const next = normalizeSettings(input);
    await this.d.store.saveSettings(next);
    this.settings = next;
    this.status.update({ lastError: null }); // 설정을 고쳤으니 이전 오류는 지우고 다시 시도한다
    if (this.status.get().active) {
      this.d.gateway.disconnect();
      this.connectIfConfigured();
    }
    return { ...next };
  }

  /** 탭 열림/닫힘/이동 시 provider 상태를 다시 감지한다 */
  async onTabsChanged(): Promise<void> {
    if (this.status.get().connection !== "connected") return;
    await this.reporter.refresh().catch(() => {});
    void this.loop.startRound();
  }

  /** 주기 점검(alarm): 상태 재감지와 claim 재시도 */
  async tick(): Promise<void> {
    if (!this.status.get().active) return;
    if (this.status.get().connection !== "connected") {
      this.connectIfConfigured();
      return;
    }
    await this.reporter.refresh().catch(() => {});
    void this.loop.startRound();
  }
}
