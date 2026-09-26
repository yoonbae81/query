/**
 * 서버 ↔ 브라우저 확장 WebSocket 메시지 타입.
 *
 * 서버(server/)와 확장(extension/)이 `import type`으로 공유한다.
 * 규칙: 타입만 둔다. 외부 패키지를 import하지 않는다(루트에는 node_modules가 없다).
 */

export type ProviderId = string;

/** ready: 처리 가능 / login_required: 탭은 있으나 미로그인 / no_tab: 해당 사이트 탭 없음 */
export type ProviderState = "ready" | "login_required" | "no_tab";

export interface ProviderStateEntry {
  id: ProviderId;
  state: ProviderState;
}

/** 확장이 서버에 보고하는 오류 유형 */
export type ErrorCode = "login_required" | "timeout" | "selector_missing" | "retryable";

// ---- 확장 → 서버 ----

export interface HelloMessage {
  type: "hello";
  client_id: string;
  version: string;
  providers: ProviderStateEntry[];
}

export interface StateMessage {
  type: "state";
  providers: ProviderStateEntry[];
}

export interface ClaimMessage {
  type: "claim";
  provider: ProviderId;
}

export interface ProgressMessage {
  type: "progress";
  result_id: string;
  message: string;
}

export interface ResultMessage {
  type: "result";
  result_id: string;
  answer: string;
  citations: string[];
}

export interface ErrorMessage {
  type: "error";
  result_id: string;
  code: ErrorCode;
  message: string;
}

export interface PingMessage {
  type: "ping";
}

export type ClientMessage =
  | HelloMessage
  | StateMessage
  | ClaimMessage
  | ProgressMessage
  | ResultMessage
  | ErrorMessage
  | PingMessage;

// ---- 서버 → 확장 ----

export interface JobMessage {
  type: "job";
  result_id: string;
  provider: ProviderId;
  /** 서버가 시스템 프롬프트와 질문을 합쳐 만든 최종 입력문 */
  prompt: string;
  lease_seconds: number;
}

export interface IdleMessage {
  type: "idle";
  provider: ProviderId;
}

/** 새 pending이 생겼거나 재시도 대기가 끝났음 — idle 상태의 확장은 claim을 다시 보낸다 */
export interface WakeMessage {
  type: "wake";
}

export interface PongMessage {
  type: "pong";
}

/** 프로토콜 위반/처리 거절 통지 */
export interface ProtocolErrorMessage {
  type: "protocol_error";
  message: string;
}

export type ServerMessage = JobMessage | IdleMessage | WakeMessage | PongMessage | ProtocolErrorMessage;
