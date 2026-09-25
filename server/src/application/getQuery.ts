import { RESULT_STATUSES, type Query, type QueryResult } from "../domain/entities";
import { InvalidRequest, NotFound } from "../domain/errors";
import type { QueryPage, QueryRepositoryPort } from "../domain/ports";

export const MAX_LIST_LIMIT = 100;

export class GetQuery {
  constructor(private readonly repo: QueryRepositoryPort) {}

  async execute(queryId: string): Promise<{ query: Query; results: QueryResult[] }> {
    const query = await this.repo.getQuery(queryId);
    if (!query) throw new NotFound(`query_id를 찾을 수 없습니다: ${queryId}`);
    return { query, results: await this.repo.getResults(queryId) };
  }
}

export class ListQueries {
  constructor(private readonly repo: QueryRepositoryPort) {}

  async execute(p: { status?: string; batchId?: string; limit?: number; cursor?: string }): Promise<QueryPage> {
    const limit = p.limit ?? 20;
    if (p.status && !RESULT_STATUSES.includes(p.status as never)) {
      throw new InvalidRequest(`알 수 없는 status: ${p.status}`);
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) {
      throw new InvalidRequest(`limit는 1~${MAX_LIST_LIMIT} 사이여야 합니다.`);
    }
    try {
      return await this.repo.listQueries({ status: p.status, batchId: p.batchId, limit, cursor: p.cursor });
    } catch (e) {
      if (p.cursor && (e instanceof SyntaxError || e instanceof TypeError)) {
        throw new InvalidRequest("유효하지 않은 cursor입니다.");
      }
      throw e;
    }
  }
}
