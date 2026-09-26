import { ExtensionHub } from "./adapters/inbound/extension/extensionHub";
import { FileAnswerStorage } from "./adapters/outbound/files/fileAnswerStorage";
import { FilePromptStore } from "./adapters/outbound/files/filePromptStore";
import { InMemoryPresence } from "./adapters/outbound/presence/inMemoryPresence";
import { SqliteQueryRepository } from "./adapters/outbound/sqlite/sqliteQueryRepository";
import { AddProviderToQuery } from "./application/addProviderToQuery";
import { GetAnswerFile, GetStats } from "./application/answerFile";
import { ListCategories, ManagePrompts } from "./application/prompts";
import { AskQuery } from "./application/askQuery";
import { ClaimNextResult } from "./application/claimNextResult";
import { CleanupExpiredResults } from "./application/cleanupExpiredResults";
import { CompleteResult } from "./application/completeResult";
import { FailResult } from "./application/failResult";
import { GetQuery, ListQueries } from "./application/getQuery";
import { RecordProgress } from "./application/recordProgress";
import { RetryResult } from "./application/retryResult";
import { SubmitQuery } from "./application/submitQuery";
import { SweepLeases } from "./application/sweepLeases";
import type { Settings } from "./config";
import type { ExtensionNotifierPort, QueryRepositoryPort } from "./domain/ports";

/** 지원 provider의 표시 이름 (PLAN §4.2). 실제 지원 여부는 settings.supportedProviders */
export const PROVIDER_NAMES: Record<string, string> = {
  perplexity: "Perplexity",
  claude: "Claude",
  gemini: "Gemini",
  chatgpt: "ChatGPT",
};

export interface Container {
  settings: Settings;
  repo: QueryRepositoryPort;
  presence: InMemoryPresence;
  hub: ExtensionHub;
  submit: SubmitQuery;
  addProvider: AddProviderToQuery;
  retry: RetryResult;
  ask: AskQuery;
  getQuery: GetQuery;
  listQueries: ListQueries;
  prompts: ManagePrompts;
  categories: ListCategories;
  stats: GetStats;
  answerFile: GetAnswerFile;
  sweepLeases: SweepLeases;
  cleanup: CleanupExpiredResults;
}

/** hub는 유스케이스를 필요로 하고 유스케이스는 hub(wake)를 필요로 하므로 늦게 연결한다. */
class LateNotifier implements ExtensionNotifierPort {
  target?: ExtensionNotifierPort;
  wake(): void {
    this.target?.wake();
  }
}

export function buildContainer(settings: Settings, repo: QueryRepositoryPort = new SqliteQueryRepository(settings.dbPath)): Container {
  const promptStore = new FilePromptStore(settings.promptsDir);
  const storage = new FileAnswerStorage(settings.answersDir, settings.displayTimezone);
  const presence = new InMemoryPresence();
  const notifier = new LateNotifier();

  const submit = new SubmitQuery(repo, settings.supportedProviders, settings.defaultProviders, settings.maxQueryLength, notifier);
  const fail = new FailResult(repo, settings.maxRetry, settings.retryBackoffSeconds);
  const hub = new ExtensionHub({
    repo,
    presence,
    claim: new ClaimNextResult(repo, promptStore, settings.leaseSeconds),
    progress: new RecordProgress(repo, settings.leaseSeconds),
    complete: new CompleteResult(repo, storage),
    fail,
    supportedProviders: settings.supportedProviders,
    leaseSeconds: settings.leaseSeconds,
    log: (m) => console.warn(m),
  });
  notifier.target = hub;

  return {
    settings,
    repo,
    presence,
    hub,
    submit,
    addProvider: new AddProviderToQuery(repo, settings.supportedProviders, notifier),
    retry: new RetryResult(repo, notifier),
    ask: new AskQuery(submit, repo, presence, settings.askDefaultTimeoutSeconds, settings.askMaxTimeoutSeconds),
    getQuery: new GetQuery(repo),
    listQueries: new ListQueries(repo),
    prompts: new ManagePrompts(promptStore),
    categories: new ListCategories(promptStore, repo),
    stats: new GetStats(repo),
    answerFile: new GetAnswerFile(repo, storage),
    sweepLeases: new SweepLeases(repo, fail),
    cleanup: new CleanupExpiredResults(repo, storage, settings.retentionDays),
  };
}
