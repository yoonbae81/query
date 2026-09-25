<script lang="ts">
  import { fmtTime, providerName } from "../lib/format";
  import { router } from "../lib/router.svelte";
  import type { QuerySummary } from "../lib/types";
  import StatusBadge from "./StatusBadge.svelte";

  let {
    items,
    hasMore,
    loadingMore,
    onmore,
  }: { items: QuerySummary[]; hasMore: boolean; loadingMore: boolean; onmore: () => void } = $props();
</script>

<section class="panel">
  <table class="list">
    <thead>
      <tr><th>Query ID</th><th>Batch</th><th>질문</th><th>Provider별 상태</th><th>등록일시</th></tr>
    </thead>
    <tbody>
      {#each items as it (it.query_id)}
        <tr onclick={() => router.go({ name: "detail", id: it.query_id })}>
          <td>{it.query_id}</td>
          <td>{it.batch_id ?? "-"}</td>
          <td class="q" title={it.query}>{it.query}</td>
          <td>
            {#each it.results_summary as r (r.provider)}
              <StatusBadge status={r.status} label={`${providerName(r.provider)}: ${r.status}`} />
            {/each}
          </td>
          <td class="time">{fmtTime(it.created_at)}</td>
        </tr>
      {/each}
    </tbody>
  </table>
  {#if items.length === 0}
    <div class="empty">등록된 질의가 없습니다</div>
  {/if}
  {#if hasMore}
    <div class="row center"><button class="btn" disabled={loadingMore} onclick={onmore}>더 보기</button></div>
  {/if}
</section>
