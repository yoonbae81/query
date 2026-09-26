import { newQueryResult, PRIORITY_NORMAL, type QueryResult } from "../domain/entities";
import { InvalidRequest, NotFound } from "../domain/errors";
import type { ExtensionNotifierPort, QueryRepositoryPort } from "../domain/ports";
import { normalizeProviders } from "./submitQuery";

export class AddProviderToQuery {
  constructor(
    private readonly repo: QueryRepositoryPort,
    private readonly supportedProviders: readonly string[],
    private readonly notifier?: ExtensionNotifierPort,
  ) {}

  /** 새로 추가된 결과만 반환. 전부 이미 존재하면 빈 배열 */
  async execute(queryId: string, providers: string[], priority = PRIORITY_NORMAL): Promise<QueryResult[]> {
    if (!providers || providers.length === 0) throw new InvalidRequest("providers가 비어 있습니다.");
    const chosen = normalizeProviders(providers, this.supportedProviders, []);
    if ((await this.repo.getQuery(queryId)) === null) throw new NotFound(`query_id를 찾을 수 없습니다: ${queryId}`);
    const results = chosen.map((p) => newQueryResult(queryId, p, priority));
    const added = await this.repo.addResults(queryId, results);
    if (added.length > 0) this.notifier?.wake();
    return added;
  }
}
