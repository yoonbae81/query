import type { ClientMessage, ServerMessage } from "../../../protocol";
import type { Answer, ConnectionStatus, ExtensionSettings, ProviderDescriptor, TabRef } from "./model";

/** 서버와의 WebSocket 연결. 재연결은 어댑터가 책임진다. */
export interface ServerGatewayPort {
  /** 연결을 시작(유지)한다. 끊기면 disconnect 전까지 자동 재연결한다. */
  connect(settings: ExtensionSettings): void;
  disconnect(): void;
  send(message: ClientMessage): boolean;
  onMessage(handler: (message: ServerMessage) => void): void;
  onStatusChange(handler: (status: ConnectionStatus) => void): void;
  /** 연결이 (재)수립될 때마다 호출된다 — hello를 다시 보내기 위한 훅 */
  onOpen(handler: () => void): void;
}

export interface TabControllerPort {
  /** 사이트의 탭을 찾는다. 여러 개면 가장 최근에 활성화된 탭 */
  findTab(provider: ProviderDescriptor): Promise<TabRef | null>;
  /** URL로 이동하고 로딩이 끝날 때까지 기다린다 */
  navigate(tab: TabRef, url: string): Promise<void>;
  /** 탭 열림/닫힘/이동 시 호출 */
  onTabsChanged(handler: () => void): void;
}

/** 사이트 페이지 안(콘텐츠 스크립트)에서 실행되는 자동화. 실패 시 SiteError를 던진다. */
export interface SiteAutomationPort {
  isLoggedIn(tab: TabRef, provider: ProviderDescriptor): Promise<boolean>;
  submit(tab: TabRef, provider: ProviderDescriptor, prompt: string): Promise<void>;
  waitForCompletion(tab: TabRef, provider: ProviderDescriptor): Promise<void>;
  extract(tab: TabRef, provider: ProviderDescriptor): Promise<Answer>;
}

/** 콘텐츠 스크립트 쪽 구현 계약 (사이트 모듈이 구현한다) */
export interface SiteProviderPort {
  isLoggedIn(): Promise<boolean>;
  submit(prompt: string): Promise<void>;
  waitForCompletion(): Promise<void>;
  extract(): Promise<Answer>;
}

export interface SettingsStorePort {
  loadSettings(): Promise<ExtensionSettings>;
  saveSettings(settings: ExtensionSettings): Promise<void>;
  loadActive(): Promise<boolean>;
  saveActive(active: boolean): Promise<void>;
  /** 이 확장 설치를 식별하는 ID. 없으면 생성해 저장한다 */
  loadClientId(): Promise<string>;
}

export interface ClockPort {
  now(): number;
  sleep(ms: number): Promise<void>;
}
