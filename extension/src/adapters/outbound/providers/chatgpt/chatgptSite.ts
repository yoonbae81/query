import { SiteError, type Answer } from "../../../../domain/model";
import type { SiteProviderPort } from "../../../../domain/ports";
import { queryAll, queryFirst, sleep, waitFor, waitForStableText } from "../common/dom";
import { htmlToMarkdown } from "../common/htmlToMarkdown";
import { insertText, pressEnter } from "../common/input";
import { SELECTORS } from "./selectors";

export interface ChatGptTimings {
  inputTimeoutMs: number;
  /** 입력창이 나타난 뒤 로그인/로그아웃 신호를 기다리는 시간 */
  loginSignalTimeoutMs: number;
  /** 텍스트 입력 후 전송 버튼이 나타나 활성화되기를 기다리는 시간 */
  submitEnableTimeoutMs: number;
  submitConfirmTimeoutMs: number;
  /** 전송 후 최소 고정 대기 */
  minWaitMs: number;
  stableMs: number;
  completionTimeoutMs: number;
  pollMs: number;
}

export const DEFAULT_TIMINGS: ChatGptTimings = {
  inputTimeoutMs: 15_000,
  loginSignalTimeoutMs: 4_000,
  submitEnableTimeoutMs: 2_000,
  submitConfirmTimeoutMs: 10_000,
  minWaitMs: 5_000,
  stableMs: 2_000,
  completionTimeoutMs: 600_000,
  pollMs: 1_000,
};

const isInternal = (a: HTMLAnchorElement): boolean => SELECTORS.internalHosts.some((h) => a.hostname === h || a.hostname.endsWith(`.${h}`));

/** ChatGPT가 출처 링크에 붙이는 추적 파라미터를 제거한다 */
function cleanUrl(href: string): string {
  try {
    const url = new URL(href);
    if (url.searchParams.get("utm_source") === "chatgpt.com") url.searchParams.delete("utm_source");
    return url.toString();
  } catch {
    return href;
  }
}

/** ChatGPT 사이트 모듈 (콘텐츠 스크립트에서 실행). 새 대화 화면(/)에서 질의 1건을 처리한다. */
export class ChatGptSite implements SiteProviderPort {
  constructor(
    private readonly doc: Document = document,
    private readonly t: ChatGptTimings = DEFAULT_TIMINGS,
  ) {}

  private lastAssistantMessage(): Element | null {
    const messages = queryAll(SELECTORS.assistantMessage, this.doc);
    return messages[messages.length - 1] ?? null;
  }

  private answerBlocks(): Element[] {
    const message = this.lastAssistantMessage();
    return message ? queryAll(SELECTORS.answerBlocks, message) : [];
  }

  /** 생성 중: 중지 버튼이 보이거나 마지막 답변 본문에 스트리밍 표시가 있음 */
  private isGenerating(): boolean {
    if (queryFirst(SELECTORS.stopButton, this.doc)) return true;
    const message = this.lastAssistantMessage();
    return message !== null && queryFirst(SELECTORS.streamingBlock, message) !== null;
  }

  private hasLoginButton(): boolean {
    return [...this.doc.querySelectorAll("button, a")].some((e) => SELECTORS.loginButtonText.test((e.textContent ?? "").trim()));
  }

  /**
   * 로그인 여부를 판단한다. 로그아웃 화면은 입력창 DOM이 아예 달라(textarea#mobile-composer-prompt) 로그인 입력창이 없으므로,
   * 입력창 또는 로그인 버튼 중 먼저 나타나는 쪽으로 판단한다. 로그인 버튼이 보이면 미로그인, 프로필 버튼이 보이면 로그인.
   * 좁은 화면에서는 사이드바(프로필 버튼)가 접혀 둘 다 없을 수 있어, 제한 시간 안에 로그아웃 신호가 없으면 로그인으로 본다.
   */
  async isLoggedIn(): Promise<boolean> {
    await waitFor(() => this.hasLoginButton() || queryFirst(SELECTORS.input, this.doc), {
      timeoutMs: this.t.inputTimeoutMs,
      timeoutError: () => new SiteError("selector_missing", "질문 입력창을 찾을 수 없습니다(input). 봇 검증 화면이거나 화면 구조가 바뀌었을 수 있습니다."),
    });
    if (this.hasLoginButton()) return false;
    const signal = await waitFor(
      () => (this.hasLoginButton() ? "out" : queryFirst(SELECTORS.profileButton, this.doc) ? "in" : null),
      { timeoutMs: this.t.loginSignalTimeoutMs, timeoutError: () => new Error("no login signal") },
    ).catch(() => "unknown");
    return signal !== "out";
  }

  async submit(prompt: string): Promise<void> {
    const input = await waitFor(() => queryFirst<HTMLElement>(SELECTORS.input, this.doc), {
      timeoutMs: this.t.inputTimeoutMs,
      timeoutError: () => new SiteError("selector_missing", "질문 입력창을 찾을 수 없습니다(input)."),
    });
    insertText(input, prompt);
    await sleep(300);

    // 텍스트가 인식되면 전송 버튼이 나타난다. 잠깐 기다려도 안 보이면 Enter로 전송한다.
    const button = await waitFor(
      () => {
        const b = queryFirst<HTMLButtonElement>(SELECTORS.submitButton, this.doc);
        return b && !b.disabled ? b : null;
      },
      { timeoutMs: this.t.submitEnableTimeoutMs, timeoutError: () => new Error("submit button not found") },
    ).catch(() => null);
    if (button) button.click();
    else pressEnter(input);

    // 전송 확인: 생성 중 표시가 나타나거나 답변 메시지가 생기거나 /c/<id> 로 이동하거나 입력창이 비워짐
    await waitFor(
      () => this.isGenerating() || this.lastAssistantMessage() || this.doc.location?.pathname.startsWith("/c/") || (input.textContent ?? "").trim() === "",
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
    const links = blocks.flatMap((b) => queryAll<HTMLAnchorElement>(SELECTORS.citationLinks, b).filter((a) => !isInternal(a)).map((a) => cleanUrl(a.href)));
    return { text, citations: [...new Set(links)] };
  }
}
