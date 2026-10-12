import type { ServerMessage } from "../../../protocol";
import { SiteError, type ExtensionSettings, type InFlightJob, type Job, type LogCategory, type ProviderDescriptor } from "../domain/model";
import type { ClockPort, ServerGatewayPort, SiteAutomationPort, TabControllerPort } from "../domain/ports";
import type { ReportProviderStates } from "./reportProviderStates";
import type { StatusStore } from "./statusStore";

export interface JobLoopDeps {
  registry: readonly ProviderDescriptor[];
  gateway: ServerGatewayPort;
  tabs: TabControllerPort;
  site: SiteAutomationPort;
  status: StatusStore;
  reporter: ReportProviderStates;
  clock: ClockPort;
  settings: () => ExtensionSettings;
  log: (category: LogCategory, message: string) => void;
}

/**
 * claim → 처리 → 결과 전송 루프.
 * - 한 번에 하나의 작업만 처리한다(순차).
 * - 작업 사이에 최소 간격(minIntervalSeconds)을 둔다.
 * - idle을 받으면 wake가 올 때까지 대기한다.
 */
export class RunJobLoop {
  private busyProvider: string | null = null;
  private lastFinishedAt = 0;
  private inFlightJob: InFlightJob | null = null;
  private queue: string[] = [];
  private claimPending = false;
  private starting = false;

  constructor(private readonly d: JobLoopDeps) {}

  get busyProviders(): ReadonlySet<string> {
    return new Set(this.busyProvider ? [this.busyProvider] : []);
  }

  /** 영속화용: 마지막 작업 종료 시각 */
  getLastFinishedAt(): number {
    return this.lastFinishedAt;
  }

  /** 영속화용: 처리 중인 작업 기록(없으면 null) */
  getInFlightJob(): InFlightJob | null {
    return this.inFlightJob ? { ...this.inFlightJob } : null;
  }

  /**
   * 서비스 워커 재시작 시 저장된 값을 복원한다.
   * 처리 중이던 작업은 재개할 수 없으므로 지우고, 그 기록을 반환해 유실을 진단하게 한다(서버 임대 회수가 복구 주체다).
   */
  restore(snapshot: { lastFinishedAt: number; inFlightJob: InFlightJob | null }): InFlightJob | null {
    this.lastFinishedAt = snapshot.lastFinishedAt;
    this.inFlightJob = null;
    return snapshot.inFlightJob;
  }

  private canWork(): boolean {
    const s = this.d.status.get();
    return s.active && s.connection === "connected";
  }

  handleMessage(message: ServerMessage): void {
    switch (message.type) {
      case "job":
        this.claimPending = false;
        void this.runJob({
          resultId: message.result_id,
          provider: message.provider,
          prompt: message.prompt,
          leaseSeconds: message.lease_seconds,
        });
        return;
      case "idle":
        this.claimPending = false;
        this.askNext();
        return;
      case "wake":
        void this.startRound();
        return;
      case "protocol_error":
        this.d.log("WS", message.message);
        this.d.status.update({ lastError: message.message });
        return;
      case "pong":
        return;
    }
  }

  /** ready 상태의 provider들에 순서대로 claim을 보낸다. 모두 idle이면 wake를 기다린다. */
  async startRound(): Promise<void> {
    if (this.busyProvider || this.claimPending || this.starting || !this.canWork()) return;
    this.starting = true;
    try {
      const wait = this.lastFinishedAt + this.d.settings().minIntervalSeconds * 1000 - this.d.clock.now();
      if (this.lastFinishedAt > 0 && wait > 0) await this.d.clock.sleep(wait);
      if (this.busyProvider || this.claimPending || !this.canWork()) return;
      this.queue = this.d.status
        .get()
        .providers.filter((p) => p.state === "ready")
        .map((p) => p.id);
      this.askNext();
    } finally {
      this.starting = false;
    }
  }

  private askNext(): void {
    if (this.busyProvider || !this.canWork()) return;
    const provider = this.queue.shift();
    if (!provider) return;
    this.claimPending = this.d.gateway.send({ type: "claim", provider });
  }

  private async runJob(job: Job): Promise<void> {
    this.busyProvider = job.provider;
    // 재시작 시 유실을 진단할 수 있게 처리 중인 작업을 기록한다(완료/실패 시 지운다)
    this.inFlightJob = { resultId: job.resultId, provider: job.provider, startedAt: this.d.clock.now() };
    const setMessage = (message: string) =>
      this.d.status.update({ currentJob: { resultId: job.resultId, provider: job.provider, message } });
    const progress = (message: string) => {
      this.d.gateway.send({ type: "progress", result_id: job.resultId, message });
      setMessage(message);
    };
    this.d.status.update({ lastError: null }); // 새 작업을 시작하면 이전 작업의 오류 표시는 지운다
    this.d.log("JOB", `시작 ${job.provider} ${job.resultId}`);
    setMessage("시작");

    try {
      const desc = this.d.registry.find((r) => r.id === job.provider);
      if (!desc) throw new SiteError("retryable", `지원하지 않는 provider: ${job.provider}`);
      const tab = await this.d.tabs.findTab(desc);
      if (!tab) throw new SiteError("retryable", `${desc.name} 탭이 없습니다.`);

      progress("질의 전송 중");
      await this.d.tabs.navigate(tab, desc.newThreadUrl);
      if (!(await this.d.site.isLoggedIn(tab, desc))) throw new SiteError("login_required", "로그인이 필요합니다.");
      await this.d.site.submit(tab, desc, job.prompt);

      progress("답변 대기 중");
      await this.d.site.waitForCompletion(tab, desc);

      progress("답변 추출 중");
      const answer = await this.d.site.extract(tab, desc);
      if (!answer.text.trim()) throw new SiteError("selector_missing", "답변 본문이 비어 있습니다.");

      this.d.gateway.send({ type: "result", result_id: job.resultId, answer: answer.text, citations: answer.citations });
      this.d.status.update({ lastError: null });
      this.d.log("JOB", `완료 ${job.provider} ${job.resultId}`);
    } catch (e) {
      const code = e instanceof SiteError ? e.code : "retryable";
      const message = e instanceof Error ? e.message : String(e);
      this.d.gateway.send({ type: "error", result_id: job.resultId, code, message });
      this.d.status.update({ lastError: `${code}: ${message}` });
      this.d.log("JOB", `실패 ${code}: ${message} (${job.provider} ${job.resultId})`);
    } finally {
      this.busyProvider = null;
      this.lastFinishedAt = this.d.clock.now();
      this.inFlightJob = null;
      this.d.status.update({ currentJob: null });
      await this.d.reporter.refresh().catch(() => {});
      void this.startRound();
    }
  }
}
