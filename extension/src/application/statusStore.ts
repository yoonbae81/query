import type { StatusSnapshot } from "../domain/model";

/** 팝업에 보여줄 확장 상태를 보관하고 변경을 알린다. */
export class StatusStore {
  private snapshot: StatusSnapshot = {
    active: false,
    connection: "disconnected",
    providers: [],
    currentJob: null,
    lastError: null,
  };
  private readonly listeners = new Set<(s: StatusSnapshot) => void>();

  get(): StatusSnapshot {
    return structuredClone(this.snapshot);
  }

  update(patch: Partial<StatusSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    const copy = this.get();
    this.listeners.forEach((l) => l(copy));
  }

  subscribe(listener: (s: StatusSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
