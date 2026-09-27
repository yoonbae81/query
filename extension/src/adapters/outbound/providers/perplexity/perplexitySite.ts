import { SiteError, type Answer } from "../../../../domain/model";
import type { SiteProviderPort } from "../../../../domain/ports";
import { queryAll, queryFirst, sleep, waitFor, waitForStableText } from "../common/dom";
import { htmlToMarkdown } from "../common/htmlToMarkdown";
import { insertText, pressEnter } from "../common/input";
import { SELECTORS } from "./selectors";

export interface PerplexityTimings {
  inputTimeoutMs: number;
  /** 텍스트 입력 후 전송 버튼이 활성화되기를 기다리는 시간 */
  submitEnableTimeoutMs: number;
  submitConfirmTimeoutMs: number;
  /** Links 탭을 누른 뒤 출처 패널이 렌더링되기를 기다리는 시간 */
  sourcesTimeoutMs: number;
  /** 전송 후 최소 고정 대기 */
  minWaitMs: number;
  stableMs: number;
  completionTimeoutMs: number;
  pollMs: number;
}

export const DEFAULT_TIMINGS: PerplexityTimings = {
  inputTimeoutMs: 15_000,
  submitEnableTimeoutMs: 2_000,
  submitConfirmTimeoutMs: 10_000,
  sourcesTimeoutMs: 3_000,
  minWaitMs: 5_000,
  stableMs: 2_000,
  completionTimeoutMs: 600_000,
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

    // 텍스트가 인식되면 전송 버튼이 활성화된다(비어 있을 땐 pointer-events-none). 잠깐 기다려도 안 되면 Enter로 전송한다.
    const button = await waitFor(
      () => {
        const b = queryFirst<HTMLButtonElement>(SELECTORS.submitButton, this.doc);
        return b && !b.disabled && !b.classList.contains("pointer-events-none") ? b : null;
      },
      { timeoutMs: this.t.submitEnableTimeoutMs, timeoutError: () => new Error("submit button not enabled") },
    ).catch(() => null);
    if (button) button.click();
    else pressEnter(input);

    // 전송 확인: 생성 중 표시가 나타나거나 답변 영역이 생기거나 /search/ 로 이동하거나 입력창이 비워짐
    await waitFor(
      () => this.stopButton() || this.answerElement() || this.doc.location?.pathname.startsWith("/search/") || (input.textContent ?? "").trim() === "",
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
    const text = htmlToMarkdown(el) || (el.textContent ?? "").trim(); // 출처 탭을 열기 전에 답변부터 읽는다
    return { text, citations: await this.collectCitations() };
  }

  private externalLinks(root: ParentNode): string[] {
    return queryAll<HTMLAnchorElement>(SELECTORS.citationLinks, root).map((a) => a.href);
  }

  /** Links 탭을 눌러 출처 패널을 렌더링한 뒤 링크를 모은다. 탭/패널을 찾지 못하면 화면의 외부 링크로 대신한다. */
  private async collectCitations(): Promise<string[]> {
    const tabs = queryAll<HTMLElement>(SELECTORS.sourcesTab, this.doc);
    // 헤더에 보이는 탭을 우선한다(숨김 복제본은 .invisible 안에 있다)
    const tab = tabs.find((t) => !t.closest(".invisible")) ?? tabs[0];
    if (tab) {
      tab.click();
      const panel = await waitFor(
        () => {
          const p = queryFirst(SELECTORS.sourcesPanel, this.doc);
          return p && this.externalLinks(p).length > 0 ? p : null;
        },
        { timeoutMs: this.t.sourcesTimeoutMs, timeoutError: () => new Error("sources panel not rendered") },
      ).catch(() => null);
      if (panel) return [...new Set(this.externalLinks(panel))];
    }
    return [...new Set(this.externalLinks(this.doc))];
  }
}
