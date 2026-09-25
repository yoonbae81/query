<script lang="ts">
  import Plug from "@lucide/svelte/icons/plug";
  import Unplug from "@lucide/svelte/icons/unplug";
  import { onMount } from "svelte";

  import { api } from "../lib/api";
  import { PROVIDER_STATE_LABEL, providerName } from "../lib/format";
  import type { ExtensionStatus } from "../lib/types";

  let status = $state<ExtensionStatus | null>(null);

  async function refresh() {
    try {
      status = await api.extensionStatus();
    } catch {
      status = null;
    }
  }

  onMount(() => {
    refresh();
    const t = setInterval(() => !document.hidden && refresh(), 5000);
    return () => clearInterval(t);
  });
</script>

<div class="ext-status">
  {#if status?.connected}
    <span class="badge st-done"><Plug size={14} />확장 연결됨</span>
    {#each status.providers as p (p.id)}
      {@const state = p.states[0]}
      <span class="badge {p.online ? 'st-done' : 'st-pending'}">
        {providerName(p.id)}: {state ? PROVIDER_STATE_LABEL[state] : "미접속"}
      </span>
    {/each}
  {:else}
    <span class="badge st-pending"><Unplug size={14} />확장 끊김</span>
  {/if}
</div>
