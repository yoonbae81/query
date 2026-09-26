// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ClaudeSite, type ClaudeTimings } from "../src/adapters/outbound/providers/claude/claudeSite";

const FAST: ClaudeTimings = {
  inputTimeoutMs: 300,
  loginSignalTimeoutMs: 100,
  submitEnableTimeoutMs: 100,
  submitConfirmTimeoutMs: 300,
  minWaitMs: 50,
  stableMs: 100,
  completionTimeoutMs: 1500,
  pollMs: 10,
};

const INPUT = '<div data-testid="chat-input" role="textbox" contenteditable="true"><p class="is-empty"><br></p></div>';
const SEND = '<button data-testid="chat-input-send" aria-label="메시지 보내기" disabled></button>';
const STOP = '<button data-testid="chat-input-stop" aria-label="응답 중지"></button>';
const message = (streaming: boolean, inner: string) =>
  `<div data-testid="assistant-message" data-is-streaming="${streaming}">` +
  '<div data-testid="TurnStatus"><span>계획 수립 중.</span></div>' +
  `<div class="standard-markdown">${inner}</div></div>`;

function html(markup: string): void {
  document.body.innerHTML = markup;
}

/** jsdom에는 execCommand가 없어 입력창에 텍스트를 넣는 동작을 흉내낸다 */
function stubExecCommand(): void {
  (document as unknown as { execCommand: unknown }).execCommand = (_cmd: string, _ui: boolean, text: string) => {
    document.querySelector('[data-testid="chat-input"]')!.textContent = text;
    return true;
  };
}

beforeEach(() => html(""));
afterEach(() => {
  delete (document as unknown as { execCommand?: unknown }).execCommand;
});

describe("ClaudeSite", () => {
  it("입력창과 사용자 메뉴가 있으면 로그인 상태이다", async () => {
    html(INPUT + '<button data-testid="user-menu-button">YB·Pro</button>');
    expect(await new ClaudeSite(document, FAST).isLoggedIn()).toBe(true);
  });

  it("입력창은 있는데 사용자 메뉴가 없으면 미로그인이다", async () => {
    html(INPUT);
    expect(await new ClaudeSite(document, FAST).isLoggedIn()).toBe(false);
  });

  it("로그아웃하면 로그인 페이지(입력창 없음)로 리다이렉트되므로 입력창 대기 없이 즉시 미로그인이다", async () => {
    html(
      '<div data-testid="consent-banner"></div><button data-testid="login-with-google">Continue with Google</button>' +
        '<button data-testid="login-with-apple">Continue with Apple</button><input data-testid="email" />',
    );
    const started = Date.now();
    expect(await new ClaudeSite(document, FAST).isLoggedIn()).toBe(false);
    expect(Date.now() - started).toBeLessThan(FAST.inputTimeoutMs);
  });

  it("입력창이 없으면(검증 화면 등) selector_missing", async () => {
    html("<p>Just a moment...</p>");
    await expect(new ClaudeSite(document, FAST).isLoggedIn()).rejects.toMatchObject({ code: "selector_missing" });
  });

  it("질문을 입력하면 활성화된 전송 버튼을 눌러 전송한다", async () => {
    html(INPUT + SEND);
    stubExecCommand();
    const button = document.querySelector<HTMLButtonElement>("button")!;
    let clicks = 0;
    button.addEventListener("click", () => {
      clicks++;
      document.body.insertAdjacentHTML("beforeend", STOP);
    });
    setTimeout(() => button.removeAttribute("disabled"), 40); // 텍스트가 인식되면 활성화된다
    await new ClaudeSite(document, { ...FAST, submitEnableTimeoutMs: 500 }).submit("안녕");
    expect(document.querySelector('[data-testid="chat-input"]')!.textContent).toBe("안녕");
    expect(clicks).toBe(1);
  });

  it("전송 버튼이 활성화되지 않으면 Enter 키로 전송한다", async () => {
    html(INPUT + SEND);
    stubExecCommand();
    const input = document.querySelector<HTMLElement>('[data-testid="chat-input"]')!;
    let enter = 0;
    input.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Enter") {
        enter++;
        input.textContent = "";
      }
    });
    await new ClaudeSite(document, FAST).submit("Q");
    expect(enter).toBe(1);
  });

  it("전송이 확인되지 않으면 selector_missing", async () => {
    html(INPUT);
    stubExecCommand();
    await expect(new ClaudeSite(document, FAST).submit("Q")).rejects.toMatchObject({ code: "selector_missing" });
  });

  it("중지 버튼이 사라지고 스트리밍이 끝나며 답변이 안정되면 완료로 본다", async () => {
    html(STOP + message(true, ""));
    const block = document.querySelector<HTMLElement>(".standard-markdown")!;
    const row = document.querySelector<HTMLElement>('[data-testid="assistant-message"]')!;
    const started = Date.now();
    let n = 0;
    const timer = setInterval(() => {
      if (n < 4) block.textContent = "가".repeat(++n);
      else {
        document.querySelector('[data-testid="chat-input-stop"]')?.remove();
        row.setAttribute("data-is-streaming", "false");
      }
    }, 30);
    await new ClaudeSite(document, FAST).waitForCompletion();
    clearInterval(timer);
    expect(Date.now() - started).toBeGreaterThanOrEqual(150);
  });

  it("stop 버튼·streaming 표시가 잠깐 꺼져도 도구 사용 단계(TurnStatus busy)가 진행 중이면 중간 진행 문구를 완료로 보지 않는다", async () => {
    html(
      '<div data-testid="assistant-message" data-is-streaming="false">' +
        '<div data-testid="TurnStatus" data-state="done"></div><div class="standard-markdown"><p>웹 검색으로 다시 확인할게요.</p></div>' +
        '<div data-testid="TurnStatus" data-state="busy"></div></div>',
    );
    await expect(new ClaudeSite(document, { ...FAST, completionTimeoutMs: 250 }).waitForCompletion()).rejects.toMatchObject({ code: "timeout" });
    document.querySelector('[data-state="busy"]')!.setAttribute("data-state", "done");
    await expect(new ClaudeSite(document, FAST).waitForCompletion()).resolves.toBeUndefined();
  });

  it("중지 버튼이 없어도 data-is-streaming이 true인 동안은 완료하지 않는다", async () => {
    html(message(true, "<p>계속</p>"));
    await expect(new ClaudeSite(document, { ...FAST, completionTimeoutMs: 200 }).waitForCompletion()).rejects.toMatchObject({ code: "timeout" });
  });

  it("마지막 답변의 본문만 마크다운으로 추출한다(사고 과정 문구 제외)", async () => {
    html(message(false, "<p>이전 답변</p>") + message(false, '<h2>결론</h2><p>내용 <a href="https://a.com/x">[1]</a></p><ul><li>항목</li></ul>'));
    const answer = await new ClaudeSite(document, FAST).extract();
    expect(answer.text).toBe("## 결론\n\n내용 [[1]](https://a.com/x)\n\n- 항목");
    expect(answer.text).not.toContain("계획 수립");
    expect(answer.citations).toEqual(["https://a.com/x"]);
  });

  it("본문 블록이 여러 개면 이어 붙이고, 출처는 중복과 내부 링크를 제외한다", async () => {
    html(
      '<div data-testid="assistant-message" data-is-streaming="false">' +
        '<div class="standard-markdown"><p>하나 <a href="https://a.com/1">a</a></p></div>' +
        '<div class="standard-markdown"><p>둘 <a href="https://a.com/1">a</a> <a href="https://b.com/2">b</a> <a href="https://claude.ai/x">내부</a></p></div></div>',
    );
    const answer = await new ClaudeSite(document, FAST).extract();
    expect(answer.text).toBe("하나 [a](https://a.com/1)\n\n둘 [a](https://a.com/1) [b](https://b.com/2) [내부](https://claude.ai/x)");
    expect(answer.citations).toEqual(["https://a.com/1", "https://b.com/2"]);
  });

  it("답변 영역이 없으면 selector_missing", async () => {
    html("<p>없음</p>");
    await expect(new ClaudeSite(document, FAST).extract()).rejects.toMatchObject({ code: "selector_missing" });
  });
});
