/**
 * Gemini(gemini.google.com) 화면 셀렉터. 사이트 UI가 바뀌면 이 파일만 고친다.
 * Angular 앱이라 클래스의 `ng-*` 해시는 쓰지 않고 커스텀 태그와 `data-test-id`를 쓴다(주의: testid 속성명이 `data-test-id`).
 *
 * 검증 상태:
 *  - [확인됨 2026-09-26] probe.js 캡처(home/generating/done, 영어 UI, 로그인 상태)로 확인한 값
 *  - [추정] 캡처로 확인하지 못한 값 (출처)
 */
export const SELECTORS = {
  /** [확인됨] 질문 입력창. Quill 에디터. 숨겨진 `.ql-clipboard`(contenteditable)가 있으므로 `.ql-editor`로 한정한다 */
  input: ["rich-textarea .ql-editor", "div.ql-editor[role='textbox']"],
  /** [확인됨] 입력창이 비어 있을 때 붙는 클래스(`ql-blank`). 전송되면 다시 붙는다 */
  inputBlankClass: "ql-blank",
  /**
   * [확인됨 typed 캡처] 전송/중지 버튼 컨테이너. 입력이 비어 있으면 생성 중(중지 버튼)에만 존재하고 완료되면 사라진다.
   * 텍스트를 입력하면(`ql-blank` 제거) `gem-icon-button.send-button.has-input.submit` 안의 전송 버튼(aria-label "Send message")이 나타난다.
   */
  sendContainer: ['[data-test-id="send-button-container"]'],
  /** [확인됨/영어 UI] 중지 버튼 aria-label. 언어에 따라 다르므로 판정은 sendContainer+빈 입력창을 함께 쓴다 */
  stopLabel: /stop|중지|정지/i,
  /** [확인됨] 사용자 메시지(텍스트 앞에 "You said"가 붙는다) / 어시스턴트 응답(앞에 "Gemini said"가 붙으므로 본문으로 쓰지 않는다) */
  responseContainer: ["model-response"],
  /**
   * [확인됨] 응답 안의 답변 본문(마크다운). 사고 과정은 포함하지 않는다.
   * 주의: 완료 후에도 `aria-busy="true"`와 `processing-state-visible`이 남으므로 완료 판정에 쓰면 안 된다.
   */
  answerBlocks: ["message-content .markdown"],
  /**
   * [확인됨 2026-09-26, 로그인/로그아웃 캡처] 로그인 상태에만 있는 사이드바 "새 채팅" 버튼과 계정 메뉴 링크.
   * 주의: `sidenav-mavatar-footer`, `user-profile-picture`는 로그아웃 화면에도 있어 로그인 신호로 쓰면 안 된다
   * (로그아웃 화면에서 "Sign in" 버튼보다 먼저 렌더링되면 로그인으로 오판한다).
   */
  loggedInSignals: ['[data-test-id="new-chat-button"]', 'a[href*="accounts.google.com/SignOutOptions"]'],
  /**
   * [확인됨 로그아웃 캡처] 로그아웃에서도 입력창은 그대로 있다(로그인 유도 없이 익명 대화가 가능한 화면).
   * 로그아웃에만 있는 요소: 텍스트 "Sign in" 버튼(상단·사이드바 하단·사이드바 오류 문구), `.mavatar-signed-out-buttons`, signed-out 안내문.
   */
  loggedOutSignals: ['[data-test-id="signed-out-highly-regulated-zero-state-disclaimer"]', ".mavatar-signed-out-buttons", ".signed-out-buttons"],
  loginButtonText: /^(sign in|log in|로그인)$/i,
  /**
   * [부분 확인됨 2026-09-26, 웹 검색 done 캡처] 출처 URL은 본문 안 `response-element > … > link-block > a`(뒤에 `?utm_source=gemini`)에 있다.
   * `source-inline-chip`/`source-footnote`는 링크가 아니라 출처 대화상자를 여는 버튼("View source details for …")이어서
   * 칩으로만 표시된 출처의 URL은 대화상자를 열어야 나온다(그 DOM은 캡처하지 못해 수집하지 않는다).
   * 응답 안의 외부 링크를 모으고 구글/지원 링크는 제외한다.
   */
  citationLinks: ['a[href^="http"]'],
  internalHosts: ["google.com", "google.co.kr", "gstatic.com", "googleusercontent.com"],
} as const;
