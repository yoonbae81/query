import { api } from "./api";
import type { CategoryInfo, ExtensionStatus, ProviderInfo, Stats } from "./types";

/**
 * 헤더·쿼리 바·답변 작성 지침 모달이 함께 쓰는 서버 상태.
 * refresh()는 5초마다(탭이 보일 때) 호출되어 헤더 집계와 확장 연결 상태를 갱신한다.
 */
class AppState {
  providers = $state<ProviderInfo[]>([]);
  categories = $state<CategoryInfo[]>([]);
  stats = $state<Stats | null>(null);
  extension = $state<ExtensionStatus | null>(null);
  /** 목록 필터. null이면 전체 */
  categoryFilter = $state<string | null>(null);
  /** 값이 바뀌면 질의 목록이 처음부터 다시 로드된다(질문 등록 직후 등) */
  listVersion = $state(0);

  reloadList(): void {
    this.listVersion++;
  }

  async refresh(): Promise<void> {
    const [providers, categories, stats, extension] = await Promise.allSettled([
      api.providers(),
      api.categories(),
      api.stats(),
      api.extensionStatus(),
    ]);
    if (providers.status === "fulfilled") this.providers = providers.value;
    if (categories.status === "fulfilled") this.categories = categories.value;
    if (stats.status === "fulfilled") this.stats = stats.value;
    this.extension = extension.status === "fulfilled" ? extension.value : null;
  }
}

export const app = new AppState();

/** 질문 입력 시 기본으로 선택할 provider (Perplexity가 지원되면 Perplexity, 아니면 첫 번째 지원 provider) */
export function defaultProviderSelection(providers: ProviderInfo[]): Record<string, boolean> {
  const available = providers.filter((p) => p.available);
  const preferred = available.find((p) => p.id === "perplexity") ?? available[0];
  return Object.fromEntries(providers.map((p) => [p.id, p.id === preferred?.id]));
}
