import type { Job } from "../domain/entities";
import type { PromptStorePort, QueryRepositoryPort } from "../domain/ports";
import { resolvePrompt } from "./prompts";

/** 확장의 claim 요청 처리: 원자적 claim + 시스템 프롬프트 스냅샷 + 입력문 조합 (PLAN2 §4.2) */
export class ClaimNextResult {
  constructor(
    private readonly repo: QueryRepositoryPort,
    private readonly prompts: PromptStorePort,
    private readonly leaseSeconds: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(p: { provider: string; clientId: string }): Promise<Job | null> {
    const result = await this.repo.claimNext({
      now: this.now(),
      provider: p.provider,
      claimedBy: p.clientId,
      leaseSeconds: this.leaseSeconds,
    });
    if (!result) return null;

    const query = await this.repo.getQuery(result.queryId);
    if (!query) {
      await this.repo.markFailed(result.id, `query를 찾을 수 없습니다: ${result.queryId}`);
      return null;
    }
    const { content } = await resolvePrompt(this.prompts, query.category); // 카테고리 프롬프트, 없으면 general
    await this.repo.setSystemPromptSnapshot(result.id, content);
    const system = content.trim();
    return {
      resultId: result.id,
      provider: result.provider,
      prompt: system ? `${system}\n\n---\n\n${query.queryText}` : query.queryText,
      leaseSeconds: this.leaseSeconds,
    };
  }
}
