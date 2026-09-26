<script lang="ts">
  import { tick } from "svelte";

  import { router } from "../lib/router.svelte";
  import DetailPanel from "./DetailPanel.svelte";
  import QueryBar from "./QueryBar.svelte";
  import QueryListPanel from "./QueryListPanel.svelte";

  const selectedId = $derived(router.route.name === "detail" ? router.route.id : null);
  let detailEl = $state<HTMLElement>();

  // 좁은 화면에서는 목록 아래에 상세가 쌓이므로, 질의를 고르면(또는 상세 링크로 진입하면) 상세 위치로 스크롤한다
  $effect(() => {
    if (!selectedId || !window.matchMedia("(max-width: 900px)").matches) return;
    void tick().then(() => detailEl?.scrollIntoView?.({ behavior: "smooth", block: "start" }));
  });
</script>

<div class="workspace" class:has-selection={selectedId !== null}>
  <QueryBar />
  <div class="grid">
    <div class="list-col"><QueryListPanel /></div>
    <div class="detail-col" bind:this={detailEl}>
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
  /* 좁은 화면: 쿼리 바 → 목록 → 상세 순서로 위아래로 쌓고 페이지 자체가 스크롤된다 */
  @media (max-width: 900px) {
    .workspace { height: auto; }
    .grid { grid-template-columns: 1fr; flex: none; }
    .list-col { height: min(60dvh, 560px); min-height: 320px; }
    .detail-col { height: auto; scroll-margin-top: 68px; } /* 고정 헤더 아래에 맞춘다 */
    .workspace:not(.has-selection) .detail-col { display: none; } /* 선택 전에는 빈 상세를 보이지 않는다 */
    /* 상세가 아직 로딩 중이어도 화면 맨 위로 정렬될 만큼 높이를 확보한다 */
    .workspace.has-selection .detail-col { min-height: calc(100dvh - 80px); }
  }
</style>
