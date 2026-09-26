import type { AnswerFileStoragePort, QueryRepositoryPort } from "../domain/ports";

export class CompleteResult {
  constructor(
    private readonly repo: QueryRepositoryPort,
    private readonly storage: AnswerFileStoragePort,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** 임대 중인 본인 작업의 결과를 저장하고 done으로 확정한다. 아니면 false */
  async execute(p: { resultId: string; clientId: string; answer: string; citations: string[] }): Promise<boolean> {
    const result = await this.repo.getResult(p.resultId);
    if (!result || result.status !== "processing" || result.claimedBy !== p.clientId) return false;
    const query = await this.repo.getQuery(result.queryId);
    if (!query) return false;

    const path = await this.storage.save({
      queryId: query.id,
      provider: result.provider,
      category: query.category,
      systemPrompt: result.systemPromptSnapshot ?? "",
      question: query.queryText,
      answer: { text: p.answer, citations: p.citations },
      createdAt: query.createdAt,
      answeredAt: this.now(),
    });
    await this.repo.markDone(result.id, p.answer, p.citations, path);
    return true;
  }
}
