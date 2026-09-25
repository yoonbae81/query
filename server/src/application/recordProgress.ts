import type { QueryRepositoryPort } from "../domain/ports";

export class RecordProgress {
  constructor(
    private readonly repo: QueryRepositoryPort,
    private readonly leaseSeconds: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** 임대 중인 본인 작업이면 진행 메시지를 기록하고 임대를 연장한다. 아니면 false */
  async execute(p: { resultId: string; clientId: string; message: string }): Promise<boolean> {
    const result = await this.repo.getResult(p.resultId);
    if (!result || result.status !== "processing" || result.claimedBy !== p.clientId) return false;
    await this.repo.setProgress(p.resultId, p.message);
    await this.repo.extendLease(p.resultId, new Date(this.now().getTime() + this.leaseSeconds * 1000));
    return true;
  }
}
