<script lang="ts">
  import { onMount } from "svelte";

  import BulkModal from "./components/BulkModal.svelte";
  import Header from "./components/Header.svelte";
  import PromptsModal from "./components/PromptsModal.svelte";
  import Toast from "./components/Toast.svelte";
  import Workspace from "./components/Workspace.svelte";
  import { app } from "./lib/stores.svelte";

  let modal = $state<"bulk" | "prompts" | null>(null);

  const toggle = (name: "bulk" | "prompts") => (modal = modal === name ? null : name);

  // 헤더 집계·확장 연결 상태·카테고리 목록을 주기적으로 갱신한다 (탭이 보일 때만)
  onMount(() => {
    void app.refresh();
    const t = setInterval(() => !document.hidden && void app.refresh(), 5000);
    return () => clearInterval(t);
  });
</script>

<Header activeModal={modal} onbulk={() => toggle("bulk")} onprompts={() => toggle("prompts")} />

<main class="app-container">
  <Workspace />
</main>

{#if modal === "bulk"}<BulkModal onclose={() => (modal = null)} />{/if}
{#if modal === "prompts"}<PromptsModal onclose={() => (modal = null)} />{/if}

<Toast />

<style>
  .app-container {
    max-width: 1440px; width: 100%; margin: 0 auto; padding: 16px 24px 24px;
    height: calc(100dvh - 56px - var(--sat)); overflow: hidden;
  }
  @media (max-width: 900px) {
    .app-container { height: auto; overflow: visible; padding: 12px; }
  }
</style>
