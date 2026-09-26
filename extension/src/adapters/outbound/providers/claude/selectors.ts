/**
 * Claude(claude.ai) 화면 셀렉터. 사이트 UI가 바뀌면 이 파일만 고친다.
 * UI 언어에 따라 aria-label이 바뀌므로(한국어: "메시지 보내기") 언어와 무관한 data-testid만 쓴다.
 *
 * 검증 상태:
 *  - [확인됨 2026-09-26] probe.js 캡처(home/generating/done, 한국어 UI, Sonnet 5)로 확인한 값
 */
export const SELECTORS = {
  /** [확인됨] 질문 입력창. tiptap/ProseMirror contenteditable(role=textbox). 전송 후 비워지고 placeholder가 "답글"로 바뀐다 */
  input: ['[data-testid="chat-input"]'],
  /** [확인됨] 로그인 상태에서만 보이는 좌측 하단 사용자 메뉴 버튼 */
  userMenu: ['[data-testid="user-menu-button"]'],
  /**
   * [확인됨 2026-09-26, 로그아웃 캡처] 로그아웃하면 /new 가 `/login?from=logout&reauth=1&returnTo=%2Fnew` 로 리다이렉트되고
   * 채팅 입력창이 없다(제목 "Sign in - Claude"). 로그인 페이지의 버튼 testid와 경로로 판별한다. 쿠키 배너 `consent-banner`가 함께 뜬다.
   */
  loginPagePath: "/login",
  loginPageSignals: ['[data-testid="login-with-google"]', '[data-testid="login-with-apple"]'],
  /** [확인됨] 전송 버튼. 입력창이 비어 있으면 disabled(홈에서는 보이지 않음)이고 텍스트가 들어가면 활성화된다 */
  submitButton: ['button[data-testid="chat-input-send"]'],
  /** [확인됨] 응답 생성 중에만 나타나는 중지 버튼(aria-label "응답 중지"). done에서는 사라지고 전송 버튼이 돌아온다 */
  stopButton: ['button[data-testid="chat-input-stop"]'],
  /**
   * [확인됨 2026-09-26, 실사용 추적] 진행 단계(사고/도구 사용) 표시. 진행 중이면 `data-state="busy"`, 끝나면 "done".
   * 도구를 쓰는 답변은 중간 진행 문구 뒤에 긴 공백이 생기므로 stop 버튼/streaming과 함께 이중으로 본다
   * (1회 관찰된 중간 진행 문구 조기 완료를 방어한다. 재현은 되지 않았다).
   */
  turnStatusBusy: ['[data-testid="TurnStatus"][data-state="busy"]'],
  /** [확인됨] 어시스턴트 메시지 행. `data-is-streaming`이 생성 중 "true", 완료 후 "false" */
  assistantMessage: ['[data-testid="assistant-message"]'],
  /**
   * [확인됨] 어시스턴트 메시지 안의 답변 본문(마크다운). 사고 과정(TurnStatus)은 포함하지 않는다.
   * `.font-claude-response`는 사고 단계 문구("… 수립 중.")가 섞여 쓰지 않는다. 도구 사용 등으로 본문이 여러 블록일 수 있다.
   */
  answerBlocks: [".standard-markdown"],
  /**
   * [확인됨 2026-09-26, 웹 검색 done 캡처] 출처는 답변 본문 `.standard-markdown` 안의 `a` 링크(추적 파라미터 없는 직접 URL)다.
   * 도구를 쓰면 본문 블록이 여러 개(진행 문구 + 최종 답변)로 나뉘며 지금은 모두 이어 붙인다.
   */
  citationLinks: ['a[href^="http"]:not([href*="claude.ai"]):not([href*="anthropic.com"])'],
} as const;
