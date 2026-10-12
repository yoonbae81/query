import type { ErrorCode, ProviderId, ProviderState } from "../../../protocol";

export type { ErrorCode, ProviderId, ProviderState };

/** 서버가 배정한 작업 (protocol.ts JobMessage) */
export interface Job {
  resultId: string;
  provider: ProviderId;
  prompt: string;
  leaseSeconds: number;
}

export interface Answer {
  text: string;
  citations: string[];
}

/** 사이트 자동화 중 발생한 오류. code는 서버에 그대로 보고된다 */
export class SiteError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SiteError";
  }
}

/** 지원 사이트의 정적 정보. 빌드(manifest 생성)와 코어가 함께 쓴다. provider 추가 = 항목 추가 */
export interface ProviderDescriptor {
  id: ProviderId;
  name: string;
  /** manifest host_permissions/content_scripts.matches 및 탭 탐색에 쓰는 match 패턴 */
  matches: string[];
  /** 매번 새 대화를 시작하기 위해 탭을 이동시키는 URL */
  newThreadUrl: string;
}

export interface TabRef {
  id: number;
  url: string;
}

export interface ExtensionSettings {
  /** 예: https://host/query, http://localhost:4444 */
  serverUrl: string;
  /** 향후 인증용. 비어 있으면 무인증 */
  authToken: string;
  minIntervalSeconds: number;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  serverUrl: "http://127.0.0.1:4444",
  authToken: "",
  minIntervalSeconds: 10,
};

export type ConnectionStatus = "disconnected" | "connecting" | "connected";

export interface ProviderStatus {
  id: ProviderId;
  name: string;
  state: ProviderState;
  tabId?: number;
  /** 탭은 있는데 상태를 확인하지 못한 이유 (진단용) */
  detail?: string;
}

/** 사이드 패널에 표시하는 확장 상태 */
export interface StatusSnapshot {
  active: boolean;
  connection: ConnectionStatus;
  providers: ProviderStatus[];
  currentJob: { resultId: string; provider: ProviderId; message: string } | null;
  lastError: string | null;
}

/** 처리 중이던 작업의 최소 기록. 서비스 워커가 재시작돼도 남겨 유실을 진단한다 */
export interface InFlightJob {
  resultId: string;
  provider: ProviderId;
  startedAt: number;
}

/** 진단 로그 분류. 패널에서 접두어로 보인다 */
export type LogCategory = "CONN" | "JOB" | "WS" | "STATE";

export interface LogEntry {
  at: number;
  category: LogCategory;
  message: string;
}

/**
 * 서비스 워커 재시작을 넘겨 유지해야 하는 최소 상태(chrome.storage.session).
 * 전역 변수에만 두면 SW가 종료되는 순간 사라지므로 저장소에 미러링한다.
 */
export interface PersistedState {
  status: StatusSnapshot;
  /** 마지막 작업 종료 시각 — 재시작 후에도 최소 질의 간격을 지킨다 */
  lastFinishedAt: number;
  /** 재시작 직전에 처리 중이던 작업. 재개할 수 없으므로 진단용으로만 남긴다 */
  inFlightJob: InFlightJob | null;
  logs: LogEntry[];
}
