import { DEFAULT_CATEGORY, normalizeCategory } from "../domain/category";
import { Conflict, NotFound } from "../domain/errors";
import type { PromptStorePort, QueryRepositoryPort } from "../domain/ports";

/**
 * 질문 카테고리에 적용할 답변작성 지침를 고른다 (PLAN3 §4.2).
 * 카테고리 파일이 있으면 그것을, 없으면 general을, general도 없으면 빈 문자열을 쓴다.
 */
export async function resolvePrompt(
  store: PromptStorePort,
  category: string,
): Promise<{ category: string; content: string }> {
  if (category !== DEFAULT_CATEGORY) {
    const specific = await store.read(category);
    if (specific) return { category, content: specific.content };
  }
  const general = await store.read(DEFAULT_CATEGORY);
  return { category: DEFAULT_CATEGORY, content: general?.content ?? "" };
}

export interface PromptView {
  category: string;
  content: string;
  updatedAt: Date;
}

/** 카테고리별 답변작성 지침 조회/저장/삭제 */
export class ManagePrompts {
  constructor(private readonly store: PromptStorePort) {}

  async get(category: string): Promise<PromptView> {
    const name = normalizeCategory(category);
    const found = await this.store.read(name);
    if (!found) {
      // general은 항상 존재하는 것으로 취급한다(비어 있음)
      if (name === DEFAULT_CATEGORY) return { category: name, content: "", updatedAt: new Date() };
      throw new NotFound(`답변작성 지침이 없습니다: ${name}`);
    }
    return { category: name, ...found };
  }

  async put(category: string, content: string): Promise<PromptView> {
    const name = normalizeCategory(category);
    const updatedAt = await this.store.write(name, content);
    return { category: name, content, updatedAt };
  }

  async remove(category: string): Promise<void> {
    const name = normalizeCategory(category);
    if (name === DEFAULT_CATEGORY) throw new Conflict("general 답변작성 지침은 삭제할 수 없습니다. 내용을 비우세요.");
    if (!(await this.store.delete(name))) throw new NotFound(`답변작성 지침이 없습니다: ${name}`);
  }
}

export interface CategoryView {
  category: string;
  /** 답변작성 지침 파일이 있는지 (없으면 general 답변작성 지침가 적용된다) */
  hasPrompt: boolean;
  queryCount: number;
  promptSize: number;
}

/** 답변작성 지침 파일이 있는 카테고리와 질문에 쓰인 카테고리를 합쳐 보여준다. general이 항상 맨 앞이다. */
export class ListCategories {
  constructor(
    private readonly store: PromptStorePort,
    private readonly repo: QueryRepositoryPort,
  ) {}

  async execute(): Promise<CategoryView[]> {
    const [prompts, counts] = await Promise.all([this.store.list(), this.repo.listCategories()]);
    const byName = new Map<string, CategoryView>();
    const ensure = (category: string): CategoryView => {
      let v = byName.get(category);
      if (!v) byName.set(category, (v = { category, hasPrompt: false, queryCount: 0, promptSize: 0 }));
      return v;
    };
    ensure(DEFAULT_CATEGORY);
    for (const p of prompts) Object.assign(ensure(p.category), { hasPrompt: true, promptSize: p.size });
    for (const c of counts) ensure(c.category).queryCount = c.count;
    return [...byName.values()].sort((a, b) =>
      a.category === DEFAULT_CATEGORY ? -1 : b.category === DEFAULT_CATEGORY ? 1 : a.category.localeCompare(b.category),
    );
  }
}
