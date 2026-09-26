import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { newQueryResult } from "../src/domain/entities";
import { Conflict, NotFound } from "../src/domain/errors";
import { DeleteResults } from "../src/application/deleteResults";
import { FileAnswerStorage } from "../src/adapters/outbound/files/fileAnswerStorage";
import { makeServer, type TestServer } from "./appHelpers";
import { makeCore } from "./helpers";

const CLIENT = "c1";

/** perplexity·claude 두 provider로 질문을 만들고 각각 완료 처리한다 */
async function twoDone(c: Awaited<ReturnType<typeof makeCore>>) {
  const s = await c.submit.submit("Q", ["perplexity", "claude"]);
  const files: string[] = [];
  for (const provider of ["perplexity", "claude"]) {
    const job = (await c.claim.execute({ provider, clientId: CLIENT }))!;
    await c.complete.execute({ resultId: job.resultId, clientId: CLIENT, answer: `A-${provider}`, citations: [] });
    files.push(join(c.dir, (await c.repo.getResult(job.resultId))!.answerFilePath!));
  }
  return { s, files };
}

function deleter(c: Awaited<ReturnType<typeof makeCore>>) {
  return new DeleteResults(c.repo, new FileAnswerStorage(join(c.dir, "answers"), "Asia/Seoul"));
}

describe("DeleteResults", () => {
  it("provider 결과 하나를 삭제하면 그 답변 파일과 결과만 지워지고 provider 목록이 갱신된다", async () => {
    const c = await makeCore();
    const { s, files } = await twoDone(c);
    const [pplx, claude] = s.results;

    expect(await deleter(c).deleteResult(s.query.id, pplx!.id)).toEqual({ queryDeleted: false });
    expect(existsSync(files[0]!)).toBe(false);
    expect(existsSync(files[1]!)).toBe(true);
    expect(await c.repo.getResult(pplx!.id)).toBeNull();
    expect(await c.repo.getResult(claude!.id)).not.toBeNull();
    expect((await c.repo.getQuery(s.query.id))?.providers).toEqual(["claude"]);

    // 삭제한 provider는 다시 질의할 수 있다
    const added = await c.addProvider.execute(s.query.id, ["perplexity"]);
    expect(added.map((r) => r.provider)).toEqual(["perplexity"]);
    expect((await c.repo.getQuery(s.query.id))?.providers).toEqual(["claude", "perplexity"]);
  });

  it("마지막 결과를 삭제하면 질문도 함께 삭제된다", async () => {
    const c = await makeCore();
    const s = await c.submit.submit("Q");
    const job = (await c.claim.execute({ provider: "perplexity", clientId: CLIENT }))!;
    await c.complete.execute({ resultId: job.resultId, clientId: CLIENT, answer: "A", citations: [] });
    expect(await deleter(c).deleteResult(s.query.id, job.resultId)).toEqual({ queryDeleted: true });
    expect(await c.repo.getQuery(s.query.id)).toBeNull();
  });

  it("질문 전체를 삭제하면 모든 provider 결과와 답변 파일이 지워진다", async () => {
    const c = await makeCore();
    const { s, files } = await twoDone(c);
    await deleter(c).deleteQuery(s.query.id);
    expect(await c.repo.getQuery(s.query.id)).toBeNull();
    expect(await c.repo.getResults(s.query.id)).toEqual([]);
    for (const f of files) expect(existsSync(f)).toBe(false);
    expect((await c.repo.stats()).queries).toBe(0);
  });

  it("pending/failed 결과도 삭제할 수 있다", async () => {
    const c = await makeCore({ maxRetry: 0 });
    const s = await c.submit.submit("Q", ["perplexity", "claude"]);
    const job = (await c.claim.execute({ provider: "perplexity", clientId: CLIENT }))!;
    await c.fail.execute({ resultId: job.resultId, clientId: CLIENT, code: "timeout", message: "x" });
    expect((await c.repo.getResult(job.resultId))?.status).toBe("failed");
    await deleter(c).deleteResult(s.query.id, job.resultId); // failed
    await deleter(c).deleteQuery(s.query.id); // 남은 claude는 pending
    expect(await c.repo.getQuery(s.query.id)).toBeNull();
  });

  it("처리 중(processing)인 결과가 있으면 삭제할 수 없고 아무것도 지우지 않는다", async () => {
    const c = await makeCore();
    const { s } = await twoDone(c);
    const extra = newQueryResult(s.query.id, "gemini", 0);
    await c.repo.addResults(s.query.id, [extra]);
    await c.repo.claimNext({ now: new Date(), provider: "gemini", claimedBy: CLIENT, leaseSeconds: 60 });

    await expect(deleter(c).deleteResult(s.query.id, extra.id)).rejects.toBeInstanceOf(Conflict);
    await expect(deleter(c).deleteQuery(s.query.id)).rejects.toBeInstanceOf(Conflict);
    expect((await c.repo.getResults(s.query.id)).length).toBe(3); // 파일·결과 모두 그대로
    expect(await c.repo.getQuery(s.query.id)).not.toBeNull();
  });

  it("없는 질문/결과, 다른 질문의 결과는 404", async () => {
    const c = await makeCore();
    const a = await c.submit.submit("A");
    const b = await c.submit.submit("B");
    await expect(deleter(c).deleteQuery("q_none")).rejects.toBeInstanceOf(NotFound);
    await expect(deleter(c).deleteResult(a.query.id, "r_none")).rejects.toBeInstanceOf(NotFound);
    await expect(deleter(c).deleteResult(a.query.id, b.results[0]!.id)).rejects.toBeInstanceOf(NotFound);
    expect(await c.repo.getQuery(b.query.id)).not.toBeNull();
  });
});

describe("REST 삭제", () => {
  let srv: TestServer;
  afterEach(async () => {
    await srv?.close();
  });

  async function seed() {
    const s = await srv.container.submit.submit("Q");
    const extra = newQueryResult(s.query.id, "claude", 0);
    await srv.container.repo.addResults(s.query.id, [extra]);
    return { qid: s.query.id, r1: s.results[0]!.id, r2: extra.id };
  }

  it("DELETE /queries/{id}는 204로 질문 전체를 삭제한다", async () => {
    srv = await makeServer();
    const { qid } = await seed();
    const r = await srv.app.inject({ method: "DELETE", url: `/api/v1/queries/${qid}` });
    expect(r.statusCode).toBe(204);
    expect((await srv.app.inject(`/api/v1/queries/${qid}`)).statusCode).toBe(404);
    expect((await srv.app.inject({ method: "DELETE", url: `/api/v1/queries/${qid}` })).statusCode).toBe(404);
  });

  it("DELETE /queries/{id}/results/{rid}는 결과 하나를 지우고 query_deleted를 알려준다", async () => {
    srv = await makeServer();
    const { qid, r1, r2 } = await seed();
    const first = await srv.app.inject({ method: "DELETE", url: `/api/v1/queries/${qid}/results/${r1}` });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ query_deleted: false });
    const detail = (await srv.app.inject(`/api/v1/queries/${qid}`)).json();
    expect(detail.results.map((r: { result_id: string }) => r.result_id)).toEqual([r2]);

    const last = await srv.app.inject({ method: "DELETE", url: `/api/v1/queries/${qid}/results/${r2}` });
    expect(last.json()).toEqual({ query_deleted: true });
    expect((await srv.app.inject(`/api/v1/queries/${qid}`)).statusCode).toBe(404);
  });

  it("처리 중이면 409, 없으면 404", async () => {
    srv = await makeServer();
    const { qid, r1 } = await seed();
    await srv.container.repo.claimNext({ now: new Date(), provider: "perplexity", claimedBy: "x", leaseSeconds: 60 });
    const busy = await srv.app.inject({ method: "DELETE", url: `/api/v1/queries/${qid}/results/${r1}` });
    expect(busy.statusCode).toBe(409);
    expect(busy.json().error.code).toBe("CONFLICT");
    expect((await srv.app.inject({ method: "DELETE", url: `/api/v1/queries/${qid}` })).statusCode).toBe(409);
    expect((await srv.app.inject({ method: "DELETE", url: `/api/v1/queries/${qid}/results/r_none` })).statusCode).toBe(404);
  });
});
