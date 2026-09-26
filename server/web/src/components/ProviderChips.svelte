<script lang="ts">
  import type { ProviderInfo } from "../lib/types";

  let { providers, selected = $bindable() }: { providers: ProviderInfo[]; selected: Record<string, boolean> } = $props();
</script>

<div class="chips" role="group" aria-label="Provider">
  {#each providers as p (p.id)}
    <button
      type="button"
      class="chip"
      class:on={selected[p.id]}
      disabled={!p.available}
      aria-pressed={!!selected[p.id]}
      onclick={() => (selected[p.id] = !selected[p.id])}
    >
      <span class="dot" class:online={p.online && p.available} aria-hidden="true"></span>
      {p.name}{p.available ? "" : " (준비 중)"}
    </button>
  {/each}
</div>

<style>
  .chips { display: flex; gap: 6px; flex-wrap: wrap; }
  .chip {
    height: 34px; padding: 0 12px; font-size: 13px; background: var(--bg-primary); color: var(--text-secondary);
    border: 1px solid var(--border); border-radius: 9999px;
  }
  .chip:hover:not(:disabled) { border-color: var(--text-secondary); color: var(--text-primary); }
  .chip.on { background: var(--bg-surface-hover); color: var(--text-primary); border-color: var(--accent); }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--text-muted); }
  .dot.online { background: var(--success); }
</style>
