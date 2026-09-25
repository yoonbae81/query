import type { ClientMessage, ServerMessage } from "../../../../../protocol";
import { toWebSocketUrl } from "../../../application/updateSettings";
import type { ConnectionStatus, ExtensionSettings } from "../../../domain/model";
import type { ServerGatewayPort } from "../../../domain/ports";

const PING_INTERVAL_MS = 20_000; // MV3 서비스 워커 유휴 종료(30초) 방지 및 서버 임대 연장
const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

export interface GatewayOptions {
  createSocket?: (url: string) => WebSocket;
  pingIntervalMs?: number;
  backoffMs?: readonly number[];
}

/** 서버 WebSocket(/ext/ws) 연결. disconnect 전까지 끊기면 백오프로 자동 재연결한다. */
export class WebSocketServerGateway implements ServerGatewayPort {
  private ws: WebSocket | null = null;
  private settings: ExtensionSettings | null = null;
  private wanted = false;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private messageHandler: (m: ServerMessage) => void = () => {};
  private statusHandler: (s: ConnectionStatus) => void = () => {};
  private openHandler: () => void = () => {};
  private readonly createSocket: (url: string) => WebSocket;
  private readonly pingIntervalMs: number;
  private readonly backoffMs: readonly number[];

  constructor(options: GatewayOptions = {}) {
    this.createSocket = options.createSocket ?? ((url) => new WebSocket(url));
    this.pingIntervalMs = options.pingIntervalMs ?? PING_INTERVAL_MS;
    this.backoffMs = options.backoffMs ?? BACKOFF_MS;
  }

  connect(settings: ExtensionSettings): void {
    this.settings = settings;
    this.wanted = true;
    this.attempt = 0;
    this.open();
  }

  disconnect(): void {
    this.wanted = false;
    clearTimeout(this.reconnectTimer);
    this.stopPing();
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
      ws.close(1000, "client disconnect");
    }
    this.statusHandler("disconnected");
  }

  send(message: ClientMessage): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(message));
    return true;
  }

  onMessage(handler: (m: ServerMessage) => void): void {
    this.messageHandler = handler;
  }
  onStatusChange(handler: (s: ConnectionStatus) => void): void {
    this.statusHandler = handler;
  }
  onOpen(handler: () => void): void {
    this.openHandler = handler;
  }

  private open(): void {
    if (!this.settings || this.ws) return;
    this.statusHandler("connecting");
    let ws: WebSocket;
    try {
      ws = this.createSocket(toWebSocketUrl(this.settings));
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      this.statusHandler("connected");
      this.startPing();
      this.openHandler();
    };
    ws.onmessage = (ev) => {
      try {
        this.messageHandler(JSON.parse(String(ev.data)) as ServerMessage);
      } catch {
        /* 잘못된 메시지는 무시 */
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.stopPing();
      this.statusHandler("disconnected");
      this.scheduleReconnect();
    };
    ws.onerror = () => {
      /* close 이벤트가 이어서 발생한다 */
    };
  }

  private scheduleReconnect(): void {
    if (!this.wanted) return;
    const delay = this.backoffMs[Math.min(this.attempt, this.backoffMs.length - 1)] ?? 30_000;
    this.attempt++;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.open(), delay);
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => this.send({ type: "ping" }), this.pingIntervalMs);
  }

  private stopPing(): void {
    clearInterval(this.pingTimer);
    this.pingTimer = undefined;
  }
}

/**
 * 설정 화면의 "연결 테스트": 연결 후 ping에 대한 pong까지 확인한다(CORS/호스트 권한 불필요).
 * 인증 실패(4401)는 연결 직후 서버가 닫으므로 핸드셰이크만으로는 알 수 없다.
 */
export function testConnection(settings: ExtensionSettings, timeoutMs = 5000): Promise<{ ok: boolean; message: string }> {
  return new Promise((resolve) => {
    if (!settings.serverUrl) return resolve({ ok: false, message: "서버 주소를 입력하세요." });
    let done = false;
    let ws: WebSocket | undefined;
    const finish = (ok: boolean, message: string) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        ws?.close();
      } catch {
        /* 이미 닫힘 */
      }
      resolve({ ok, message });
    };
    const timer = setTimeout(() => finish(false, "응답 시간 초과"), timeoutMs);
    try {
      ws = new WebSocket(toWebSocketUrl(settings));
    } catch (e) {
      return finish(false, e instanceof Error ? e.message : String(e));
    }
    ws.onopen = () => ws?.send(JSON.stringify({ type: "ping" }));
    ws.onmessage = (ev) => {
      if ((JSON.parse(String(ev.data)) as { type?: string }).type === "pong") finish(true, "연결되었습니다.");
    };
    ws.onerror = () => finish(false, "연결할 수 없습니다.");
    ws.onclose = (ev) => finish(false, ev.code === 4401 ? "인증에 실패했습니다(토큰 확인)." : "연결이 닫혔습니다.");
  });
}
