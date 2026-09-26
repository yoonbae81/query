<script lang="ts">
  import { router } from "../lib/router.svelte";
  import DetailPanel from "./DetailPanel.svelte";
  import QueryBar from "./QueryBar.svelte";
  import QueryListPanel from "./QueryListPanel.svelte";

  const selectedId = $derived(router.route.name === "detail" ? router.route.id : null);
</script>

<div class="workspace" class:has-selection={selectedId !== null}>
  <div class="bar"><QueryBar /></div>
  <div class="grid">
    <div class="list-col"><QueryListPanel /></div>
    <div class="detail-col">
      {#key selectedId}
        <DetailPanel id={selectedId} />
      {/key}
    </div>
  </div>
</div>

<style>
  .workspace { display: flex; flex-direction: column; gap: 16px; height: 100%; min-height: 0; }
  .grid { display: grid; grid-template-columns: minmax(340px, 0.8fr) 1.2fr; gap: 16px; flex: 1; min-height: 0; }
  .list-col, .detail-col { min-height: 0; min-width: 0; }
  /* 좁은 화면: 목록과 상세를 번갈아 보여준다 */
  @media (max-width: 900px) {
    .workspace { height: auto; }
    .grid { grid-template-columns: 1fr; }
    .list-col, .detail-col { height: calc(100dvh - 240px); min-height: 420px; }
    .workspace.has-selection .list-col, .workspace.has-selection .bar { display: none; }
    .workspace:not(.has-selection) .detail-col { display: none; }
    .workspace.has-selection .detail-col { height: calc(100dvh - 88px); }
  }
</style>
