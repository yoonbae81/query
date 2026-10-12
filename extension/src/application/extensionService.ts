import type { ExtensionSettings, LogCategory, LogEntry, PersistedState, ProviderDescriptor, StatusSnapshot } from "../domain/model";
import type {
  ClockPort,
  ServerGatewayPort,
  SessionStorePort,
  SettingsStorePort,
  SiteAutomationPort,
  TabControllerPort,
} from "../domain/ports";
import { DiagnosticLog } from "./diagnosticLog";
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
  /** 서비스 워커 재시작을 넘겨 유지할 상태(휘발성) */
  session: SessionStorePort;
  clock: ClockPort;
  version: string;
}

/** 확장 코어의 진입점: 토글, 설정, 탭 변화, 주기 점검을 유스케이스로 연결한다. */
export class ExtensionService {
  readonly status = new StatusStore();
  private readonly logs: DiagnosticLog;
  private readonly reporter: ReportProviderStates;
  private readonly loop: RunJobLoop;
  private settings!: ExtensionSettings;

  constructor(private readonly d: ExtensionServiceDeps) {
    this.logs = new DiagnosticLog(() => d.clock.now());
    this.reporter = new ReportProviderStates({
      registry: d.registry,
      tabs: d.tabs,
      site: d.site,
      gateway: d.gateway,
      status: this.status,
      clientId: () => d.store.loadClientId(),
      version: d.version,
      busyProviders: () => this.loop.busyProviders,
      log: this.log,
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
      log: this.log,
    });

    // 상태가 바뀔 때마다 저장소에 미러링한다(서비스 워커가 종료돼도 마지막 상태가 남는다)
    this.status.subscribe(() => this.persist());

    d.gateway.onMessage((m) => this.loop.handleMessage(m));
    d.gateway.onStatusChange((connection) => {
      // 연결에 성공하면 이전 연결 오류(서버 주소 미설정 등)는 더 이상 유효하지 않다
      this.status.update(connection === "connected" ? { connection, lastError: null } : { connection });
      this.log("CONN", `연결 상태: ${connection}`);
      if (connection !== "connected") this.reporter.reset();
    });
    d.gateway.onOpen(() => {
      this.log("CONN", "서버 연결 수립");
      void this.reporter.sendHello().then(() => this.loop.startRound());
    });
    d.tabs.onTabsChanged(() => void this.onTabsChanged());
  }

  /** 진단 로그를 남기고 곧바로 저장소에 반영한다 */
  private log = (category: LogCategory, message: string): void => {
    this.logs.append(category, message);
    this.persist();
  };

  private persist(): void {
    const state: PersistedState = {
      status: this.status.get(),
      lastFinishedAt: this.loop.getLastFinishedAt(),
      inFlightJob: this.loop.getInFlightJob(),
      logs: this.logs.list(),
    };
    void this.d.session.save(state).catch(() => {});
  }

  /** 서비스 워커가 (재)시작될 때 저장된 상태를 복원한다 */
  async init(): Promise<void> {
    const persisted = await this.d.session.load();
    this.settings = await this.d.store.loadSettings();
    const active = await this.d.store.loadActive();

    if (persisted) {
      this.logs.restore(persisted.logs);
      // 처리 중이던 작업은 재개할 수 없다. 지우고 유실을 남긴다(복구는 서버 임대 회수가 맡는다).
      const lost = this.loop.restore({ lastFinishedAt: persisted.lastFinishedAt, inFlightJob: persisted.inFlightJob });
      this.status.update({ providers: persisted.status.providers, lastError: persisted.status.lastError });
      this.log("CONN", "서비스 워커 재시작 — 저장된 상태를 복원했습니다.");
      if (lost) this.log("JOB", `작업 유실: ${lost.provider} ${lost.resultId} — 서버 임대 만료 후 재시도됩니다.`);
    }

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

  getLogs(): LogEntry[] {
    return this.logs.list();
  }

  clearLogs(): void {
    this.logs.clear();
    this.persist();
  }

  getSettings(): ExtensionSettings {
    return { ...this.settings };
  }

  /** ON/OFF 토글: ON일 때만 서버에 연결해 작업을 가져간다 */
  async setActive(active: boolean): Promise<void> {
    await this.d.store.saveActive(active);
    this.status.update({ active, lastError: null });
    this.log("CONN", active ? "사용 ON" : "사용 OFF");
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
