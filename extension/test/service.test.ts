import { describe, expect, it } from "vitest";

import { normalizeSettings, toWebSocketUrl } from "../src/application/updateSettings";
import { CLAUDE, PERPLEXITY, SiteError, makeHarness, settle, type Harness } from "./fakes";

async function online(h: Harness, opts: { tab?: boolean } = {}): Promise<void> {
  if (opts.tab !== false) h.tabs.tabs.set("perplexity", { id: 7, url: "https://www.perplexity.ai/" });
  await h.service.init();
  await h.service.setActive(true);
  h.gateway.open();
  await settle();
}

describe("연결과 hello", () => {
  it("OFF이면 서버에 연결하지 않고, ON이면 저장된 설정으로 연결한다", async () => {
    const h = makeHarness();
    await h.service.init();
    expect(h.gateway.connectCalls).toBe(0);
    await h.service.setActive(true);
    expect(h.gateway.connectedWith?.serverUrl).toBe("http://server:8000");
    expect(h.store.active).toBe(true);
    await h.service.setActive(false);
    expect(h.gateway.disconnectCalls).toBe(1);
    expect(h.store.active).toBe(false);
  });

  it("서비스 워커 재시작 시 저장된 ON 상태로 자동 재연결한다", async () => {
    const h = makeHarness({ active: true });
    await h.service.init();
    expect(h.gateway.connectCalls).toBe(1);
    expect(h.service.getStatus().active).toBe(true);
  });

  it("서버 주소가 없으면 연결하지 않고 오류 상태를 남긴다", async () => {
    const h = makeHarness({ active: true });
    h.store.settings.serverUrl = "";
    await h.service.init();
    expect(h.gateway.connectCalls).toBe(0);
    expect(h.service.getStatus().lastError).toContain("서버 주소");
  });

  it("연결되면 탭/로그인 상태를 hello로 알린다", async () => {
    const h = makeHarness({ registry: [PERPLEXITY, CLAUDE] });
    h.tabs.tabs.set("perplexity", { id: 1, url: "https://www.perplexity.ai/" });
    h.tabs.tabs.set("claude", { id: 2, url: "https://claude.ai/" });
    h.site.loggedIn.set("claude", false);
    await h.service.init();
    await h.service.setActive(true);
    h.gateway.open();
    await settle();
    expect(h.gateway.ofType("hello")[0]).toEqual({
      type: "hello",
      client_id: "client-1",
      version: "test",
      providers: [
        { id: "perplexity", state: "ready" },
        { id: "claude", state: "login_required" },
      ],
    });
    expect(h.service.getStatus().providers.map((p) => p.state)).toEqual(["ready", "login_required"]);
  });

  it("탭이 없으면 no_tab이다", async () => {
    const h = makeHarness();
    await online(h, { tab: false });
    expect(h.gateway.ofType("hello")[0]?.providers).toEqual([{ id: "perplexity", state: "no_tab" }]);
    expect(h.gateway.ofType("claim")).toHaveLength(0);
  });

  it("탭 변화로 상태가 바뀔 때만 state를 보낸다", async () => {
    const h = makeHarness();
    await online(h, { tab: false });
    h.gateway.sent.length = 0;

    h.tabs.fireChanged();
    await settle();
    expect(h.gateway.ofType("state")).toHaveLength(0); // 변화 없음

    h.tabs.tabs.set("perplexity", { id: 3, url: "https://www.perplexity.ai/" });
    h.tabs.fireChanged();
    await settle();
    expect(h.gateway.ofType("state")).toEqual([{ type: "state", providers: [{ id: "perplexity", state: "ready" }] }]);
    expect(h.gateway.ofType("claim")).toHaveLength(1); // ready가 되면 곧바로 claim
  });
});

describe("작업 처리", () => {
  it("ready이면 claim하고, job을 받으면 새 대화로 이동해 질의 후 결과를 보낸다", async () => {
    const h = makeHarness();
    await online(h);
    expect(h.gateway.ofType("claim")).toEqual([{ type: "claim", provider: "perplexity" }]);

    h.gateway.receive({ type: "job", result_id: "r_1", provider: "perplexity", prompt: "P", lease_seconds: 120 });
    await settle();

    expect(h.tabs.navigated).toEqual([{ tab: { id: 7, url: "https://www.perplexity.ai/" }, url: "https://www.perplexity.ai/" }]);
    expect(h.site.submitted).toEqual(["P"]);
    // hello 감지 → 이동 후 로그인 확인 → 질의/대기/추출 → 작업 후 상태 재감지
    expect(h.site.calls).toEqual(["isLoggedIn", "isLoggedIn", "submit", "wait", "extract", "isLoggedIn"]);
    expect(h.gateway.ofType("progress").map((m) => m.message)).toEqual(["질의 전송 중", "답변 대기 중", "답변 추출 중"]);
    expect(h.gateway.ofType("result")).toEqual([
      { type: "result", result_id: "r_1", answer: "ANS", citations: ["http://s"] },
    ]);
    expect(h.service.getStatus().currentJob).toBeNull();
  });

  it("작업 사이에 최소 질의 간격을 둔 뒤 다음 claim을 보낸다", async () => {
    const h = makeHarness();
    await online(h);
    h.gateway.receive({ type: "job", result_id: "r_1", provider: "perplexity", prompt: "P", lease_seconds: 120 });
    await settle();
    expect(h.clock.sleeps).toEqual([10_000]);
    expect(h.gateway.ofType("claim")).toHaveLength(2);
  });

  it("idle이면 wake가 올 때까지 다시 claim하지 않는다", async () => {
    const h = makeHarness();
    await online(h);
    h.gateway.receive({ type: "idle", provider: "perplexity" });
    await settle();
    expect(h.gateway.ofType("claim")).toHaveLength(1);
    h.gateway.receive({ type: "wake" });
    await settle();
    expect(h.gateway.ofType("claim")).toHaveLength(2);
  });

  it("처리 중 wake는 무시한다(순차 처리)", async () => {
    const h = makeHarness();
    let release!: () => void;
    h.site.waitGate = new Promise<void>((r) => (release = r));
    await online(h);
    h.gateway.receive({ type: "job", result_id: "r_1", provider: "perplexity", prompt: "P", lease_seconds: 120 });
    await settle();
    expect(h.service.getStatus().currentJob).toMatchObject({ resultId: "r_1", message: "답변 대기 중" });

    h.gateway.receive({ type: "wake" });
    await settle();
    expect(h.gateway.ofType("claim")).toHaveLength(1);

    release();
    await settle();
    expect(h.gateway.ofType("result")).toHaveLength(1);
  });

  it("OFF이거나 연결이 끊긴 상태에서는 claim하지 않는다", async () => {
    const h = makeHarness();
    await h.service.init();
    h.gateway.open(); // active=false
    await settle();
    expect(h.gateway.ofType("claim")).toHaveLength(0);
  });

  it("여러 provider는 ready인 것에 순서대로 claim한다", async () => {
    const h = makeHarness({ registry: [PERPLEXITY, CLAUDE] });
    h.tabs.tabs.set("perplexity", { id: 1, url: "x" });
    h.tabs.tabs.set("claude", { id: 2, url: "y" });
    await h.service.init();
    await h.service.setActive(true);
    h.gateway.open();
    await settle();
    expect(h.gateway.ofType("claim").map((c) => c.provider)).toEqual(["perplexity"]);
    h.gateway.receive({ type: "idle", provider: "perplexity" });
    await settle();
    expect(h.gateway.ofType("claim").map((c) => c.provider)).toEqual(["perplexity", "claude"]);
  });
});

describe("오류 보고", () => {
  async function runFailing(h: Harness, step: "submit" | "wait" | "extract" | "isLoggedIn", error: Error) {
    await online(h);
    h.site.failAt = { step, error };
    h.gateway.receive({ type: "job", result_id: "r_1", provider: "perplexity", prompt: "P", lease_seconds: 120 });
    await settle();
    return h.gateway.ofType("error");
  }

  it("SiteError의 code를 그대로 보고한다", async () => {
    const errors = await runFailing(makeHarness(), "submit", new SiteError("selector_missing", "입력창 없음"));
    expect(errors).toEqual([{ type: "error", result_id: "r_1", code: "selector_missing", message: "입력창 없음" }]);
  });

  it("타임아웃도 보고하고 결과는 보내지 않는다", async () => {
    const h = makeHarness();
    const errors = await runFailing(h, "wait", new SiteError("timeout", "답변 미완료"));
    expect(errors[0]?.code).toBe("timeout");
    expect(h.gateway.ofType("result")).toHaveLength(0);
    expect(h.service.getStatus().lastError).toBe("timeout: 답변 미완료");
  });

  it("알 수 없는 예외는 retryable로 보고한다", async () => {
    const errors = await runFailing(makeHarness(), "extract", new Error("boom"));
    expect(errors[0]).toMatchObject({ code: "retryable", message: "boom" });
  });

  it("이동 후 로그아웃 상태이면 login_required를 보고하고 상태를 갱신한다", async () => {
    const h = makeHarness();
    await online(h);
    h.site.loggedIn.set("perplexity", false);
    h.gateway.receive({ type: "job", result_id: "r_1", provider: "perplexity", prompt: "P", lease_seconds: 120 });
    await settle();
    expect(h.gateway.ofType("error")[0]).toMatchObject({ code: "login_required" });
    expect(h.gateway.ofType("state").at(-1)?.providers).toEqual([{ id: "perplexity", state: "login_required" }]);
    expect(h.site.submitted).toEqual([]);
    // login_required 상태에서는 새 claim을 보내지 않는다
    expect(h.gateway.ofType("claim")).toHaveLength(1);
  });

  it("작업 중 탭이 사라지면 retryable로 보고한다", async () => {
    const h = makeHarness();
    await online(h);
    h.tabs.tabs.delete("perplexity");
    h.gateway.receive({ type: "job", result_id: "r_1", provider: "perplexity", prompt: "P", lease_seconds: 120 });
    await settle();
    expect(h.gateway.ofType("error")[0]).toMatchObject({ code: "retryable", message: expect.stringContaining("탭이 없습니다") });
  });

  it("빈 답변은 selector_missing으로 보고한다", async () => {
    const h = makeHarness();
    await online(h);
    h.site.answer = { text: "  ", citations: [] };
    h.gateway.receive({ type: "job", result_id: "r_1", provider: "perplexity", prompt: "P", lease_seconds: 120 });
    await settle();
    expect(h.gateway.ofType("error")[0]).toMatchObject({ code: "selector_missing" });
  });

  it("서버의 protocol_error는 상태에 남긴다", async () => {
    const h = makeHarness();
    await online(h);
    h.gateway.receive({ type: "protocol_error", message: "임대 중인 작업이 아닙니다." });
    expect(h.service.getStatus().lastError).toBe("임대 중인 작업이 아닙니다.");
  });
});

describe("설정", () => {
  it("설정을 정규화하고 ON 상태면 재연결한다", async () => {
    const h = makeHarness({ active: true });
    await h.service.init();
    const saved = await h.service.saveSettings({ serverUrl: " https://host/query/ ", authToken: " t ", minIntervalSeconds: 5 });
    expect(saved).toEqual({ serverUrl: "https://host/query", authToken: "t", minIntervalSeconds: 5 });
    expect(h.store.settings).toEqual(saved);
    expect(h.gateway.disconnectCalls).toBe(1);
    expect(h.gateway.connectedWith).toEqual(saved);
  });

  it("잘못된 설정은 거절한다", () => {
    const base = { serverUrl: "http://x", authToken: "", minIntervalSeconds: 10 };
    expect(() => normalizeSettings({ ...base, serverUrl: "ftp://x" })).toThrow("http");
    expect(() => normalizeSettings({ ...base, serverUrl: "not a url" })).toThrow("형식");
    expect(() => normalizeSettings({ ...base, minIntervalSeconds: -1 })).toThrow("간격");
    expect(normalizeSettings({ ...base, serverUrl: "" }).serverUrl).toBe("");
  });

  it("서버 주소를 WebSocket 주소로 변환한다", () => {
    const s = { serverUrl: "https://host/query", authToken: "", minIntervalSeconds: 10 };
    expect(toWebSocketUrl(s)).toBe("wss://host/query/ext/ws");
    expect(toWebSocketUrl({ ...s, serverUrl: "http://localhost:8000", authToken: "a b" })).toBe(
      "ws://localhost:8000/ext/ws?token=a+b",
    );
  });
});
