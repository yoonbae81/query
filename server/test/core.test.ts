import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { PRIORITY_HIGH } from "../src/domain/entities";
import { Conflict, InvalidRequest, NotFound } from "../src/domain/errors";
import { makeCore } from "./helpers";

const CLIENT = "c1";

describe("SubmitQuery", () => {
  it("기본 provider는 perplexity이고 질문을 trim한다", async () => {
    const c = await makeCore();
    const s = await c.submit.submit("  hello  ");
    expect(s.query.queryText).toBe("hello");
    expect(s.results.map((r) => r.provider)).toEqual(["perplexity"]);
    expect((await c.repo.getQuery(s.query.id))?.providers).toEqual(["perplexity"]);
    expect(c.wakes.count).toBe(1);
  });

  it("빈 질문, 길이 초과, 미지원 provider는 400 계열", async () => {
    const c = await makeCore();
    await expect(c.submit.submit("   ")).rejects.toBeInstanceOf(InvalidRequest);
    await expect(c.submit.submit("x".repeat(51))).rejects.toBeInstanceOf(InvalidRequest);
    await expect(c.submit.submit("q", ["gemini"])).rejects.toBeInstanceOf(InvalidRequest);
  });

  it("벌크는 빈 줄을 무시하고 batch_id를 공유하며 등록 순서를 유지한다", async () => {
    const c = await makeCore();
    const { batchId, items } = await c.submit.submitBulk(["a", "", "  ", "b", "c"], ["perplexity", "claude"]);
    expect(items).toHaveLength(3);
    expect(items.every((i) => i.query.batchId === batchId && i.results.length === 2)).toBe(true);
    await expect(c.submit.submitBulk(["", " "])).rejects.toBeInstanceOf(InvalidRequest);
    const page = await c.listQueries.execute({ limit: 10 });
    expect(page.items.map((i) => i.query.queryText)).toEqual(["c", "b", "a"]);
  });
});

describe("claim", () => {
  it("priority DESC → FIFO 순서로 provider 필터링하여 가져가고 임대를 설정한다", async () => {
    const c = await makeCore();
    await c.submit.submit("normal-1");
    await c.submit.submit("normal-2");
    await c.submit.submit("on-claude", ["claude"]);
    const high = await c.submit.submit("ask", undefined, PRIORITY_HIGH);

    const first = await c.claim.execute({ provider: "perplexity", clientId: CLIENT });
    expect(first?.resultId).toBe(high.results[0]!.id);
    const second = await c.claim.execute({ provider: "perplexity", clientId: CLIENT });
    expect(second?.prompt).toBe("normal-1");
    const claimed = await c.repo.getResult(first!.resultId);
    expect(claimed).toMatchObject({ status: "processing", claimedBy: CLIENT, progressMessage: "시작" });
    expect(claimed!.leaseExpiresAt!.getTime()).toBeGreaterThan(Date.now());
    expect((await c.claim.execute({ provider: "claude", clientId: CLIENT }))?.prompt).toBe("on-claude");
    expect((await c.claim.execute({ provider: "perplexity", clientId: CLIENT }))?.prompt).toBe("normal-2");
    expect(await c.claim.execute({ provider: "perplexity", clientId: CLIENT })).toBeNull();
  });

  it("시스템 프롬프트를 합쳐 전달하고 스냅샷을 기록한다(비어 있으면 질문만)", async () => {
    const c = await makeCore();
    const s = await c.submit.submit("Q");
    const noPrompt = await c.claim.execute({ provider: "perplexity", clientId: CLIENT });
    expect(noPrompt?.prompt).toBe("Q");

    await c.prompt.update("SYS");
    const s2 = await c.submit.submit("Q2");
    const job = await c.claim.execute({ provider: "perplexity", clientId: CLIENT });
    expect(job?.prompt).toBe("SYS\n\n---\n\nQ2");
    expect((await c.repo.getResult(s2.results[0]!.id))?.systemPromptSnapshot).toBe("SYS");
    expect((await c.repo.getResult(s.results[0]!.id))?.systemPromptSnapshot).toBe("");
  });
});

describe("완료/진행/실패 처리", () => {
  it("본인 임대가 아니면 progress/result를 무시한다", async () => {
    const c = await makeCore();
    await c.submit.submit("q");
    const job = (await c.claim.execute({ provider: "perplexity", clientId: CLIENT }))!;
    expect(await c.progress.execute({ resultId: job.resultId, clientId: "other", message: "x" })).toBe(false);
    expect(await c.complete.execute({ resultId: job.resultId, clientId: "other", answer: "a", citations: [] })).toBe(false);
    expect(await c.progress.execute({ resultId: job.resultId, clientId: CLIENT, message: "답변 대기 중" })).toBe(true);
    expect((await c.repo.getResult(job.resultId))?.progressMessage).toBe("답변 대기 중");
  });

  it("결과를 저장하면 done이 되고 KST 답변 파일이 생성된다", async () => {
    const c = await makeCore();
    await c.prompt.update("SYS");
    const s = await c.submit.submit("hello");
    const job = (await c.claim.execute({ provider: "perplexity", clientId: CLIENT }))!;
    expect(await c.complete.execute({ resultId: job.resultId, clientId: CLIENT, answer: "ANS", citations: ["http://src"] })).toBe(true);

    const r = (await c.repo.getResult(job.resultId))!;
    expect(r).toMatchObject({ status: "done", answer: "ANS", citations: ["http://src"], progressMessage: null, leaseExpiresAt: null });
    expect(r.answerFilePath).toMatch(new RegExp(`^answers/\\d{6}_${s.query.id}_perplexity\\.md$`));
    const text = readFileSync(join(c.dir, r.answerFilePath!), "utf8");
    expect(text).toContain("## Question\nhello");
    expect(text).toContain("## System Prompt\nSYS");
    expect(text).toContain("- http://src");
    expect(text).toMatch(/answered_at: .*\+09:00/);
    // 중복 제출은 무시
    expect(await c.complete.execute({ resultId: job.resultId, clientId: CLIENT, answer: "again", citations: [] })).toBe(false);
  });

  it("실패는 backoff 후 재시도하고 최초 1회 + 재시도 2회 뒤 failed가 된다", async () => {
    const c = await makeCore({ maxRetry: 2, backoff: 30 });
    const s = await c.submit.submit("q");
    const rid = s.results[0]!.id;
    const outcomes: string[] = [];
    for (let i = 0; i < 3; i++) {
      const later = new Date(Date.now() + i * 60_000 + 1000);
      const claimed = await c.repo.claimNext({ now: later, provider: "perplexity", claimedBy: CLIENT, leaseSeconds: 120 });
      expect(claimed?.id).toBe(rid);
      outcomes.push(await c.fail.execute({ resultId: rid, clientId: CLIENT, code: "timeout", message: "boom" }));
    }
    expect(outcomes).toEqual(["retry", "retry", "failed"]);
    const r = (await c.repo.getResult(rid))!;
    expect(r).toMatchObject({ status: "failed", retryCount: 3 });
    expect(r.errorMessage).toBe("timeout: boom");
  });

  it("재시도 대기(backoff) 중에는 claim되지 않는다", async () => {
    const c = await makeCore({ backoff: 30 });
    await c.submit.submit("q");
    const job = (await c.claim.execute({ provider: "perplexity", clientId: CLIENT }))!;
    await c.fail.execute({ resultId: job.resultId, clientId: CLIENT, code: "retryable", message: "x" });
    expect(await c.claim.execute({ provider: "perplexity", clientId: CLIENT })).toBeNull();
    expect(await c.repo.countClaimable(new Date())).toBe(0);
    expect(await c.repo.countClaimable(new Date(Date.now() + 31_000))).toBe(1);
  });

  it("login_required는 재시도 횟수를 늘리지 않고 pending으로 돌린다", async () => {
    const c = await makeCore();
    const s = await c.submit.submit("q");
    const job = (await c.claim.execute({ provider: "perplexity", clientId: CLIENT }))!;
    expect(await c.fail.execute({ resultId: job.resultId, clientId: CLIENT, code: "login_required", message: "로그인 필요" })).toBe("released");
    const r = (await c.repo.getResult(s.results[0]!.id))!;
    expect(r).toMatchObject({ status: "pending", retryCount: 0, claimedBy: null, leaseExpiresAt: null });
    expect((await c.claim.execute({ provider: "perplexity", clientId: CLIENT }))?.resultId).toBe(r.id);
  });

  it("수동 재시도: failed만 가능(409), 다른 query의 result는 404", async () => {
    const c = await makeCore({ maxRetry: 0 });
    const s = await c.submit.submit("q");
    const rid = s.results[0]!.id;
    await expect(c.retry.execute(s.query.id, rid)).rejects.toBeInstanceOf(Conflict);
    const job = (await c.claim.execute({ provider: "perplexity", clientId: CLIENT }))!;
    await c.fail.execute({ resultId: job.resultId, clientId: CLIENT, code: "timeout", message: "x" });
    expect((await c.repo.getResult(rid))?.status).toBe("failed");
    const r = await c.retry.execute(s.query.id, rid);
    expect(r).toMatchObject({ status: "pending", retryCount: 0, errorMessage: null });
    await expect(c.retry.execute("q_other", rid)).rejects.toBeInstanceOf(NotFound);
  });
});

describe("임대(lease)", () => {
  it("만료된 임대는 실패 1회로 간주되어 회수된다", async () => {
    const c = await makeCore({ leaseSeconds: 5 });
    const s = await c.submit.submit("q");
    const job = (await c.claim.execute({ provider: "perplexity", clientId: CLIENT }))!;
    expect(await c.sweep.execute(new Date())).toBe(0);
    expect(await c.sweep.execute(new Date(Date.now() + 6000))).toBe(1);
    const r = (await c.repo.getResult(job.resultId))!;
    expect(r).toMatchObject({ status: "pending", retryCount: 1 });
    expect(r.errorMessage).toContain("임대가 만료");
    expect(s.results[0]!.id).toBe(r.id);
  });

  it("progress는 임대를 연장하고, 연결 끊김은 임대를 즉시 만료시킨다", async () => {
    const c = await makeCore({ leaseSeconds: 5 });
    await c.submit.submit("q");
    const job = (await c.claim.execute({ provider: "perplexity", clientId: CLIENT }))!;
    const before = (await c.repo.getResult(job.resultId))!.leaseExpiresAt!.getTime();
    await new Promise((r) => setTimeout(r, 15));
    await c.progress.execute({ resultId: job.resultId, clientId: CLIENT, message: "x" });
    expect((await c.repo.getResult(job.resultId))!.leaseExpiresAt!.getTime()).toBeGreaterThan(before);

    expect(await c.repo.expireLeasesOf(CLIENT, new Date())).toBe(1);
    expect(await c.sweep.execute(new Date(Date.now() + 1))).toBe(1);
  });

  it("서버 기동 시 processing 잔여를 pending으로 복구한다(횟수 증가 없음)", async () => {
    const c = await makeCore();
    const s = await c.submit.submit("q");
    await c.claim.execute({ provider: "perplexity", clientId: CLIENT });
    expect(await c.repo.recoverProcessing()).toBe(1);
    expect(await c.repo.getResult(s.results[0]!.id)).toMatchObject({ status: "pending", retryCount: 0, claimedBy: null });
  });
});

describe("provider 추가 / 조회 / 정리", () => {
  it("provider 추가는 멱등이다", async () => {
    const c = await makeCore();
    const s = await c.submit.submit("q");
    const added = await c.addProvider.execute(s.query.id, ["claude", "perplexity"]);
    expect(added.map((r) => r.provider)).toEqual(["claude"]);
    expect(await c.addProvider.execute(s.query.id, ["claude"])).toEqual([]);
    expect((await c.repo.getQuery(s.query.id))?.providers).toEqual(["perplexity", "claude"]);
    await expect(c.addProvider.execute("q_missing", ["claude"])).rejects.toBeInstanceOf(NotFound);
    await expect(c.addProvider.execute(s.query.id, [])).rejects.toBeInstanceOf(InvalidRequest);
  });

  it("목록은 cursor로 이어지고 status 필터와 잘못된 cursor를 처리한다", async () => {
    const c = await makeCore();
    for (let i = 0; i < 5; i++) await c.submit.submit(`q${i}`);
    const p1 = await c.listQueries.execute({ limit: 2 });
    const p2 = await c.listQueries.execute({ limit: 2, cursor: p1.nextCursor! });
    const p3 = await c.listQueries.execute({ limit: 2, cursor: p2.nextCursor! });
    const ids = [...p1.items, ...p2.items, ...p3.items].map((i) => i.query.id);
    expect(new Set(ids).size).toBe(5);
    expect(p3.nextCursor).toBeNull();
    expect((await c.listQueries.execute({ status: "done", limit: 10 })).items).toEqual([]);
    await expect(c.listQueries.execute({ limit: 500 })).rejects.toBeInstanceOf(InvalidRequest);
    await expect(c.listQueries.execute({ status: "nope" })).rejects.toBeInstanceOf(InvalidRequest);
    await expect(c.listQueries.execute({ limit: 5, cursor: "%%bad" })).rejects.toBeInstanceOf(InvalidRequest);
  });

  it("보관 기간이 지난 결과와 파일을 삭제하고 빈 query도 삭제한다", async () => {
    const c = await makeCore();
    const s = await c.submit.submit("q");
    const job = (await c.claim.execute({ provider: "perplexity", clientId: CLIENT }))!;
    await c.complete.execute({ resultId: job.resultId, clientId: CLIENT, answer: "a", citations: [] });
    const file = join(c.dir, (await c.repo.getResult(job.resultId))!.answerFilePath!);
    expect(existsSync(file)).toBe(true);

    expect(await c.cleanup.execute()).toBe(0);
    expect(await c.cleanup.execute(new Date(Date.now() + 8 * 86_400_000))).toBe(1);
    expect(existsSync(file)).toBe(false);
    expect(await c.repo.getQuery(s.query.id)).toBeNull();
  });
});

describe("AskQuery", () => {
  it("provider가 offline이면 기다리지 않고 note와 함께 pending을 반환한다", async () => {
    const c = await makeCore();
    const started = Date.now();
    const out = await c.ask.execute({ question: "hi", timeoutSeconds: 30 });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(out.results[0]?.status).toBe("pending");
    expect(out.results[0]?.priority).toBe(PRIORITY_HIGH);
    expect(out.note).toContain("perplexity");
    await expect(c.ask.execute({ question: "hi", timeoutSeconds: 0 })).rejects.toBeInstanceOf(InvalidRequest);
  });

  it("online이면 완료될 때까지 기다린다", async () => {
    const c = await makeCore();
    c.presence.connect(CLIENT, [["perplexity", "ready"]]);
    const worker = (async () => {
      for (let i = 0; i < 200; i++) {
        const job = await c.claim.execute({ provider: "perplexity", clientId: CLIENT });
        if (job) return c.complete.execute({ resultId: job.resultId, clientId: CLIENT, answer: "A", citations: ["u"] });
        await new Promise((r) => setTimeout(r, 10));
      }
    })();
    const out = await c.ask.execute({ question: "hi", timeoutSeconds: 5 });
    await worker;
    expect(out.note).toBeUndefined();
    expect(out.results[0]).toMatchObject({ status: "done", answer: "A" });
  });

  it("online이지만 시간 내 끝나지 않으면 processing/pending과 note를 반환한다", async () => {
    const c = await makeCore();
    c.presence.connect(CLIENT, [["perplexity", "ready"]]);
    const out = await c.ask.execute({ question: "hi", timeoutSeconds: 0.2 });
    expect(out.results[0]?.status).toBe("pending");
    expect(out.note).toContain("시간 내 완료되지 않았습니다");
  });
});
