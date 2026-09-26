// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ChatGptSite, type ChatGptTimings } from "../src/adapters/outbound/providers/chatgpt/chatgptSite";

const FAST: ChatGptTimings = {
  inputTimeoutMs: 300,
  loginSignalTimeoutMs: 100,
  submitEnableTimeoutMs: 100,
  submitConfirmTimeoutMs: 300,
  minWaitMs: 50,
  stableMs: 100,
  completionTimeoutMs: 1500,
  pollMs: 10,
};

// 캡처(probe.js)한 구조: 숨겨진 textarea 폴백 + ProseMirror div가 같은 id/name을 쓴다
const INPUT =
  '<textarea name="prompt-textarea" aria-label="Chat with ChatGPT"></textarea>' +
  '<div id="prompt-textarea" class="ProseMirror" role="textbox" contenteditable="true"><p class="placeholder"><br></p></div>';
const PROFILE = '<div data-testid="accounts-profile-button" role="button"></div>';
const SEND = '<button data-testid="send-button" aria-label="Send prompt"></button>';
const STOP = '<button data-testid="stop-button" aria-label="Stop answering"></button>';
const message = (streaming: boolean, inner: string) =>
  `<div data-message-author-role="assistant"><div><div class="${streaming ? "streaming-animation " : ""}markdown prose">${inner}</div></div></div>`;

function html(markup: string): void {
  document.body.innerHTML = markup;
}

/** jsdom에는 execCommand가 없어 입력창에 텍스트를 넣는 동작을 흉내낸다 */
function stubExecCommand(): void {
  (document as unknown as { execCommand: unknown }).execCommand = (_cmd: string, _ui: boolean, text: string) => {
    document.querySelector("div#prompt-textarea")!.textContent = text;
    return true;
  };
}

beforeEach(() => html(""));
afterEach(() => {
  delete (document as unknown as { execCommand?: unknown }).execCommand;
});

describe("ChatGptSite", () => {
  it("입력창과 프로필 버튼이 있으면 로그인 상태이다", async () => {
    html(INPUT + PROFILE);
    expect(await new ChatGptSite(document, FAST).isLoggedIn()).toBe(true);
  });

  it("로그인 버튼이 보이면 미로그인이다", async () => {
    html(INPUT + "<button>Log in</button><button>Sign up for free</button>");
    expect(await new ChatGptSite(document, FAST).isLoggedIn()).toBe(false);
  });

  it("로그아웃 화면(입력창이 textarea#mobile-composer-prompt로 다름)은 입력창 대기 없이 즉시 미로그인이다", async () => {
    html(
      '<textarea id="mobile-composer-prompt" placeholder="Ask ChatGPT"></textarea>' +
        '<dialog role="dialog" open>We use cookies</dialog><header><button>Log in</button><button>Sign up for free</button></header>' +
        '<button aria-label="Add files. Log in to use.">Add filesLog in</button>',
    );
    const started = Date.now();
    expect(await new ChatGptSite(document, FAST).isLoggedIn()).toBe(false);
    expect(Date.now() - started).toBeLessThan(FAST.inputTimeoutMs);
  });

  it("좁은 화면처럼 프로필도 로그인 버튼도 없으면 로그인으로 본다", async () => {
    html(INPUT);
    expect(await new ChatGptSite(document, FAST).isLoggedIn()).toBe(true);
  });

  it("입력창이 없으면(검증 화면 등) selector_missing", async () => {
    html("<p>Just a moment...</p>");
    await expect(new ChatGptSite(document, FAST).isLoggedIn()).rejects.toMatchObject({ code: "selector_missing" });
  });

  it("숨겨진 textarea가 아니라 contenteditable 입력창에 질문을 넣고 전송 버튼을 누른다", async () => {
    html(INPUT);
    stubExecCommand();
    let clicks = 0;
    setTimeout(() => {
      document.body.insertAdjacentHTML("beforeend", SEND); // 텍스트가 인식되면 전송 버튼이 나타난다
      document.querySelector("button")!.addEventListener("click", () => {
        clicks++;
        document.body.insertAdjacentHTML("beforeend", STOP);
      });
    }, 40);
    await new ChatGptSite(document, { ...FAST, submitEnableTimeoutMs: 500 }).submit("안녕");
    expect(document.querySelector("div#prompt-textarea")!.textContent).toBe("안녕");
    expect(document.querySelector("textarea")!.value).toBe("");
    expect(clicks).toBe(1);
  });

  it("전송 버튼이 없으면 Enter 키로 전송한다", async () => {
    html(INPUT);
    stubExecCommand();
    const input = document.querySelector<HTMLElement>("div#prompt-textarea")!;
    let enter = 0;
    input.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Enter") {
        enter++;
        input.textContent = "";
      }
    });
    await new ChatGptSite(document, FAST).submit("Q");
    expect(enter).toBe(1);
  });

  it("전송이 확인되지 않으면 selector_missing", async () => {
    html(INPUT);
    stubExecCommand();
    await expect(new ChatGptSite(document, FAST).submit("Q")).rejects.toMatchObject({ code: "selector_missing" });
  });

  it("중지 버튼이 사라지고 streaming 표시가 빠지며 답변이 안정되면 완료로 본다", async () => {
    html(STOP + message(true, ""));
    const block = document.querySelector<HTMLElement>(".markdown")!;
    const started = Date.now();
    let n = 0;
    const timer = setInterval(() => {
      if (n < 4) block.textContent = "가".repeat(++n);
      else {
        document.querySelector('[data-testid="stop-button"]')?.remove();
        block.classList.remove("streaming-animation");
      }
    }, 30);
    await new ChatGptSite(document, FAST).waitForCompletion();
    clearInterval(timer);
    expect(Date.now() - started).toBeGreaterThanOrEqual(150);
  });

  it("중지 버튼이 없어도 streaming 표시가 남아 있으면 완료하지 않는다", async () => {
    html(message(true, "<p>계속</p>"));
    await expect(new ChatGptSite(document, { ...FAST, completionTimeoutMs: 200 }).waitForCompletion()).rejects.toMatchObject({ code: "timeout" });
  });

  it("마지막 답변을 마크다운(표 포함)으로 추출한다", async () => {
    html(
      message(false, "<p>이전 답변</p>") +
        message(
          false,
          '<p dir="auto">기준으로 <strong>3~4년</strong>입니다.</p><h3>계획</h3>' +
            '<div class="tableContainer"><div><table><thead><tr><th>단계</th><th>기간</th></tr></thead><tbody><tr><td>기초</td><td>1~6개월</td></tr></tbody></table></div></div>',
        ),
    );
    const answer = await new ChatGptSite(document, FAST).extract();
    expect(answer.text).toBe("기준으로 **3~4년**입니다.\n\n### 계획\n\n| 단계 | 기간 |\n| --- | --- |\n| 기초 | 1~6개월 |");
    expect(answer.citations).toEqual([]);
  });

  it("출처는 외부 링크만 중복 없이, 추적 파라미터(utm_source=chatgpt.com)를 지우고 모은다", async () => {
    html(
      message(
        false,
        '<p>내용 <a href="https://a.com/x?utm_source=chatgpt.com">[1]</a> <a href="https://a.com/x?utm_source=chatgpt.com">again</a> ' +
          '<a href="https://b.com/y?q=1&utm_source=chatgpt.com">[2]</a> <a href="https://chatgpt.com/c/1">내부</a></p>',
      ),
    );
    expect((await new ChatGptSite(document, FAST).extract()).citations).toEqual(["https://a.com/x", "https://b.com/y?q=1"]);
  });

  it("답변 영역이 없으면 selector_missing", async () => {
    html("<p>없음</p>");
    await expect(new ChatGptSite(document, FAST).extract()).rejects.toMatchObject({ code: "selector_missing" });
  });
});
