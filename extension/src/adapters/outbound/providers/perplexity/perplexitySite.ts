import { SiteError, type Answer } from "../../../../domain/model";
import type { SiteProviderPort } from "../../../../domain/ports";
import { queryAll, queryFirst, sleep, waitFor, waitForStableText } from "../common/dom";
import { htmlToMarkdown } from "../common/htmlToMarkdown";
import { insertText, pressEnter } from "../common/input";
import { SELECTORS } from "./selectors";

export interface PerplexityTimings {
  inputTimeoutMs: number;
  submitConfirmTimeoutMs: number;
  /** 전송 후 최소 고정 대기 (PLAN §6.3) */
  minWaitMs: number;
  stableMs: number;
  completionTimeoutMs: number;
  pollMs: number;
}

export const DEFAULT_TIMINGS: PerplexityTimings = {
  inputTimeoutMs: 15_000,
  submitConfirmTimeoutMs: 10_000,
  minWaitMs: 5_000,
  stableMs: 2_000,
  completionTimeoutMs: 180_000,
  pollMs: 1_000,
};

/** Perplexity 사이트 모듈 (콘텐츠 스크립트에서 실행). 새 대화 화면에서 질의 1건을 처리한다. */
export class PerplexitySite implements SiteProviderPort {
  constructor(
    private readonly doc: Document = document,
    private readonly t: PerplexityTimings = DEFAULT_TIMINGS,
  ) {}

  private hasSignInButton(): boolean {
    return [...this.doc.querySelectorAll("button")].some((b) => b.textContent?.trim() === SELECTORS.signInButtonText);
  }

  private stopButton(): Element | null {
    return queryFirst(SELECTORS.stopButton, this.doc);
  }

  private answerElement(): Element | null {
    const blocks = queryAll(SELECTORS.answerBlocks, this.doc);
    return blocks[blocks.length - 1] ?? null;
  }

  /** 입력창이 나타날 때까지 기다린 뒤 로그인 여부를 판단한다(검증 화면 등이면 입력창이 없다). */
  async isLoggedIn(): Promise<boolean> {
    await waitFor(() => queryFirst(SELECTORS.input, this.doc), {
      timeoutMs: this.t.inputTimeoutMs,
      timeoutError: () => new SiteError("selector_missing", "질문 입력창을 찾을 수 없습니다(input). 봇 검증 화면이거나 화면 구조가 바뀌었을 수 있습니다."),
    });
    return !this.hasSignInButton();
  }

  async submit(prompt: string): Promise<void> {
    const input = await waitFor(() => queryFirst<HTMLElement>(SELECTORS.input, this.doc), {
      timeoutMs: this.t.inputTimeoutMs,
      timeoutError: () => new SiteError("selector_missing", "질문 입력창을 찾을 수 없습니다(input)."),
    });
    insertText(input, prompt);
    await sleep(300);

    const button = queryFirst<HTMLElement>(SELECTORS.submitButton, this.doc);
    if (button) button.click();
    else pressEnter(input);

    // 전송 확인: 생성 중 표시가 나타나거나 답변 영역이 생기거나 입력창이 비워짐
    await waitFor(
      () => this.stopButton() || this.answerElement() || (input.textContent ?? "").trim() === "",
      {
        timeoutMs: this.t.submitConfirmTimeoutMs,
        timeoutError: () => new SiteError("selector_missing", "질의 전송을 확인하지 못했습니다(submitButton/stopButton)."),
      },
    );
  }

  async waitForCompletion(): Promise<void> {
    await waitForStableText(() => this.answerElement()?.textContent ?? "", {
      minWaitMs: this.t.minWaitMs,
      stableMs: this.t.stableMs,
      timeoutMs: this.t.completionTimeoutMs,
      intervalMs: this.t.pollMs,
      isBusy: () => this.stopButton() !== null,
    });
  }

  async extract(): Promise<Answer> {
    const el = this.answerElement();
    if (!el) throw new SiteError("selector_missing", "답변 본문을 찾을 수 없습니다(answerBlocks).");
    const text = htmlToMarkdown(el) || (el.textContent ?? "").trim();
    const citations = [...new Set(queryAll<HTMLAnchorElement>(SELECTORS.citationLinks, this.doc).map((a) => a.href))];
    return { text, citations };
  }
}
