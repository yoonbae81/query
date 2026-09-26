/**
 * Perplexity 화면 셀렉터. 사이트 UI가 바뀌면 이 파일만 고친다.
 *
 * 검증 상태:
 *  - [확인됨] 관찰 스크립트/콘솔 스니펫(홈, 생성 중)으로 확인한 값
 *  - [추정] 캡처 없이 추정한 값. `docs/providers/tools/harness.py probe`(홈/생성 중/완료 상태 캡처)로 확정한다 — docs/providers/README.md
 */
export const SELECTORS = {
  /** [확인됨] 로그인 후 홈의 질문 입력창 (div, contenteditable 계열) */
  input: ["#ask-input"],
  /** [확인됨] 로그아웃 상태의 헤더 버튼 텍스트. 이 버튼이 있으면 미로그인 */
  signInButtonText: "Sign In",
  /**
   * [확인됨 2026-09-26] 전송 버튼. 입력창이 비어 있으면 `pointer-events-none` 클래스가 붙어 있고
   * 텍스트가 들어가면 활성화된다. 입력창 내부는 `<p dir="auto"><br></p>` 구조의 에디터다.
   */
  submitButton: ['button[aria-label="Submit"]'],
  /** [확인됨 2026-09-26] 답변 생성 중에만 나타나는 중지 버튼. 생성이 끝나면 사라진다 */
  stopButton: ['button[aria-label^="Stop response"]'],
  /**
   * [확인됨 2026-09-26] 답변 본문(마크다운 렌더러). 답변 단계가 여러 개면 요소가 여러 개일 수 있어 마지막을 쓴다.
   * 전송하면 URL이 /search/<id>로 바뀐다.
   */
  answerBlocks: ['div.prose[data-renderer="lm"]'],
  /**
   * [확인됨 2026-09-26] "Links" 탭 버튼(radix tabs, role=tab). 헤더에 보이는 것과 숨김 복제본이 함께 있다.
   * 출처 링크는 이 탭을 눌러야 렌더링된다(답변 화면에는 외부 링크 앵커가 없다).
   */
  sourcesTab: ['button[role="tab"][id$="-trigger-sources"]'],
  /** [추정] Links 탭 패널. radix 탭의 aria-controls(`...-content-sources`)에서 유추. 스파이크(links 상태)로 확정 */
  sourcesPanel: ['[role="tabpanel"][id$="-content-sources"]', '[id$="-content-sources"]'],
  /** 출처 링크 (perplexity 내부 링크 제외) */
  citationLinks: ['a[href^="http"]:not([href*="perplexity.ai"])'],
} as const;
