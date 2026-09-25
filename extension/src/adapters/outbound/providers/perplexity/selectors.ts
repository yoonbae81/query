/**
 * Perplexity 화면 셀렉터. 사이트 UI가 바뀌면 이 파일만 고친다.
 *
 * 검증 상태:
 *  - [확인됨 2026-09-25] 관찰 스크립트로 확인한 값
 *  - [추정] 스파이크 전까지의 추정값. 콘솔 스니펫(홈/생성 중/완료 3상태) 결과로 확정한다 — docs/PLAN2.md §7
 */
export const SELECTORS = {
  /** [확인됨] 로그인 후 홈의 질문 입력창 (div, contenteditable 계열) */
  input: ["#ask-input"],
  /** [확인됨] 로그아웃 상태의 헤더 버튼 텍스트. 이 버튼이 있으면 미로그인 */
  signInButtonText: "Sign In",
  /** [추정] 전송 버튼. 못 찾으면 Enter 키로 전송한다 */
  submitButton: ['button[aria-label="Submit"]', 'button[data-testid="submit-button"]', 'button[type="submit"]'],
  /** [추정] 답변 생성 중에만 나타나는 중지 버튼 */
  stopButton: ['button[aria-label="Stop"]', 'button[aria-label="Stop generating"]', 'button[data-testid="stop-generating-button"]'],
  /** [추정] 답변 본문 컨테이너. 여러 개면 마지막(가장 최근 답변)을 쓴다 */
  answerBlocks: ['[id^="markdown-content"]', '[data-testid="answer"]', 'div[class*="prose"]'],
  /** [추정] 출처 링크 (perplexity 내부 링크 제외) */
  citationLinks: ['a[href^="http"]:not([href*="perplexity.ai"])'],
} as const;
