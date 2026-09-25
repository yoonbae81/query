import type { ClientMessage, ProviderStateEntry, ServerMessage } from "../../../../../protocol";
import type { ClaimNextResult } from "../../../application/claimNextResult";
import type { CompleteResult } from "../../../application/completeResult";
import type { FailResult } from "../../../application/failResult";
import type { RecordProgress } from "../../../application/recordProgress";
import type { ExtensionNotifierPort, QueryRepositoryPort } from "../../../domain/ports";
import type { InMemoryPresence } from "../../outbound/presence/inMemoryPresence";
import { clientMessageSchema } from "./schemas";

/** ws 라이브러리의 WebSocket 중 허브가 사용하는 부분 */
export interface SocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: "message", listener: (data: Buffer | ArrayBuffer | Buffer[]) => void): unknown;
  on(event: "close" | "error", listener: () => void): unknown;
}

const OPEN = 1;

interface Connection {
  socket: SocketLike;
  clientId?: string;
  /** 이 연결이 처리 중인 작업 (resultId → provider). 확장은 순차 처리이므로 provider당 최대 1건 */
  active: Map<string, string>;
}

export interface HubDeps {
  repo: QueryRepositoryPort;
  presence: InMemoryPresence;
  claim: ClaimNextResult;
  progress: RecordProgress;
  complete: CompleteResult;
  fail: FailResult;
  supportedProviders: readonly string[];
  leaseSeconds: number;
  log?: (message: string) => void;
}

/**
 * 확장과의 WebSocket 프로토콜 처리 (PLAN2 §4.2). 드라이빙 어댑터로서 유스케이스를 호출한다.
 * 서버가 밀어 넣지 않고 확장이 claim으로 가져간다. 새 작업이 생기면 wake만 보낸다.
 */
export class ExtensionHub implements ExtensionNotifierPort {
  private readonly connections = new Set<Connection>();

  constructor(private readonly deps: HubDeps) {}

  get connectionCount(): number {
    return this.connections.size;
  }

  handleConnection(socket: SocketLike): void {
    const conn: Connection = { socket, active: new Map() };
    this.connections.add(conn);
    // 메시지는 도착 순서대로 하나씩 처리한다 (claim/result 경합 방지)
    let chain: Promise<void> = Promise.resolve();
    socket.on("message", (data) => {
      const text = Buffer.isBuffer(data)
        ? data.toString("utf8")
        : Array.isArray(data)
          ? Buffer.concat(data).toString("utf8")
          : Buffer.from(data).toString("utf8");
      chain = chain.then(() => this.onMessage(conn, text)).catch((e: unknown) => {
        this.deps.log?.(`extension message error: ${e instanceof Error ? e.message : String(e)}`);
        this.send(conn, { type: "protocol_error", message: "서버 내부 오류" });
      });
    });
    const onGone = () => {
      chain = chain.then(() => this.onClose(conn));
    };
    socket.on("close", onGone);
    socket.on("error", onGone);
  }

  /** 새 pending이 생겼음을 접속 중인 모든 확장에 알린다 (PLAN2 §4.4) */
  wake(): void {
    for (const c of this.connections) if (c.clientId) this.send(c, { type: "wake" });
  }

  private send(conn: Connection, message: ServerMessage): void {
    if (conn.socket.readyState === OPEN) conn.socket.send(JSON.stringify(message));
  }

  private toStates(entries: ProviderStateEntry[]): [string, ProviderStateEntry["state"]][] {
    return entries.filter((e) => this.deps.supportedProviders.includes(e.id)).map((e) => [e.id, e.state]);
  }

  private async onMessage(conn: Connection, text: string): Promise<void> {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      this.send(conn, { type: "protocol_error", message: "JSON이 아닙니다." });
      return;
    }
    const parsed = clientMessageSchema.safeParse(raw);
    if (!parsed.success) {
      this.send(conn, { type: "protocol_error", message: `잘못된 메시지: ${parsed.error.issues[0]?.message ?? ""}` });
      return;
    }
    const msg: ClientMessage = parsed.data;

    if (msg.type === "hello") return this.onHello(conn, msg.client_id, msg.providers);
    if (msg.type === "ping") {
      if (conn.clientId) {
        await this.deps.repo.extendLeasesOf(conn.clientId, new Date(Date.now() + this.deps.leaseSeconds * 1000));
      }
      this.send(conn, { type: "pong" });
      return;
    }
    const clientId = conn.clientId;
    if (!clientId) {
      this.send(conn, { type: "protocol_error", message: "hello가 먼저 필요합니다." });
      return;
    }

    switch (msg.type) {
      case "state":
        this.deps.presence.update(clientId, this.toStates(msg.providers));
        return;
      case "claim":
        return this.onClaim(conn, clientId, msg.provider);
      case "progress": {
        const ok = await this.deps.progress.execute({ resultId: msg.result_id, clientId, message: msg.message });
        if (!ok) this.send(conn, { type: "protocol_error", message: "임대 중인 작업이 아닙니다." });
        return;
      }
      case "result": {
        const ok = await this.deps.complete.execute({
          resultId: msg.result_id,
          clientId,
          answer: msg.answer,
          citations: msg.citations,
        });
        conn.active.delete(msg.result_id);
        if (!ok) this.send(conn, { type: "protocol_error", message: "임대 중인 작업이 아닙니다." });
        return;
      }
      case "error": {
        const result = await this.deps.repo.getResult(msg.result_id);
        await this.deps.fail.execute({ resultId: msg.result_id, clientId, code: msg.code, message: msg.message });
        conn.active.delete(msg.result_id);
        if (msg.code === "login_required" && result) {
          this.deps.presence.update(clientId, [[result.provider, "login_required"]]);
        }
        return;
      }
    }
  }

  private async onHello(conn: Connection, clientId: string, providers: ProviderStateEntry[]): Promise<void> {
    // 같은 clientId의 이전 연결(재접속)은 정리한다
    for (const other of this.connections) {
      if (other !== conn && other.clientId === clientId) {
        other.clientId = undefined;
        other.socket.close(1000, "replaced");
        this.connections.delete(other);
      }
    }
    // 재접속한 확장은 이전에 잡고 있던 작업을 이어받지 않으므로 남은 임대는 즉시 만료 처리한다
    await this.deps.repo.expireLeasesOf(clientId, new Date());
    conn.clientId = clientId;
    this.deps.presence.connect(clientId, this.toStates(providers));
  }

  private async onClaim(conn: Connection, clientId: string, provider: string): Promise<void> {
    if (!this.deps.supportedProviders.includes(provider) || this.deps.presence.providerState(clientId, provider) !== "ready") {
      this.send(conn, { type: "idle", provider });
      return;
    }
    if ([...conn.active.values()].includes(provider)) {
      this.send(conn, { type: "idle", provider }); // 순차 처리: 이미 처리 중
      return;
    }
    const job = await this.deps.claim.execute({ provider, clientId });
    if (!job) {
      this.send(conn, { type: "idle", provider });
      return;
    }
    conn.active.set(job.resultId, provider);
    this.send(conn, {
      type: "job",
      result_id: job.resultId,
      provider: job.provider,
      prompt: job.prompt,
      lease_seconds: job.leaseSeconds,
    });
  }

  private async onClose(conn: Connection): Promise<void> {
    if (!this.connections.delete(conn)) return;
    const clientId = conn.clientId;
    if (!clientId) return;
    this.deps.presence.disconnect(clientId);
    // 연결이 끊기면 임대를 즉시 만료 처리 — 회수는 SweepLeases가 수행 (PLAN2 §4.4)
    await this.deps.repo.expireLeasesOf(clientId, new Date());
  }
}
