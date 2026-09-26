<script lang="ts">
  import Tag from "@lucide/svelte/icons/tag";

  import { app } from "../lib/stores.svelte";

  let { value = $bindable(), id = "category" }: { value: string; id?: string } = $props();

  // 카테고리 추가는 헤더의 "카테고리별 답변작성 지침"에서만 한다. 여기서는 기존 카테고리 중에서 고른다.
  // 아직 서버에 없는 현재 값도 목록에 남겨 둔다.
  const names = $derived([...new Set(["general", ...app.categories.map((c) => c.category), ...(value ? [value] : [])])]);
</script>

<div class="cat">
  <span class="ico" aria-hidden="true"><Tag size={14} /></span>
  <select {id} aria-label="카테고리" {value} onchange={(e) => (value = e.currentTarget.value)}>
    {#each names as name (name)}
      <option value={name}>{name}</option>
    {/each}
  </select>
</div>

<style>
  /* 질문 입력칸과 같은 높이(최소 40px)로 맞추고, 질문칸이 여러 줄로 늘어나면 함께 늘어난다 */
  .cat { position: relative; display: flex; align-self: stretch; width: 160px; min-height: 40px; flex-shrink: 0; }
  .ico { position: absolute; left: 10px; top: 0; bottom: 0; display: flex; align-items: center; color: var(--text-muted); pointer-events: none; }
  select { width: 100%; height: auto; min-height: 40px; padding-left: 30px; font-family: var(--font-mono); font-size: 13px; }
  @media (max-width: 980px) {
    .cat { width: 100%; }
  }
</style>
