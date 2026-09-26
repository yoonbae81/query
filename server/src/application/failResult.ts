import type { QueryRepositoryPort } from "../domain/ports";

/** 확장이 보고하는 오류 유형 */
export type FailCode = "login_required" | "timeout" | "selector_missing" | "retryable";

export type FailOutcome = "released" | "retry" | "failed" | "ignored";

/**
 * 실패 처리 정책.
 * - login_required: 재시도 횟수를 늘리지 않고 pending으로 되돌림
 * - 그 외: 최초 1회 + 재시도 maxRetry회까지 backoff 후 재시도, 초과하면 failed
 */
export class FailResult {
  constructor(
    private readonly repo: QueryRepositoryPort,
    private readonly maxRetry: number,
    private readonly retryBackoffSeconds: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** clientId를 주면 해당 클라이언트가 임대 중인 결과만 처리한다(서버 내부 호출은 생략). */
  async execute(p: { resultId: string; clientId?: string; code: FailCode; message: string }): Promise<FailOutcome> {
    const result = await this.repo.getResult(p.resultId);
    if (!result || result.status !== "processing") return "ignored";
    if (p.clientId !== undefined && result.claimedBy !== p.clientId) return "ignored";

    if (p.code === "login_required") {
      await this.repo.releaseToPending(p.resultId, p.message);
      return "released";
    }
    const message = `${p.code}: ${p.message}`;
    if (result.retryCount + 1 <= this.maxRetry) {
      const next = new Date(this.now().getTime() + this.retryBackoffSeconds * 1000);
      await this.repo.scheduleRetry(p.resultId, message, next);
      return "retry";
    }
    await this.repo.markFailed(p.resultId, message);
    return "failed";
  }
}
