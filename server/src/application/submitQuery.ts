import {
  monotonicNow,
  newId,
  newQueryResult,
  PRIORITY_NORMAL,
  type Query,
  type QueryResult,
} from "../domain/entities";
import { normalizeCategory } from "../domain/category";
import { InvalidRequest } from "../domain/errors";
import type { ExtensionNotifierPort, QueryRepositoryPort } from "../domain/ports";

export const MAX_BULK_SIZE = 100;

/** 중복 제거(순서 유지), 미지정 시 기본값, 미지원 provider는 InvalidRequest */
export function normalizeProviders(
  providers: string[] | undefined | null,
  supported: readonly string[],
  fallback: readonly string[],
): string[] {
  const chosen = providers && providers.length > 0 ? [...new Set(providers)] : [...fallback];
  if (chosen.length === 0) throw new InvalidRequest("providers가 비어 있습니다.");
  const unknown = chosen.filter((p) => !supported.includes(p));
  if (unknown.length > 0) throw new InvalidRequest(`사용할 수 없는 provider: ${unknown.join(", ")}`);
  return chosen;
}

export interface Submitted {
  query: Query;
  results: QueryResult[];
}

export class SubmitQuery {
  constructor(
    private readonly repo: QueryRepositoryPort,
    private readonly supportedProviders: readonly string[],
    private readonly defaultProviders: readonly string[],
    private readonly maxQueryLength = 4000,
    private readonly notifier?: ExtensionNotifierPort,
  ) {}

  private build(text: string, providers: string[], batchId: string | null, priority: number, category: string): Submitted {
    const now = monotonicNow();
    const query: Query = { id: newId("q"), queryText: text, category, providers, batchId, createdAt: now };
    return { query, results: providers.map((p) => newQueryResult(query.id, p, priority, now)) };
  }

  private checkText(text: string | undefined): string {
    const t = (text ?? "").trim();
    if (!t) throw new InvalidRequest("질문 내용은 비어 있을 수 없습니다.");
    if (t.length > this.maxQueryLength) {
      throw new InvalidRequest(`질문은 ${this.maxQueryLength}자를 초과할 수 없습니다.`);
    }
    return t;
  }

  async submit(
    text: string,
    providers?: string[] | null,
    priority = PRIORITY_NORMAL,
    category?: string | null,
  ): Promise<Submitted> {
    const t = this.checkText(text);
    const chosen = normalizeProviders(providers, this.supportedProviders, this.defaultProviders);
    const s = this.build(t, chosen, null, priority, normalizeCategory(category));
    await this.repo.createQueries([s]);
    this.notifier?.wake();
    return s;
  }

  async submitBulk(
    texts: string[],
    providers?: string[] | null,
    category?: string | null,
  ): Promise<{ batchId: string; items: Submitted[] }> {
    const cleaned = texts.map((t) => t.trim()).filter((t) => t.length > 0);
    if (cleaned.length === 0) throw new InvalidRequest("등록할 질문이 없습니다.");
    if (cleaned.length > MAX_BULK_SIZE) {
      throw new InvalidRequest(`한 번에 최대 ${MAX_BULK_SIZE}건까지 등록할 수 있습니다.`);
    }
    const checked = cleaned.map((t) => this.checkText(t));
    const chosen = normalizeProviders(providers, this.supportedProviders, this.defaultProviders);
    const cat = normalizeCategory(category);
    const batchId = newId("b");
    const items = checked.map((t) => this.build(t, chosen, batchId, PRIORITY_NORMAL, cat));
    await this.repo.createQueries(items);
    this.notifier?.wake();
    return { batchId, items };
  }
}
