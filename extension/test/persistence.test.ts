import { describe, expect, it } from "vitest";

import type { PersistedState } from "../src/domain/model";
import { makeHarness, settle } from "./fakes";

function persisted(overrides: Partial<PersistedState> = {}): PersistedState {
  return {
    status: { active: false, connection: "disconnected", providers: [], currentJob: null, lastError: null },
    lastFinishedAt: 0,
    inFlightJob: null,
    logs: [],
    ...overrides,
  };
}

describe("서비스 워커 재시작 내성", () => {
  it("재시작해도 마지막 작업 종료 시각을 복원해 최소 질의 간격을 지킨다", async () => {
    const h = makeHarness({ active: true });
    h.clock.time = 1_000_000;
    h.tabs.tabs.set("perplexity", { id: 7, url: "https://www.perplexity.ai/" });
    h.session.state = persisted({
      status: {
        active: true,
        connection: "disconnected",
        providers: [{ id: "perplexity", name: "Perplexity", state: "ready" }],
        currentJob: null,
        lastError: null,
      },
      lastFinishedAt: 995_000, // 5초 전에 끝났다 → 최소 간격 10초 중 5초를 더 기다려야 한다
    });

    await h.service.init();
    h.gateway.open();
    await settle();

    expect(h.clock.sleeps).toEqual([5_000]);
    expect(h.gateway.ofType("claim")).toHaveLength(1);
  });

  it("처리 중이던 작업은 재개하지 않고 유실 로그만 남긴다(서버 임대 회수가 복구 주체)", async () => {
    const h = makeHarness({ active: true });
    h.session.state = persisted({
      inFlightJob: { resultId: "r_9", provider: "perplexity", startedAt: 100 },
    });

    await h.service.init();
    h.gateway.open();
    await settle();

    const logs = h.service.getLogs();
    expect(logs.some((l) => l.category === "JOB" && l.message.includes("r_9"))).toBe(true);
    expect(h.service.getStatus().currentJob).toBeNull();
    // 서버에 추측성 오류/결과를 보내지 않는다
    expect(h.gateway.ofType("error")).toHaveLength(0);
    expect(h.gateway.ofType("result")).toHaveLength(0);
  });

  it("상태 변화를 저장소에 미러링한다", async () => {
    const h = makeHarness({ active: true });
    await h.service.init();
    h.gateway.open();
    await settle();

    expect(h.session.saves).toBeGreaterThan(0);
    expect(h.session.state?.status.connection).toBe("connected");
    expect(h.session.state?.status.active).toBe(true);
  });
});

describe("작업 영속화", () => {
  it("작업을 시작하고 끝낼 때 세션에 기록한다", async () => {
    const h = makeHarness();
    h.tabs.tabs.set("perplexity", { id: 7, url: "https://www.perplexity.ai/" });
    await h.service.init();
    await h.service.setActive(true);
    h.gateway.open();
    await settle();

    h.gateway.receive({ type: "job", result_id: "r_1", provider: "perplexity", prompt: "P", lease_seconds: 120 });
    await settle();

    const saved = h.session.state!;
    expect(saved.lastFinishedAt).toBeGreaterThan(0);
    expect(saved.inFlightJob).toBeNull(); // 끝났으므로 비어 있다
    const messages = saved.logs.filter((l) => l.category === "JOB").map((l) => l.message);
    expect(messages.some((m) => m.startsWith("시작"))).toBe(true);
    expect(messages.some((m) => m.startsWith("완료"))).toBe(true);
  });

  it("작업 처리 중에는 처리 중인 작업이 세션에 남는다", async () => {
    const h = makeHarness();
    let release!: () => void;
    h.site.waitGate = new Promise<void>((r) => (release = r));
    h.tabs.tabs.set("perplexity", { id: 7, url: "https://www.perplexity.ai/" });
    await h.service.init();
    await h.service.setActive(true);
    h.gateway.open();
    await settle();

    h.gateway.receive({ type: "job", result_id: "r_2", provider: "perplexity", prompt: "P", lease_seconds: 120 });
    await settle();

    expect(h.session.state?.inFlightJob).toMatchObject({ resultId: "r_2", provider: "perplexity" });

    release();
    await settle();
    expect(h.session.state?.inFlightJob).toBeNull();
  });
});

describe("진단 로그", () => {
  it("상태 변화를 분류와 함께 기록하고 지울 수 있다", async () => {
    const h = makeHarness();
    await h.service.init();
    await h.service.setActive(true);
    await settle();

    const logs = h.service.getLogs();
    expect(logs.some((l) => l.category === "CONN" && l.message === "사용 ON")).toBe(true);

    h.service.clearLogs();
    expect(h.service.getLogs()).toEqual([]);
    expect(h.session.state?.logs).toEqual([]);
  });
});
