import { Conflict, NotFound } from "../domain/errors";
import type { AnswerFileStoragePort, QueryRepositoryPort } from "../domain/ports";

/**
 * 사용자가 결과를 직접 삭제한다. 질문 전체(모든 provider 결과) 또는 provider별 결과 하나를 지울 수 있고,
 * 답변 파일도 함께 지운다. 확장이 처리 중(processing)인 결과는 삭제할 수 없다.
 */
export class DeleteResults {
  constructor(
    private readonly repo: QueryRepositoryPort,
    private readonly storage: AnswerFileStoragePort,
  ) {}

  /** 질문과 모든 provider 결과를 삭제한다. */
  async deleteQuery(queryId: string): Promise<void> {
    if ((await this.repo.getQuery(queryId)) === null) throw new NotFound(`query_id를 찾을 수 없습니다: ${queryId}`);
    const results = await this.repo.getResults(queryId);
    if (results.some((r) => r.status === "processing")) {
      throw new Conflict("처리 중인 provider가 있어 삭제할 수 없습니다. 처리가 끝난 뒤에 삭제하세요.");
    }
    for (const r of results) if (r.answerFilePath) await this.storage.delete(r.answerFilePath);
    await this.repo.deleteResults(results.map((r) => r.id));
  }

  /** provider 결과 하나를 삭제한다. 마지막 결과였다면 질문도 함께 삭제되며 queryDeleted가 true다. */
  async deleteResult(queryId: string, resultId: string): Promise<{ queryDeleted: boolean }> {
    const result = await this.repo.getResult(resultId);
    if (!result || result.queryId !== queryId) throw new NotFound(`result_id를 찾을 수 없습니다: ${resultId}`);
    if (result.status === "processing") {
      throw new Conflict("처리 중인 결과는 삭제할 수 없습니다. 처리가 끝난 뒤에 삭제하세요.");
    }
    if (result.answerFilePath) await this.storage.delete(result.answerFilePath);
    await this.repo.deleteResults([resultId]);
    return { queryDeleted: (await this.repo.getQuery(queryId)) === null };
  }
}
