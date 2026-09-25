// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { waitForStableText } from "../src/adapters/outbound/providers/common/dom";
import { htmlToMarkdown } from "../src/adapters/outbound/providers/common/htmlToMarkdown";
import { PerplexitySite, type PerplexityTimings } from "../src/adapters/outbound/providers/perplexity/perplexitySite";
import { SiteError } from "../src/domain/model";

const FAST: PerplexityTimings = {
  inputTimeoutMs: 300,
  submitConfirmTimeoutMs: 300,
  minWaitMs: 50,
  stableMs: 100,
  completionTimeoutMs: 1500,
  pollMs: 10,
};

function html(markup: string): void {
  document.body.innerHTML = markup;
}

/** jsdom에는 execCommand가 없어 입력창에 텍스트를 넣는 동작을 흉내낸다 */
function stubExecCommand(): void {
  (document as unknown as { execCommand: unknown }).execCommand = (_cmd: string, _ui: boolean, text: string) => {
    document.getElementById("ask-input")!.textContent = text;
    return true;
  };
}

beforeEach(() => html(""));
afterEach(() => {
  delete (document as unknown as { execCommand?: unknown }).execCommand;
});

describe("htmlToMarkdown", () => {
  const md = (markup: string) => {
    const root = document.createElement("div");
    root.innerHTML = markup;
    return htmlToMarkdown(root);
  };

  it("헤딩/문단/서식/링크를 변환한다", () => {
    expect(md('<h2>제목</h2><p>본문 <strong>굵게</strong> 와 <em>기울임</em>, <code>x</code> <a href="https://e.com">링크</a></p>')).toBe(
      "## 제목\n\n본문 **굵게** 와 *기울임*, `x` [링크](https://e.com)",
    );
  });

  it("중첩 목록과 번호 목록을 변환한다", () => {
    expect(md("<ul><li>가<ul><li>나</li></ul></li><li>다</li></ul><ol><li>하나</li><li>둘</li></ol>")).toBe("- 가\n  - 나\n- 다\n\n1. 하나\n2. 둘");
  });

  it("코드 블록, 인용, 표를 변환한다", () => {
    expect(md('<pre><code class="language-ts">const a = 1;\n</code></pre>')).toBe("```ts\nconst a = 1;\n```");
    expect(md("<blockquote><p>인용</p></blockquote>")).toBe("> 인용");
    expect(md("<table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table>")).toBe("| a | b |\n| --- | --- |\n| 1 | 2 |");
  });

  it("스크립트/버튼은 제외하고 div로 감싼 블록도 처리한다", () => {
    expect(md("<div><div><p>안</p><button>복사</button><script>x()</script></div><p>밖</p></div>")).toBe("안\n\n밖");
  });
});

describe("waitForStableText", () => {
  const opts = { minWaitMs: 30, stableMs: 60, timeoutMs: 1000, intervalMs: 5 };

  it("텍스트가 멈춘 뒤에 완료한다", async () => {
    let text = "";
    const timer = setInterval(() => (text = text.length < 5 ? text + "a" : text), 20);
    const started = Date.now();
    expect(await waitForStableText(() => text, opts)).toBe("aaaaa");
    clearInterval(timer);
    expect(Date.now() - started).toBeGreaterThanOrEqual(100 + 60);
  });

  it("busy인 동안에는 완료하지 않고, 끝나지 않으면 timeout 오류", async () => {
    const started = Date.now();
    await expect(waitForStableText(() => "생성 중", { ...opts, timeoutMs: 200, isBusy: () => true })).rejects.toMatchObject({ code: "timeout" });
    expect(Date.now() - started).toBeGreaterThanOrEqual(200);
  });

  it("텍스트가 비어 있으면 완료하지 않는다", async () => {
    await expect(waitForStableText(() => "  ", { ...opts, timeoutMs: 150 })).rejects.toBeInstanceOf(SiteError);
  });
});

describe("PerplexitySite", () => {
  it("입력창이 있고 Sign In 버튼이 없으면 로그인 상태이다", async () => {
    html('<div id="ask-input" contenteditable="true"></div><button>Search</button>');
    expect(await new PerplexitySite(document, FAST).isLoggedIn()).toBe(true);
  });

  it("Sign In 버튼이 보이면 미로그인이다", async () => {
    html('<button>Sign In</button><div id="ask-input"></div>');
    expect(await new PerplexitySite(document, FAST).isLoggedIn()).toBe(false);
  });

  it("입력창이 없으면(검증 화면 등) selector_missing", async () => {
    html("<p>Just a moment...</p>");
    await expect(new PerplexitySite(document, FAST).isLoggedIn()).rejects.toMatchObject({ code: "selector_missing" });
  });

  it("질문을 입력하고 전송 버튼을 눌러 전송한다", async () => {
    html('<div id="ask-input" contenteditable="true"></div><button aria-label="Submit">go</button>');
    stubExecCommand();
    let clicked = 0;
    document.querySelector("button")!.addEventListener("click", () => {
      clicked++;
      document.body.insertAdjacentHTML("beforeend", '<div id="markdown-content-0">생성 중</div>');
    });
    await new PerplexitySite(document, FAST).submit("안녕");
    expect(document.getElementById("ask-input")!.textContent).toBe("안녕");
    expect(clicked).toBe(1);
  });

  it("전송 버튼이 없으면 Enter 키로 전송한다", async () => {
    html('<div id="ask-input" contenteditable="true"></div>');
    stubExecCommand();
    const input = document.getElementById("ask-input")!;
    let enter = 0;
    input.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Enter") {
        enter++;
        input.textContent = ""; // 전송되면 입력창이 비워진다
      }
    });
    await new PerplexitySite(document, FAST).submit("Q");
    expect(enter).toBe(1);
  });

  it("전송이 확인되지 않으면 selector_missing", async () => {
    html('<div id="ask-input" contenteditable="true"></div>');
    stubExecCommand();
    await expect(new PerplexitySite(document, FAST).submit("Q")).rejects.toMatchObject({ code: "selector_missing" });
  });

  it("중지 버튼이 사라지고 답변이 안정되면 완료로 본다", async () => {
    html('<button aria-label="Stop">stop</button><div id="markdown-content-0"></div>');
    const answer = document.getElementById("markdown-content-0")!;
    const started = Date.now();
    let n = 0;
    const timer = setInterval(() => {
      if (n < 4) answer.textContent = "가".repeat(++n);
      else document.querySelector("button")?.remove();
    }, 30);
    await new PerplexitySite(document, FAST).waitForCompletion();
    clearInterval(timer);
    expect(document.querySelector("button")).toBeNull();
    expect(Date.now() - started).toBeGreaterThanOrEqual(150);
  });

  it("답변이 끝나지 않으면 timeout", async () => {
    html('<button aria-label="Stop">stop</button><div id="markdown-content-0">계속</div>');
    await expect(new PerplexitySite(document, { ...FAST, completionTimeoutMs: 200 }).waitForCompletion()).rejects.toMatchObject({ code: "timeout" });
  });

  it("마지막 답변을 마크다운으로, 출처는 중복 없이 외부 링크만 추출한다", async () => {
    html(
      '<div id="markdown-content-0"><p>이전 답변</p></div>' +
        '<div id="markdown-content-1"><h2>결론</h2><p>내용 <a href="https://a.com/x">[1]</a></p><ul><li>항목</li></ul></div>' +
        '<a href="https://a.com/x">출처</a><a href="https://b.com/y">출처2</a><a href="https://www.perplexity.ai/search/z">내부</a>',
    );
    const answer = await new PerplexitySite(document, FAST).extract();
    expect(answer.text).toBe("## 결론\n\n내용 [[1]](https://a.com/x)\n\n- 항목");
    expect(answer.citations).toEqual(["https://a.com/x", "https://b.com/y"]);
  });

  it("답변 영역이 없으면 selector_missing", async () => {
    html("<p>없음</p>");
    await expect(new PerplexitySite(document, FAST).extract()).rejects.toMatchObject({ code: "selector_missing" });
  });
});
