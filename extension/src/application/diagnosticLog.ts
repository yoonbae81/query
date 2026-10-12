import type { LogCategory, LogEntry } from "../domain/model";

/** 서비스 워커가 재시작돼도 남는 진단 로그(링 버퍼). 저장은 호출자(ExtensionService)가 한다. */
export class DiagnosticLog {
  private entries: LogEntry[] = [];

  constructor(
    private readonly now: () => number,
    private readonly limit = 200,
  ) {}

  restore(entries: readonly LogEntry[]): void {
    this.entries = entries.slice(-this.limit).map((e) => ({ ...e }));
  }

  append(category: LogCategory, message: string): void {
    this.entries.push({ at: this.now(), category, message });
    if (this.entries.length > this.limit) this.entries.splice(0, this.entries.length - this.limit);
  }

  clear(): void {
    this.entries = [];
  }

  list(): LogEntry[] {
    return this.entries.map((e) => ({ ...e }));
  }
}
