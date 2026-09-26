import { mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { SqliteQueryRepository } from "../src/adapters/outbound/sqlite/sqliteQueryRepository";
import { DEFAULT_CATEGORY, normalizeCategory } from "../src/domain/category";
import { Conflict, InvalidRequest, NotFound } from "../src/domain/errors";
import { makeServer, type TestServer } from "./appHelpers";
import { makeCore } from "./helpers";

const CLIENT = "c1";

describe("카테고리 이름", () => {
  it("비어 있으면 general, 대소문자는 소문자로 통일한다", () => {
    expect(normalizeCategory(undefined)).toBe(DEFAULT_CATEGORY);
    expect(normalizeCategory("  ")).toBe(DEFAULT_CATEGORY);
    expect(normalizeCategory("Nuclear-Safety_1")).toBe("nuclear-safety_1");
    expect(normalizeCategory("원전")).toBe("원전");
  });

  it("경로 문자·점·공백·너무 긴 이름·예약어는 거절한다", () => {
    for (const bad of ["../etc", "a/b", "a\\b", "a.b", "a b", "-x", "x".repeat(33), "con", "COM1", "nul"]) {
      expect(() => normalizeCategory(bad), bad).toThrow(InvalidRequest);
    }
  });
});

describe("카테고리별 답변 작성 지침", () => {
  it("카테고리 프롬프트가 있으면 그것을, 없으면 general을 적용하고 스냅샷에 남긴다", async () => {
    const c = await makeCore();
    await c.prompts.put("general", "GENERAL");
    await c.prompts.put("legal", "LEGAL");

    const legal = await c.submit.submit("q1", undefined, undefined, "legal");
    const tech = await c.submit.submit("q2", undefined, undefined, "tech"); // 프롬프트 없는 카테고리
    const plain = await c.submit.submit("q3");

    expect((await c.claim.execute({ provider: "perplexity", clientId: CLIENT }))?.prompt).toBe("q1\n\n---\n\nLEGAL");
    expect((await c.claim.execute({ provider: "perplexity", clientId: CLIENT }))?.prompt).toBe("q2\n\n---\n\nGENERAL");
    expect((await c.claim.execute({ provider: "perplexity", clientId: CLIENT }))?.prompt).toBe("q3\n\n---\n\nGENERAL");
    expect((await c.repo.getResult(legal.results[0]!.id))?.systemPromptSnapshot).toBe("LEGAL");
    expect((await c.repo.getResult(tech.results[0]!.id))?.systemPromptSnapshot).toBe("GENERAL");
    expect(plain.query.category).toBe("general");
  });

  it("general도 없으면 질문만 전달한다", async () => {
    const c = await makeCore();
    await c.submit.submit("only");
    expect((await c.claim.execute({ provider: "perplexity", clientId: CLIENT }))?.prompt).toBe("only");
  });

  it("프롬프트는 등록 이후에 바뀌어도 claim 시점의 내용이 적용된다", async () => {
    const c = await makeCore();
    await c.submit.submit("q", undefined, undefined, "legal");
    await c.prompts.put("legal", "V2");
    expect((await c.claim.execute({ provider: "perplexity", clientId: CLIENT }))?.prompt).toBe("q\n\n---\n\nV2");
  });

  it("조회/저장/삭제: general은 삭제 불가, 없는 프롬프트는 404, 잘못된 이름은 400", async () => {
    const c = await makeCore();
    expect((await c.prompts.get("general")).content).toBe(""); // 파일이 없어도 general은 존재
    await expect(c.prompts.get("legal")).rejects.toBeInstanceOf(NotFound);
    await c.prompts.put("Legal", "L");
    expect((await c.prompts.get("legal")).content).toBe("L"); // 소문자로 통일
    await expect(c.prompts.remove("general")).rejects.toBeInstanceOf(Conflict);
    await c.prompts.remove("legal");
    await expect(c.prompts.remove("legal")).rejects.toBeInstanceOf(NotFound);
    await expect(c.prompts.put("../evil", "x")).rejects.toBeInstanceOf(InvalidRequest);
  });

  it("카테고리 목록은 프롬프트 파일과 질문에 쓰인 카테고리를 합치고 general이 맨 앞이다", async () => {
    const c = await makeCore();
    await c.prompts.put("zeta", "Z");
    await c.submit.submit("a", undefined, undefined, "alpha");
    await c.submit.submit("b", undefined, undefined, "alpha");
    await c.submit.submit("c");
    expect(await c.categories.execute()).toEqual([
      { category: "general", hasPrompt: false, queryCount: 1, promptSize: 0 },
      { category: "alpha", hasPrompt: false, queryCount: 2, promptSize: 0 },
      { category: "zeta", hasPrompt: true, queryCount: 0, promptSize: 1 },
    ]);
  });
});

describe("목록 필터와 답변 파일", () => {
  it("카테고리와 검색어로 질문 목록을 거르고 %·_는 문자 그대로 검색한다", async () => {
    const c = await makeCore();
    await c.submit.submit("원전 인허가", undefined, undefined, "legal");
    await c.submit.submit("변전소 100% 이용률");
    await c.submit.submit("변전소 100x 이용률");
    expect((await c.listQueries.execute({ category: "legal" })).items).toHaveLength(1);
    expect((await c.listQueries.execute({ search: "변전소" })).items).toHaveLength(2);
    expect((await c.listQueries.execute({ search: "100%" })).items.map((i) => i.query.queryText)).toEqual(["변전소 100% 이용률"]);
    expect((await c.listQueries.execute({ search: "_" })).items).toHaveLength(0);
    expect((await c.listQueries.execute({ category: "legal", search: "변전소" })).items).toHaveLength(0);
    await expect(c.listQueries.execute({ category: "../x" })).rejects.toBeInstanceOf(InvalidRequest);
  });

  it("집계는 질문 수와 상태별 결과 수를 센다", async () => {
    const c = await makeCore();
    await c.submit.submit("a");
    await c.submit.submit("b");
    const job = (await c.claim.execute({ provider: "perplexity", clientId: CLIENT }))!;
    await c.complete.execute({ resultId: job.resultId, clientId: CLIENT, answer: "x", citations: [] });
    expect(await c.repo.stats()).toEqual({ queries: 2, results: { pending: 1, processing: 0, done: 1, failed: 0 } });
  });

  it("답변 파일에는 카테고리가 기록되고 다운로드할 수 있다", async () => {
    const c = await makeCore();
    await c.prompts.put("legal", "LEGAL");
    const s = await c.submit.submit("Q?", undefined, undefined, "legal");
    const job = (await c.claim.execute({ provider: "perplexity", clientId: CLIENT }))!;
    await c.complete.execute({ resultId: job.resultId, clientId: CLIENT, answer: "ANS", citations: ["http://a"] });

    const file = await c.answerFile.execute(s.query.id, job.resultId);
    expect(file.filename).toMatch(/^\d{6}_[a-z0-9]{6}_perplexity\.md$/);
    expect(file.content).toContain("## 답변 작성 지침\nLEGAL");
    expect(file.content).toContain("category: legal");
    expect(readFileSync(join(c.dir, "answers", file.filename), "utf8")).toBe(file.content);

    await expect(c.answerFile.execute("q_other", job.resultId)).rejects.toBeInstanceOf(NotFound);
  });

  it("아직 답변이 없는 결과는 다운로드할 수 없다", async () => {
    const c = await makeCore();
    const s = await c.submit.submit("Q");
    await expect(c.answerFile.execute(s.query.id, s.results[0]!.id)).rejects.toBeInstanceOf(NotFound);
  });
});

describe("DB 마이그레이션", () => {
  it("category 컬럼이 없는 예전 DB를 열면 컬럼을 추가하고 기존 질문은 general이 된다", async () => {
    const dir = mkdtempSync(join(tmpdir(), "query-mig-"));
    mkdirSync(join(dir, "database"), { recursive: true });
    const path = join(dir, "database", "old.db");
    const old = new DatabaseSync(path);
    old.exec(`
      CREATE TABLE queries (id TEXT PRIMARY KEY, query_text TEXT NOT NULL, batch_id TEXT, providers TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE query_results (id TEXT PRIMARY KEY, query_id TEXT NOT NULL REFERENCES queries(id), provider TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending', progress_message TEXT, answer TEXT, citations TEXT, answer_file_path TEXT,
        system_prompt_snapshot TEXT, error_message TEXT, retry_count INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT,
        priority INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (query_id, provider));
      INSERT INTO queries VALUES ('q_old111', '예전 질문', NULL, '["perplexity"]', '2026-09-01T00:00:00.000Z');
    `);
    old.close();

    const repo = new SqliteQueryRepository(path);
    await repo.init();
    expect((await repo.getQuery("q_old111"))?.category).toBe("general");
    expect(await repo.listCategories()).toEqual([{ category: "general", count: 1 }]);
    repo.close();
  });
});

describe("REST: 카테고리·프롬프트·통계·다운로드", () => {
  let srv: TestServer;
  afterEach(async () => {
    await srv?.close();
  });

  it("질문 등록 시 category를 받고 목록/상세에 돌려준다", async () => {
    srv = await makeServer();
    const created = await srv.app.inject({ method: "POST", url: "/api/v1/queries", payload: { query: "q", category: "Legal" } });
    expect(created.statusCode).toBe(201);
    const id = created.json().query_id as string;
    expect((await srv.app.inject(`/api/v1/queries/${id}`)).json().category).toBe("legal");

    await srv.app.inject({ method: "POST", url: "/api/v1/queries", payload: { query: "plain" } });
    const list = (await srv.app.inject("/api/v1/queries?category=legal")).json();
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ category: "legal", answer_preview: null });
    expect((await srv.app.inject("/api/v1/queries?search=plain")).json().items).toHaveLength(1);

    const bulk = await srv.app.inject({ method: "POST", url: "/api/v1/queries/bulk", payload: { queries: ["a", "b"], category: "tech" } });
    expect(bulk.statusCode).toBe(201);
    expect((await srv.app.inject("/api/v1/queries?category=tech")).json().items).toHaveLength(2);

    const bad = await srv.app.inject({ method: "POST", url: "/api/v1/queries", payload: { query: "q", category: "../x" } });
    expect(bad.statusCode).toBe(400);
    expect((await srv.app.inject("/api/v1/queries?category=%2E%2E")).statusCode).toBe(400);
  });

  it("category를 생략하거나 비우면 개별/벌크/ask 모두 general이다", async () => {
    srv = await makeServer();
    const one = (await srv.app.inject({ method: "POST", url: "/api/v1/queries", payload: { query: "a" } })).json().query_id as string;
    const blank = (await srv.app.inject({ method: "POST", url: "/api/v1/queries", payload: { query: "b", category: "  " } })).json().query_id as string;
    const bulk = (await srv.app.inject({ method: "POST", url: "/api/v1/queries/bulk", payload: { queries: ["c", "d"] } })).json();
    const ask = (await srv.app.inject({ method: "POST", url: "/api/v1/ask?timeout_seconds=1", payload: { question: "e" } })).json().query_id as string;
    const ids = [one, blank, ...bulk.items.map((i: { query_id: string }) => i.query_id), ask];
    for (const id of ids) expect((await srv.app.inject(`/api/v1/queries/${id}`)).json().category).toBe("general");
  });

  it("프롬프트 API: 생성·조회·수정·삭제와 목록", async () => {
    srv = await makeServer();
    expect((await srv.app.inject("/api/v1/prompts/general")).json()).toMatchObject({ category: "general", content: "" });
    expect((await srv.app.inject("/api/v1/prompts/legal")).statusCode).toBe(404);

    const put = await srv.app.inject({ method: "PUT", url: "/api/v1/prompts/legal", payload: { content: "법률 관점" } });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({ category: "legal", content: "법률 관점" });
    expect(put.json().updated_at).toMatch(/\+09:00$/);
    expect(readFileSync(join(srv.dir, "prompts", "legal.md"), "utf8")).toBe("법률 관점");

    const cats = (await srv.app.inject("/api/v1/categories")).json().categories;
    expect(cats).toEqual([
      { category: "general", has_prompt: false, prompt_size: 0, query_count: 0 },
      { category: "legal", has_prompt: true, prompt_size: 5, query_count: 0 },
    ]);

    expect((await srv.app.inject({ method: "DELETE", url: "/api/v1/prompts/general" })).statusCode).toBe(409);
    expect((await srv.app.inject({ method: "DELETE", url: "/api/v1/prompts/legal" })).statusCode).toBe(204);
    expect((await srv.app.inject({ method: "DELETE", url: "/api/v1/prompts/legal" })).statusCode).toBe(404);
    expect((await srv.app.inject({ method: "PUT", url: "/api/v1/prompts/a.b", payload: { content: "x" } })).statusCode).toBe(400);
    expect((await srv.app.inject({ method: "PUT", url: "/api/v1/prompts/x", payload: { content: "x", extra: 1 } })).statusCode).toBe(400);
  });

  it("예전 /config/system-prompt는 general 프롬프트를 가리킨다", async () => {
    srv = await makeServer();
    await srv.app.inject({ method: "PUT", url: "/api/v1/config/system-prompt", payload: { content: "SYS" } });
    expect(readFileSync(join(srv.dir, "prompts", "general.md"), "utf8")).toBe("SYS");
    expect((await srv.app.inject("/api/v1/prompts/general")).json().content).toBe("SYS");
  });

  it("통계와 답변 파일 다운로드", async () => {
    srv = await makeServer();
    const c = srv.container;
    const s = await c.submit.submit("Q", undefined, undefined, "legal");
    expect((await srv.app.inject("/api/v1/stats")).json()).toEqual({
      queries: 1,
      results: { pending: 1, processing: 0, done: 0, failed: 0 },
    });
    const rid = s.results[0]!.id;
    expect((await srv.app.inject(`/api/v1/queries/${s.query.id}/results/${rid}/download`)).statusCode).toBe(404);

    const job = (await c.hub["deps"].claim.execute({ provider: "perplexity", clientId: "x" }))!;
    await c.hub["deps"].complete.execute({ resultId: job.resultId, clientId: "x", answer: "본문 **답**", citations: ["http://a"] });

    const dl = await srv.app.inject(`/api/v1/queries/${s.query.id}/results/${rid}/download`);
    expect(dl.statusCode).toBe(200);
    expect(dl.headers["content-type"]).toContain("text/markdown");
    expect(dl.headers["content-disposition"]).toMatch(/^attachment; filename="\d{6}_[a-z0-9]{6}_perplexity\.md"$/);
    expect(dl.body).toContain("본문 **답**");

    const list = (await srv.app.inject("/api/v1/queries")).json();
    expect(list.items[0].answer_preview).toBe("본문 답");
    expect((await srv.app.inject("/api/v1/stats")).json().results.done).toBe(1);
    expect((await srv.app.inject(`/api/v1/queries/q_none/results/${rid}/download`)).statusCode).toBe(404);
  });
});

it("기본 경로는 user/database 와 user/prompts 이다", async () => {
  const { loadSettings } = await import("../src/config");
  const s = loadSettings({}, "/root");
  expect(s.dbPath.replace(/\\/g, "/")).toMatch(/\/user\/database\/query\.db$/);
  expect(s.promptsDir.replace(/\\/g, "/")).toMatch(/\/user\/prompts$/);
});
