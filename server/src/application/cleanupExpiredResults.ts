import type { AnswerFileStoragePort, QueryRepositoryPort } from "../domain/ports";

const DAY_MS = 24 * 60 * 60 * 1000;

/** done/failed 후 retentionDays가 지난 결과와 답변 파일을 삭제 (PLAN §3.1) */
export class CleanupExpiredResults {
  constructor(
    private readonly repo: QueryRepositoryPort,
    private readonly storage: AnswerFileStoragePort,
    private readonly retentionDays: number,
  ) {}

  async execute(now: Date = new Date()): Promise<number> {
    const expired = await this.repo.findExpired(new Date(now.getTime() - this.retentionDays * DAY_MS));
    for (const r of expired) if (r.answerFilePath) await this.storage.delete(r.answerFilePath);
    await this.repo.deleteResults(expired.map((r) => r.id));
    return expired.length;
  }
}
