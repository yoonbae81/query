// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GeminiSite, type GeminiTimings } from "../src/adapters/outbound/providers/gemini/geminiSite";

const FAST: GeminiTimings = {
  inputTimeoutMs: 300,
  loginSignalTimeoutMs: 100,
  submitEnableTimeoutMs: 100,
  submitConfirmTimeoutMs: 300,
  minWaitMs: 50,
  stableMs: 100,
  completionTimeoutMs: 1500,
  pollMs: 10,
};

// 캡처(probe.js)한 구조: Quill 에디터 + 숨겨진 ql-clipboard(contenteditable)
const INPUT =
  '<rich-textarea><div class="ql-clipboard" contenteditable="true"></div>' +
  '<div class="ql-editor ql-blank" role="textbox" contenteditable="true"><p><br></p></div></rich-textarea>';
/** 로그인에만 있는 새 채팅 버튼. sidenav-mavatar-footer는 로그아웃에도 있어 신호가 아니다 */
const ACCOUNT = '<sidenav-mavatar-footer></sidenav-mavatar-footer><div data-test-id="new-chat-button"></div>';
const STOP = '<div data-test-id="send-button-container"><button aria-label="Stop response"></button></div>';
const SEND = '<div data-test-id="send-button-container"><button aria-label="Send message"></button></div>';
/** 완료 후에도 aria-busy="true"가 남는다(캡처로 확인) */
const response = (inner: string, extra = "") =>
  `<model-response><div class="thoughts">생각 중...</div><message-content><div class="markdown markdown-main-panel" aria-busy="true">${inner}</div></message-content>${extra}</model-response>`;

function html(markup: string): void {
  document.body.innerHTML = markup;
}

const editor = () => document.querySelector<HTMLElement>(".ql-editor")!;

/** jsdom에는 execCommand가 없어 입력창에 텍스트를 넣는 동작을 흉내낸다(입력하면 ql-blank가 빠진다) */
function stubExecCommand(): void {
  (document as unknown as { execCommand: unknown }).execCommand = (_cmd: string, _ui: boolean, text: string) => {
    editor().textContent = text;
    editor().classList.remove("ql-blank");
    return true;
  };
}

beforeEach(() => html(""));
afterEach(() => {
  delete (document as unknown as { execCommand?: unknown }).execCommand;
});

describe("GeminiSite", () => {
  it("입력창과 계정 영역이 있으면 로그인 상태이다", async () => {
    html(INPUT + ACCOUNT);
    expect(await new GeminiSite(document, FAST).isLoggedIn()).toBe(true);
  });

  it("로그인 버튼이 보이면 미로그인이다", async () => {
    html(INPUT + "<a>Sign in</a>");
    expect(await new GeminiSite(document, FAST).isLoggedIn()).toBe(false);
  });

  it("로그아웃 화면(입력창은 있고 Sign in 버튼/signed-out 요소가 있음)은 미로그인이다", async () => {
    html(INPUT + '<gem-button><button>Sign in</button></gem-button><div class="mavatar-signed-out-buttons"></div><sidenav-mavatar-footer></sidenav-mavatar-footer>');
    expect(await new GeminiSite(document, FAST).isLoggedIn()).toBe(false);
  });

  it("로그아웃에도 있는 sidenav-mavatar-footer가 Sign in 버튼보다 먼저 렌더링돼도 로그인으로 오판하지 않는다", async () => {
    html(INPUT + "<sidenav-mavatar-footer></sidenav-mavatar-footer>");
    setTimeout(() => document.body.insertAdjacentHTML("beforeend", "<button>Sign in</button>"), 30);
    expect(await new GeminiSite(document, { ...FAST, loginSignalTimeoutMs: 300 }).isLoggedIn()).toBe(false);
  });

  it("입력창이 없으면(계정 선택 화면 등) selector_missing", async () => {
    html("<p>Choose an account</p>");
    await expect(new GeminiSite(document, FAST).isLoggedIn()).rejects.toMatchObject({ code: "selector_missing" });
  });

  it("숨겨진 ql-clipboard가 아니라 ql-editor에 질문을 넣고 전송 버튼을 누른다", async () => {
    html(INPUT);
    stubExecCommand();
    let clicks = 0;
    setTimeout(() => {
      document.body.insertAdjacentHTML("beforeend", SEND); // 텍스트를 넣으면 전송 버튼이 나타난다
      document.querySelector("button")!.addEventListener("click", () => {
        clicks++;
        editor().textContent = "";
        editor().classList.add("ql-blank");
        document.body.insertAdjacentHTML("beforeend", response("생성 중"));
      });
    }, 40);
    await new GeminiSite(document, { ...FAST, submitEnableTimeoutMs: 500 }).submit("안녕");
    expect(clicks).toBe(1);
    expect(document.querySelector(".ql-clipboard")!.textContent).toBe("");
  });

  it("전송 버튼이 없으면 Enter 키로 전송한다", async () => {
    html(INPUT);
    stubExecCommand();
    let enter = 0;
    editor().addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Enter") {
        enter++;
        editor().textContent = "";
      }
    });
    await new GeminiSite(document, FAST).submit("Q");
    expect(enter).toBe(1);
  });

  it("전송이 확인되지 않으면 selector_missing", async () => {
    html(INPUT);
    stubExecCommand();
    await expect(new GeminiSite(document, FAST).submit("Q")).rejects.toMatchObject({ code: "selector_missing" });
  });

  it("중지 버튼 컨테이너가 사라지고 답변이 안정되면 완료로 본다(본문의 aria-busy는 무시)", async () => {
    html(INPUT + STOP + response(""));
    const block = document.querySelector<HTMLElement>(".markdown")!;
    const started = Date.now();
    let n = 0;
    const timer = setInterval(() => {
      if (n < 4) block.textContent = "가".repeat(++n);
      else document.querySelector('[data-test-id="send-button-container"]')?.remove();
    }, 30);
    await new GeminiSite(document, FAST).waitForCompletion();
    clearInterval(timer);
    expect(block.getAttribute("aria-busy")).toBe("true"); // 완료 후에도 남아 있음
    expect(Date.now() - started).toBeGreaterThanOrEqual(150);
  });

  it("중지 버튼이 남아 있으면(빈 입력창 + 컨테이너) 완료하지 않는다", async () => {
    html(INPUT + STOP + response("<p>계속</p>"));
    await expect(new GeminiSite(document, { ...FAST, completionTimeoutMs: 200 }).waitForCompletion()).rejects.toMatchObject({ code: "timeout" });
  });

  it("입력창에 텍스트가 있어 나타난 전송 버튼은 생성 중으로 보지 않는다", async () => {
    html(INPUT + SEND + response("<p>완료된 이전 답변</p>"));
    editor().classList.remove("ql-blank");
    await expect(new GeminiSite(document, FAST).waitForCompletion()).resolves.toBeUndefined();
  });

  it("마지막 응답의 본문만 마크다운으로 추출한다(사고 과정·'Gemini said' 제외)", async () => {
    html(response("<p>이전</p>") + response('<h2>계획</h2><p>내용 <strong>굵게</strong></p><ul><li>항목</li></ul>'));
    const answer = await new GeminiSite(document, FAST).extract();
    expect(answer.text).toBe("## 계획\n\n내용 **굵게**\n\n- 항목");
    expect(answer.text).not.toContain("생각 중");
    expect(answer.citations).toEqual([]);
  });

  it("출처는 응답 안의 외부 링크만 중복 없이 모으고 구글 링크는 제외한다", async () => {
    html(
      response(
        '<p>본문 <a href="https://a.com/1">a</a></p>',
        '<sources-list><a href="https://a.com/1">a</a><a href="https://b.com/2">b</a><a href="https://support.google.com/gemini">지원</a></sources-list>',
      ),
    );
    expect((await new GeminiSite(document, FAST).extract()).citations).toEqual(["https://a.com/1", "https://b.com/2"]);
  });

  it("웹 검색 답변: link-block의 링크를 모으되 utm_source=gemini를 지우고, 출처 칩(button)은 무시한다", async () => {
    html(
      response(
        '<response-element><i><p>뉴스 <link-block><a href="https://www.yna.co.kr/view/AKR1?utm_source=gemini">연합뉴스</a></link-block>' +
          '<source-inline-chip><button aria-label="View source details for citation from 연합뉴스">연합뉴스</button></source-inline-chip></p></i></response-element>',
      ),
    );
    const answer = await new GeminiSite(document, FAST).extract();
    expect(answer.citations).toEqual(["https://www.yna.co.kr/view/AKR1"]);
  });

  it("답변 영역이 없으면 selector_missing", async () => {
    html("<p>없음</p>");
    await expect(new GeminiSite(document, FAST).extract()).rejects.toMatchObject({ code: "selector_missing" });
  });
});
