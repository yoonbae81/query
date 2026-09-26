<script lang="ts">
  import ExternalLink from "@lucide/svelte/icons/external-link";

  import { safeLinks } from "../lib/format";

  let { citations }: { citations: string[] | null } = $props();

  const links = $derived(safeLinks(citations));

  function host(url: string): string {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return url;
    }
  }
</script>

{#if links.length > 0}
  <section class="sources">
    <div class="head">출처 <span class="mono count">({links.length})</span></div>
    <ol>
      {#each links as url, i (url)}
        <li>
          <a class="card" href={url} target="_blank" rel="noopener noreferrer">
            <span class="idx mono">{i + 1}</span>
            <span class="body">
              <span class="host mono">{host(url)}</span>
              <span class="url">{url}</span>
            </span>
            <ExternalLink size={13} />
          </a>
        </li>
      {/each}
    </ol>
  </section>
{/if}

<style>
  .sources { display: flex; flex-direction: column; gap: 8px; }
  .head { font-size: 13px; font-weight: 600; color: var(--text-secondary); }
  .count { color: var(--text-muted); font-weight: 400; }
  ol { list-style: none; display: flex; flex-direction: column; gap: 6px; }
  .card {
    display: flex; align-items: center; gap: 10px; padding: 8px 12px; background: var(--bg-primary);
    border: 1px solid var(--border); border-radius: 6px; color: var(--text-muted);
  }
  .card:hover { border-color: var(--accent); background: var(--bg-surface-hover); }
  .idx {
    flex-shrink: 0; width: 22px; height: 22px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
    background: var(--bg-surface-hover); color: var(--text-secondary); font-size: 11px; font-weight: 700;
  }
  .body { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .host { font-size: 12px; color: var(--text-primary); }
  .url { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
