/**
 * ChatGPT(chatgpt.com) 화면 셀렉터. 사이트 UI가 바뀌면 이 파일만 고친다.
 * UI 언어에 따라 aria-label이 바뀔 수 있어 data-testid / data-message-author-role 같은 언어 무관 속성을 쓴다.
 *
 * 검증 상태:
 *  - [확인됨 2026-09-26] probe.js 캡처(home/generating/done, 영어 UI, Free 계정)로 확인한 값
 */
export const SELECTORS = {
  /**
   * [확인됨] 질문 입력창. ProseMirror contenteditable. 같은 id/name의 숨겨진 `textarea` 폴백이 있으므로
   * 반드시 `div`로 한정한다. 전송 후에도 같은 요소가 비워진 채 남는다.
   */
  input: ["div#prompt-textarea"],
  /**
   * [확인됨] 로그인 상태의 사이드바 프로필 버튼. 좁은 화면(≈650px)에서는 사이드바가 접혀 렌더링되지 않는다(1189px에서 확인).
   */
  profileButton: ['[data-testid="accounts-profile-button"]'],
  /**
   * [확인됨 2026-09-26, 시크릿 창 로그아웃 캡처] 로그아웃 화면의 헤더 버튼 텍스트("Log in", "Sign up for free").
   * 로그아웃 화면은 입력창이 `textarea#mobile-composer-prompt`로 완전히 다르고 클래스가 난독화(x9r1u3d…)되어 있으며
   * data-testid가 없어 텍스트로만 구분한다. 쿠키 동의 `dialog[role=dialog]`도 함께 뜬다. 영어 UI 기준(다른 언어 UI는 미확인).
   */
  loginButtonText: /^(log in|sign up|sign up for free)$/i,
  /**
   * [확인됨 2026-09-26, typed 캡처] 전송 버튼(aria-label "Send prompt", type=submit). `#composer-submit-button` 자리가 상태에 따라
   * 입력 비어 있음 → "Start Voice" / 텍스트 있음 → `send-button` / 생성 중 → `stop-button` 으로 바뀐다. 못 찾으면 Enter로 전송한다.
   */
  submitButton: ['button[data-testid="send-button"]'],
  /** [확인됨] 응답 생성 중에만 나타나는 중지 버튼(aria-label "Stop answering"). 완료되면 사라지고 Start Voice로 돌아온다 */
  stopButton: ['button[data-testid="stop-button"]'],
  /** [확인됨] 어시스턴트 메시지. 사용자 메시지는 `data-message-author-role="user"` */
  assistantMessage: ['[data-message-author-role="assistant"]'],
  /** [확인됨] 어시스턴트 메시지 안의 답변 본문(마크다운). 생성 중에는 `streaming-animation` 클래스가 함께 붙고 완료되면 빠진다 */
  answerBlocks: [".markdown"],
  /** [확인됨] 생성 중인 본문 표시 */
  streamingBlock: [".markdown.streaming-animation"],
  /**
   * [확인됨 2026-09-26, 웹 검색 done 캡처] 출처는 본문 `.markdown` 안의 링크다: 인라인 `[data-testid="webpage-citation-pill"]`과
   * 목록의 "관련 보도" 링크. 모든 외부 링크에 `?utm_source=chatgpt.com`이 붙으므로 href 문자열이 아니라 호스트로 내부 링크를 걸러낸다(internalHosts).
   * 날씨 위젯(`dil-widget-shell`) 텍스트도 본문에 섞여 들어온다(위젯 자체가 답변의 일부라 제외하지 않는다).
   */
  citationLinks: ['a[href^="http"]'],
  internalHosts: ["chatgpt.com", "openai.com"],
} as const;
