import { SiteError, type Answer } from "../../../../domain/model";
import type { SiteProviderPort } from "../../../../domain/ports";
import { queryAll, queryFirst, sleep, waitFor, waitForStableText } from "../common/dom";
import { htmlToMarkdown } from "../common/htmlToMarkdown";
import { insertText, pressEnter } from "../common/input";
import { SELECTORS } from "./selectors";

export interface ClaudeTimings {
  inputTimeoutMs: number;
  /** 입력창이 나타난 뒤 로그인 신호(사용자 메뉴)를 기다리는 시간 */
  loginSignalTimeoutMs: number;
  /** 텍스트 입력 후 전송 버튼이 활성화되기를 기다리는 시간 */
  submitEnableTimeoutMs: number;
  submitConfirmTimeoutMs: number;
  /** 전송 후 최소 고정 대기 */
  minWaitMs: number;
  stableMs: number;
  completionTimeoutMs: number;
  pollMs: number;
}

export const DEFAULT_TIMINGS: ClaudeTimings = {
  inputTimeoutMs: 15_000,
  loginSignalTimeoutMs: 4_000,
  submitEnableTimeoutMs: 2_000,
  submitConfirmTimeoutMs: 10_000,
  minWaitMs: 5_000,
  stableMs: 2_000,
  completionTimeoutMs: 180_000,
  pollMs: 1_000,
};

/** Claude 사이트 모듈 (콘텐츠 스크립트에서 실행). 새 대화 화면(/new)에서 질의 1건을 처리한다. */
export class ClaudeSite implements SiteProviderPort {
  constructor(
    private readonly doc: Document = document,
    private readonly t: ClaudeTimings = DEFAULT_TIMINGS,
  ) {}

  private lastAssistantMessage(): Element | null {
    const messages = queryAll(SELECTORS.assistantMessage, this.doc);
    return messages[messages.length - 1] ?? null;
  }

  private answerBlocks(): Element[] {
    const message = this.lastAssistantMessage();
    return message ? queryAll(SELECTORS.answerBlocks, message) : [];
  }

  /** 생성 중: 중지 버튼이 보이거나, 마지막 답변이 스트리밍 중이거나, 사고/도구 사용 단계가 진행 중임 */
  private isGenerating(): boolean {
    if (queryFirst(SELECTORS.stopButton, this.doc) !== null) return true;
    const message = this.lastAssistantMessage();
    if (message === null) return false;
    return message.getAttribute("data-is-streaming") === "true" || queryFirst(SELECTORS.turnStatusBusy, message) !== null;
  }

  /** 로그아웃하면 /login 으로 리다이렉트되어 채팅 입력창이 없다. */
  private isLoginPage(): boolean {
    return (this.doc.location?.pathname ?? "").startsWith(SELECTORS.loginPagePath) || queryFirst(SELECTORS.loginPageSignals, this.doc) !== null;
  }

  /**
   * 입력창 또는 로그인 페이지가 먼저 나타나는 쪽으로 판단한다. 로그인 페이지면 미로그인,
   * 입력창이 있으면 로그인 상태에서만 있는 사용자 메뉴가 나타나는지로 판단한다.
   */
  async isLoggedIn(): Promise<boolean> {
    await waitFor(() => this.isLoginPage() || queryFirst(SELECTORS.input, this.doc), {
      timeoutMs: this.t.inputTimeoutMs,
      timeoutError: () => new SiteError("selector_missing", "질문 입력창을 찾을 수 없습니다(input). 봇 검증 화면이거나 화면 구조가 바뀌었을 수 있습니다."),
    });
    if (this.isLoginPage()) return false;
    return waitFor(() => queryFirst(SELECTORS.userMenu, this.doc), {
      timeoutMs: this.t.loginSignalTimeoutMs,
      timeoutError: () => new Error("user menu not found"),
    }).then(
      () => true,
      () => false,
    );
  }

  async submit(prompt: string): Promise<void> {
    const input = await waitFor(() => queryFirst<HTMLElement>(SELECTORS.input, this.doc), {
      timeoutMs: this.t.inputTimeoutMs,
      timeoutError: () => new SiteError("selector_missing", "질문 입력창을 찾을 수 없습니다(input)."),
    });
    insertText(input, prompt);
    await sleep(300);

    // 텍스트가 인식되면 전송 버튼이 활성화된다(비어 있을 땐 disabled). 잠깐 기다려도 안 되면 Enter로 전송한다.
    const button = await waitFor(
      () => {
        const b = queryFirst<HTMLButtonElement>(SELECTORS.submitButton, this.doc);
        return b && !b.disabled ? b : null;
      },
      { timeoutMs: this.t.submitEnableTimeoutMs, timeoutError: () => new Error("submit button not enabled") },
    ).catch(() => null);
    if (button) button.click();
    else pressEnter(input);

    // 전송 확인: 생성 중 표시가 나타나거나 답변 메시지가 생기거나 /chat/<id> 로 이동하거나 입력창이 비워짐
    await waitFor(
      () => this.isGenerating() || this.lastAssistantMessage() || this.doc.location?.pathname.startsWith("/chat/") || (input.textContent ?? "").trim() === "",
      {
        timeoutMs: this.t.submitConfirmTimeoutMs,
        timeoutError: () => new SiteError("selector_missing", "질의 전송을 확인하지 못했습니다(submitButton/stopButton)."),
      },
    );
  }

  async waitForCompletion(): Promise<void> {
    await waitForStableText(() => this.answerBlocks().map((b) => b.textContent ?? "").join("\n"), {
      minWaitMs: this.t.minWaitMs,
      stableMs: this.t.stableMs,
      timeoutMs: this.t.completionTimeoutMs,
      intervalMs: this.t.pollMs,
      isBusy: () => this.isGenerating(),
    });
  }

  async extract(): Promise<Answer> {
    const blocks = this.answerBlocks();
    if (blocks.length === 0) throw new SiteError("selector_missing", "답변 본문을 찾을 수 없습니다(answerBlocks).");
    const text = blocks
      .map((b) => htmlToMarkdown(b) || (b.textContent ?? "").trim())
      .filter(Boolean)
      .join("\n\n");
    const links = blocks.flatMap((b) => queryAll<HTMLAnchorElement>(SELECTORS.citationLinks, b).map((a) => a.href));
    return { text, citations: [...new Set(links)] };
  }
}
