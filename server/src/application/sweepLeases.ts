import type { QueryRepositoryPort } from "../domain/ports";
import type { FailResult } from "./failResult";

/** 만료된 임대를 회수한다. 실패 1회로 간주해 재시도 정책을 적용한다. */
export class SweepLeases {
  constructor(
    private readonly repo: QueryRepositoryPort,
    private readonly fail: FailResult,
  ) {}

  async execute(now: Date = new Date()): Promise<number> {
    const expired = await this.repo.findExpiredLeases(now);
    for (const r of expired) {
      await this.fail.execute({
        resultId: r.id,
        code: "retryable",
        message: "임대가 만료되었습니다(확장 연결 끊김 또는 응답 없음)",
      });
    }
    return expired.length;
  }
}
