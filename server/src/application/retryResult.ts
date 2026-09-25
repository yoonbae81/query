import type { QueryResult } from "../domain/entities";
import { Conflict, NotFound } from "../domain/errors";
import type { ExtensionNotifierPort, QueryRepositoryPort } from "../domain/ports";

export class RetryResult {
  constructor(
    private readonly repo: QueryRepositoryPort,
    private readonly notifier?: ExtensionNotifierPort,
  ) {}

  async execute(queryId: string, resultId: string): Promise<QueryResult> {
    const result = await this.repo.getResult(resultId);
    if (!result || result.queryId !== queryId) throw new NotFound(`result_id를 찾을 수 없습니다: ${resultId}`);
    if (!(await this.repo.resetForRetry(resultId))) throw new Conflict("failed 상태의 결과만 재시도할 수 있습니다.");
    this.notifier?.wake();
    return (await this.repo.getResult(resultId))!;
  }
}
