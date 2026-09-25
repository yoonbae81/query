import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AddProviderToQuery } from "../src/application/addProviderToQuery";
import { AskQuery } from "../src/application/askQuery";
import { ClaimNextResult } from "../src/application/claimNextResult";
import { CleanupExpiredResults } from "../src/application/cleanupExpiredResults";
import { CompleteResult } from "../src/application/completeResult";
import { FailResult } from "../src/application/failResult";
import { GetQuery, ListQueries } from "../src/application/getQuery";
import { ManageSystemPrompt } from "../src/application/manageSystemPrompt";
import { RecordProgress } from "../src/application/recordProgress";
import { RetryResult } from "../src/application/retryResult";
import { SubmitQuery } from "../src/application/submitQuery";
import { SweepLeases } from "../src/application/sweepLeases";
import { FileSystemPrompt } from "../src/adapters/outbound/files/fileSystemPrompt";
import { FileAnswerStorage } from "../src/adapters/outbound/files/fileAnswerStorage";
import { InMemoryPresence } from "../src/adapters/outbound/presence/inMemoryPresence";
import { SqliteQueryRepository } from "../src/adapters/outbound/sqlite/sqliteQueryRepository";
import type { ExtensionNotifierPort } from "../src/domain/ports";

export const SUPPORTED = ["perplexity", "claude"];

export async function makeCore(opts: { maxRetry?: number; backoff?: number; leaseSeconds?: number } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "query-test-"));
  const repo = new SqliteQueryRepository(":memory:");
  await repo.init();
  const promptAdapter = new FileSystemPrompt(join(dir, "config", "system_prompt.md"));
  const storage = new FileAnswerStorage(join(dir, "answers"), "Asia/Seoul");
  const presence = new InMemoryPresence();
  const wakes = { count: 0 };
  const notifier: ExtensionNotifierPort = { wake: () => void wakes.count++ };
  const leaseSeconds = opts.leaseSeconds ?? 120;
  const fail = new FailResult(repo, opts.maxRetry ?? 2, opts.backoff ?? 30);
  const submit = new SubmitQuery(repo, SUPPORTED, ["perplexity"], 50, notifier);
  return {
    dir,
    repo,
    presence,
    wakes,
    prompt: new ManageSystemPrompt(promptAdapter),
    submit,
    addProvider: new AddProviderToQuery(repo, SUPPORTED, notifier),
    retry: new RetryResult(repo, notifier),
    getQuery: new GetQuery(repo),
    listQueries: new ListQueries(repo),
    claim: new ClaimNextResult(repo, promptAdapter, leaseSeconds),
    progress: new RecordProgress(repo, leaseSeconds),
    complete: new CompleteResult(repo, storage),
    fail,
    sweep: new SweepLeases(repo, fail),
    cleanup: new CleanupExpiredResults(repo, storage, 7),
    ask: new AskQuery(submit, repo, presence, 60, 300, 10),
  };
}
