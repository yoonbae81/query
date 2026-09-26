<script lang="ts">
  import CheckCheck from "@lucide/svelte/icons/check-check";
  import Layers from "@lucide/svelte/icons/layers";
  import ListPlus from "@lucide/svelte/icons/list-plus";
  import MessageSquareText from "@lucide/svelte/icons/message-square-text";
  import Monitor from "@lucide/svelte/icons/monitor";
  import Moon from "@lucide/svelte/icons/moon";
  import Plug from "@lucide/svelte/icons/plug";
  import ScrollText from "@lucide/svelte/icons/scroll-text";
  import Sun from "@lucide/svelte/icons/sun";
  import Unplug from "@lucide/svelte/icons/unplug";
  import { onMount } from "svelte";

  import { router } from "../lib/router.svelte";
  import { app } from "../lib/stores.svelte";
  import {
    applyTheme,
    getStoredThemeMode,
    nextThemeMode,
    setStoredThemeMode,
    THEME_LABEL,
    type ThemeMode,
  } from "../lib/theme";

  let {
    activeModal = null,
    onbulk,
    onprompts,
  }: { activeModal?: "bulk" | "prompts" | null; onbulk: () => void; onprompts: () => void } = $props();

  let themeMode = $state<ThemeMode>("auto");

  const queue = $derived((app.stats?.results.pending ?? 0) + (app.stats?.results.processing ?? 0));
  const answers = $derived(app.stats?.results.done ?? 0);
  const connected = $derived(app.extension?.connected ?? false);
  const anyOnline = $derived(app.extension?.providers.some((p) => p.online) ?? false);

  onMount(() => {
    themeMode = getStoredThemeMode();
    applyTheme(themeMode);
    // 자동 모드에서는 OS의 라이트/다크 전환을 세션 중에도 반영한다
    const mql = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => themeMode === "auto" && applyTheme("auto");
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  });

  function cycleTheme() {
    themeMode = nextThemeMode(themeMode);
    setStoredThemeMode(themeMode);
  }

</script>

<header class="app-header">
  <div class="brand">
    <a
      class="logo"
      href={router.href({ name: "home" })}
      onclick={(e) => {
        e.preventDefault();
        app.categoryFilter = null;
        router.go({ name: "home" });
      }}
    >
      <MessageSquareText size={20} class="logo-mark" />
      QUERY
    </a>
  </div>

  <div class="status-bar">
    <span class="badge {connected ? (anyOnline ? 'green' : 'yellow') : 'red'}">
      {#if connected}<Plug size={13} />{:else}<Unplug size={13} />{/if}
      {connected ? (anyOnline ? "확장 연결됨" : "확장 대기") : "확장 끊김"}
    </span>
    <span class="stat-pill"><Layers size={13} />Queue: {queue}</span>
    <span class="stat-pill"><CheckCheck size={13} />답변: {answers}</span>

    <div class="divider"></div>

    <div class="actions">
      <button class="icon-btn" class:active={activeModal === "bulk"} onclick={onbulk} title="벌크 입력" aria-label="벌크 입력">
        <ListPlus size={16} />
      </button>
      <button class="icon-btn" class:active={activeModal === "prompts"} onclick={onprompts} title="카테고리별 답변작성 지침" aria-label="카테고리별 답변작성 지침">
        <ScrollText size={16} />
      </button>
      <button class="icon-btn" onclick={cycleTheme} title="테마: {THEME_LABEL[themeMode]}" aria-label="테마 변경 (현재: {THEME_LABEL[themeMode]})">
        {#if themeMode === "light"}<Sun size={16} />{:else if themeMode === "dark"}<Moon size={16} />{:else}<Monitor size={16} />{/if}
      </button>
    </div>
  </div>
</header>

<style>
  .app-header {
    height: calc(56px + var(--sat)); padding-top: var(--sat); background: var(--bg-surface);
    border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; gap: 12px;
    padding-left: max(16px, var(--sal)); padding-right: max(16px, var(--sar)); position: sticky; top: 0; z-index: 100;
  }
  .brand { display: flex; align-items: center; gap: 14px; min-width: 0; }
  .logo { display: inline-flex; align-items: center; gap: 8px; font-weight: 800; font-size: 16px; letter-spacing: 0.05em; white-space: nowrap; }
  .logo:hover { color: var(--accent); }
  .logo :global(.logo-mark) { color: var(--accent); }
  .status-bar { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
  .stat-pill {
    display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-secondary); font-family: var(--font-mono);
    background: var(--bg-primary); padding: 4px 8px; border-radius: 4px; border: 1px solid var(--border); white-space: nowrap;
  }
  .divider { width: 1px; height: 18px; background: var(--border); }
  .actions { display: flex; align-items: center; gap: 6px; }

  @media (max-width: 900px) {
    .stat-pill { display: none; }
  }
  @media (max-width: 640px) {
    .app-header { padding-left: max(12px, var(--sal)); padding-right: max(12px, var(--sar)); }
    .status-bar { gap: 6px; }
    .status-bar .badge, .divider { display: none; }
  }
</style>
