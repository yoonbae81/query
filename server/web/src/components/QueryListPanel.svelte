<script lang="ts">
  import Inbox from "@lucide/svelte/icons/inbox";
  import Search from "@lucide/svelte/icons/search";
  import { onMount, untrack } from "svelte";

  import { api } from "../lib/api";
  import { fmtTime, providerName } from "../lib/format";
  import { router } from "../lib/router.svelte";
  import { app } from "../lib/stores.svelte";
  import { toast } from "../lib/toast.svelte";
  import type { QuerySummary } from "../lib/types";
  import StatusBadge from "./StatusBadge.svelte";

  const PAGE = 20;
  const STATUSES = ["", "pending", "processing", "done", "failed"] as const;

  let items = $state<QuerySummary[]>([]);
  let nextCursor = $state<string | null>(null);
  let loaded = $state(false);
  let loadingMore = $state(false);
  let search = $state("");
  let debounced = $state("");
  let status = $state<string>("");
  let token = 0; // 늦게 도착한 이전 요청의 응답이 최신 목록을 덮어쓰지 않게 한다

  const selectedId = $derived(router.route.name === "detail" ? router.route.id : null);

  // 검색어는 입력이 멈춘 뒤에 적용한다
  $effect(() => {
    const value = search;
    const t = setTimeout(() => (debounced = value), 300);
    return () => clearTimeout(t);
  });

  // reset=true: 처음부터 다시 로드. false: 지금 보이는 개수만큼 다시 받아 상태만 갱신
  async function load(reset: boolean) {
    const mine = ++token;
    try {
      const limit = reset ? PAGE : Math.min(Math.max(items.length, PAGE), 100);
      const page = await api.listQueries({ limit, category: app.categoryFilter, search: debounced, status });
      if (mine !== token) return;
      items = page.items;
      nextCursor = page.next_cursor;
      loaded = true;
    } catch (e) {
      if (mine === token) toast.show((e as Error).message, true);
    }
  }

  async function more() {
    if (!nextCursor || loadingMore) return;
    loadingMore = true;
    const mine = token;
    try {
      const page = await api.listQueries({ limit: PAGE, cursor: nextCursor, category: app.categoryFilter, search: debounced, status });
      if (mine !== token) return;
      items = items.concat(page.items);
      nextCursor = page.next_cursor;
    } catch (e) {
      toast.show((e as Error).message, true);
    } finally {
      loadingMore = false;
    }
  }

  // 필터·검색·등록 신호가 바뀌면 처음부터 다시 로드한다
  $effect(() => {
    app.categoryFilter;
    debounced;
    status;
    app.listVersion;
    untrack(() => void load(true));
  });

  onMount(() => {
    const t = setInterval(() => !document.hidden && void load(false), 5000);
    return () => clearInterval(t);
  });
</script>

<section class="panel">
  <div class="panel-header">
    <div class="header-left">
      <span class="panel-title">질의 내역</span>
    </div>
    <div class="filters">
      <div class="search-wrap">
        <Search size={14} class="search-icon" />
        <input class="search" type="search" bind:value={search} aria-label="질문 검색" placeholder="검색" />
      </div>
      <select bind:value={status} aria-label="상태 필터">
        {#each STATUSES as s (s)}
          <option value={s}>{s === "" ? "전체 상태" : s}</option>
        {/each}
      </select>
    </div>
  </div>

  <div class="scroll">
    {#each items as it (it.query_id)}
      <a
        class="item"
        class:active={it.query_id === selectedId}
        href={router.href({ name: "detail", id: it.query_id })}
        onclick={(e) => {
          e.preventDefault();
          router.go({ name: "detail", id: it.query_id });
        }}
      >
        <div class="row1">
          <span class="q">{it.query}</span>
          <span class="statuses">
            {#each it.results_summary as r (r.provider)}
              <span title="{providerName(r.provider)}: {r.status}"><StatusBadge status={r.status} label={providerName(r.provider)} /></span>
            {/each}
          </span>
        </div>
        {#if it.answer_preview}<p class="preview">{it.answer_preview}</p>{/if}
        <div class="meta">
          <span class="badge purple">{it.category}</span>
          <span class="mono">{fmtTime(it.created_at)}</span>
          {#if it.batch_id}<span class="mono">{it.batch_id}</span>{/if}
        </div>
      </a>
    {/each}

    {#if loaded && items.length === 0}
      <div class="empty"><Inbox size={22} />등록된 질의가 없습니다</div>
    {/if}
    {#if nextCursor}
      <div class="more"><button class="secondary" onclick={more} disabled={loadingMore}>더 보기</button></div>
    {/if}
  </div>
</section>

<style>
  .panel { background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; display: flex; flex-direction: column; height: 100%; min-height: 0; overflow: hidden; }
  .panel-header {
    min-height: 48px; padding: 6px 12px 6px 16px; border-bottom: 1px solid var(--border); display: flex; align-items: center;
    justify-content: space-between; gap: 10px; background: var(--bg-overlay); flex-wrap: wrap;
  }
  .header-left { display: flex; align-items: center; gap: 8px; }
  .panel-title { font-size: 14px; font-weight: 600; white-space: nowrap; }
  .filters { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .search-wrap { position: relative; display: flex; align-items: center; }
  .search-wrap :global(.search-icon) { position: absolute; left: 9px; color: var(--text-muted); pointer-events: none; }
  .search { width: 150px; height: 32px; padding: 4px 8px 4px 28px; font-size: 13px; }
  select { height: 32px; padding: 4px 8px; font-size: 13px; font-family: var(--font-mono); }
  .scroll { flex: 1; overflow-y: auto; min-height: 0; }
  .item { display: flex; flex-direction: column; gap: 6px; padding: 12px 16px; border-bottom: 1px solid var(--border); cursor: pointer; }
  .item:hover { background: var(--bg-surface-hover); }
  .item.active { background: var(--bg-surface-hover); box-shadow: inset 3px 0 0 var(--accent); }
  .row1 { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
  .q { flex: 1; min-width: 0; font-weight: 600; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word; }
  .statuses { display: flex; gap: 4px; flex-shrink: 0; flex-wrap: wrap; justify-content: flex-end; }
  .preview { font-size: 13px; color: var(--text-secondary); display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word; }
  .meta { display: flex; align-items: center; gap: 10px; font-size: 12px; color: var(--text-muted); flex-wrap: wrap; }
  .empty { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 48px 16px; color: var(--text-muted); }
  .more { display: flex; justify-content: center; padding: 12px; }
  @media (max-width: 640px) { .search { width: 110px; } }
</style>
