import { NotFound } from "../domain/errors";
import type { AnswerFileStoragePort, QueryRepositoryPort, Stats } from "../domain/ports";

/** 저장된 질문/답변 마크다운 파일을 내려받는다. */
export class GetAnswerFile {
  constructor(
    private readonly repo: QueryRepositoryPort,
    private readonly storage: AnswerFileStoragePort,
  ) {}

  async execute(queryId: string, resultId: string): Promise<{ filename: string; content: string }> {
    const result = await this.repo.getResult(resultId);
    if (!result || result.queryId !== queryId) throw new NotFound(`result_id를 찾을 수 없습니다: ${resultId}`);
    if (!result.answerFilePath) throw new NotFound("아직 답변 파일이 없습니다.");
    const content = await this.storage.read(result.answerFilePath);
    if (content === null) throw new NotFound("답변 파일을 찾을 수 없습니다(보관 기간이 지나 삭제되었을 수 있습니다).");
    return { filename: result.answerFilePath.split("/").pop() ?? "answer.md", content };
  }
}

/** 헤더에 표시하는 집계 */
export class GetStats {
  constructor(private readonly repo: QueryRepositoryPort) {}

  execute(): Promise<Stats> {
    return this.repo.stats();
  }
}
