import { SiteError, type Answer } from "../../../../domain/model";
import type { SiteProviderPort } from "../../../../domain/ports";
import { queryAll, queryFirst, sleep, waitFor, waitForStableText } from "../common/dom";
import { htmlToMarkdown } from "../common/htmlToMarkdown";
import { insertText, pressEnter } from "../common/input";
import { SELECTORS } from "./selectors";

export interface GeminiTimings {
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

export const DEFAULT_TIMINGS: GeminiTimings = {
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

/** Gemini가 출처 링크에 붙이는 추적 파라미터(`utm_source=gemini`)를 제거한다 */
function cleanUrl(href: string): string {
  try {
    const url = new URL(href);
    if (url.searchParams.get("utm_source") === "gemini") url.searchParams.delete("utm_source");
    return url.toString();
  } catch {
    return href;
  }
}

/** Gemini 사이트 모듈 (콘텐츠 스크립트에서 실행). 새 대화 화면(/app)에서 질의 1건을 처리한다. */
export class GeminiSite implements SiteProviderPort {
  constructor(
    private readonly doc: Document = document,
    private readonly t: GeminiTimings = DEFAULT_TIMINGS,
  ) {}

  private input(): HTMLElement | null {
    return queryFirst<HTMLElement>(SELECTORS.input, this.doc);
  }

  private lastResponse(): Element | null {
    const responses = queryAll(SELECTORS.responseContainer, this.doc);
    return responses[responses.length - 1] ?? null;
  }

  private answerBlocks(): Element[] {
    const response = this.lastResponse();
    return response ? queryAll(SELECTORS.answerBlocks, response) : [];
  }

  /**
   * 생성 중: 전송/중지 컨테이너가 있는데 입력창이 비어 있으면 중지 버튼이다(텍스트를 넣으면 전송 버튼이 되므로 구분된다).
   * 본문의 `aria-busy`는 완료 후에도 "true"로 남아 쓰지 않는다.
   */
  private isGenerating(): boolean {
    const container = queryFirst(SELECTORS.sendContainer, this.doc);
    if (!container) return false;
    if ([...container.querySelectorAll("button")].some((b) => SELECTORS.stopLabel.test(b.getAttribute("aria-label") ?? ""))) return true;
    return this.input()?.classList.contains(SELECTORS.inputBlankClass) ?? false;
  }

  private hasLoginButton(): boolean {
    if (queryFirst(SELECTORS.loggedOutSignals, this.doc)) return true;
    return [...this.doc.querySelectorAll("button, a")].some((e) => SELECTORS.loginButtonText.test((e.textContent ?? "").trim()));
  }

  /**
   * 입력창이 나타날 때까지 기다린 뒤 로그인 여부를 판단한다(로그아웃 화면에도 입력창이 있다).
   * 로그아웃 신호("Sign in" 버튼 등)가 보이면 미로그인, 로그인에만 있는 신호(새 채팅 버튼 등)가 보이면 로그인.
   * 둘 다 없으면 제한 시간 뒤 로그인으로 본다.
   */
  async isLoggedIn(): Promise<boolean> {
    await waitFor(() => this.input(), {
      timeoutMs: this.t.inputTimeoutMs,
      timeoutError: () => new SiteError("selector_missing", "질문 입력창을 찾을 수 없습니다(input). 계정 선택/동의 화면이거나 화면 구조가 바뀌었을 수 있습니다."),
    });
    const signal = await waitFor(
      () => (this.hasLoginButton() ? "out" : queryFirst(SELECTORS.loggedInSignals, this.doc) ? "in" : null),
      { timeoutMs: this.t.loginSignalTimeoutMs, timeoutError: () => new Error("no login signal") },
    ).catch(() => "unknown");
    return signal !== "out";
  }

  async submit(prompt: string): Promise<void> {
    const input = await waitFor(() => this.input(), {
      timeoutMs: this.t.inputTimeoutMs,
      timeoutError: () => new SiteError("selector_missing", "질문 입력창을 찾을 수 없습니다(input)."),
    });
    insertText(input, prompt);
    await sleep(300);

    // 텍스트를 넣으면 같은 컨테이너에 전송 버튼이 나타난다(중지 버튼이 아닌 것). 안 보이면 Enter로 전송한다.
    const button = await waitFor(
      () => {
        const container = queryFirst(SELECTORS.sendContainer, this.doc);
        const b = container?.querySelector<HTMLButtonElement>("button");
        return b && !b.disabled && !SELECTORS.stopLabel.test(b.getAttribute("aria-label") ?? "") ? b : null;
      },
      { timeoutMs: this.t.submitEnableTimeoutMs, timeoutError: () => new Error("submit button not found") },
    ).catch(() => null);
    if (button) button.click();
    else pressEnter(input);

    // 전송 확인: 응답이 생기거나 /app/<id> 로 이동하거나 입력창이 비워짐
    await waitFor(
      () => this.lastResponse() || /\/app\/\w+/.test(this.doc.location?.pathname ?? "") || (input.textContent ?? "").trim() === "",
      {
        timeoutMs: this.t.submitConfirmTimeoutMs,
        timeoutError: () => new SiteError("selector_missing", "질의 전송을 확인하지 못했습니다(sendContainer)."),
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
    // 출처는 본문뿐 아니라 응답 안의 sources-list에도 있을 수 있어 응답 전체에서 외부 링크를 모은다
    const response = this.lastResponse();
    const links = response ? queryAll<HTMLAnchorElement>(SELECTORS.citationLinks, response).filter((a) => !isInternal(a)).map((a) => cleanUrl(a.href)) : [];
    return { text, citations: [...new Set(links)] };
  }
}
