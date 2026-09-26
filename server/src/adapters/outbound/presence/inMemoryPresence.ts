import type { PresencePort, PresenceSnapshot, ProviderStateValue } from "../../../domain/ports";

/** 확장 접속 상태를 메모리로 관리. API 서버는 단일 프로세스로 운영한다. */
export class InMemoryPresence implements PresencePort {
  private readonly clients = new Map<string, Map<string, ProviderStateValue>>();

  connect(clientId: string, states: Iterable<[string, ProviderStateValue]>): void {
    this.clients.set(clientId, new Map(states));
  }

  update(clientId: string, states: Iterable<[string, ProviderStateValue]>): void {
    const current = this.clients.get(clientId);
    if (!current) return;
    for (const [id, state] of states) current.set(id, state);
  }

  disconnect(clientId: string): void {
    this.clients.delete(clientId);
  }

  providerState(clientId: string, provider: string): ProviderStateValue | undefined {
    return this.clients.get(clientId)?.get(provider);
  }

  isProviderOnline(provider: string): boolean {
    for (const states of this.clients.values()) if (states.get(provider) === "ready") return true;
    return false;
  }

  snapshot(supportedProviders: string[]): PresenceSnapshot {
    return {
      clients: this.clients.size,
      providers: supportedProviders.map((id) => ({
        id,
        online: this.isProviderOnline(id),
        states: [...this.clients.values()].flatMap((s) => (s.has(id) ? [s.get(id)!] : [])),
      })),
    };
  }
}
