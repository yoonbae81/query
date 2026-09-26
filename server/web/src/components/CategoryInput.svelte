<script lang="ts">
  import Tag from "@lucide/svelte/icons/tag";

  import { app } from "../lib/stores.svelte";

  let { value = $bindable(), id = "category" }: { value: string; id?: string } = $props();
</script>

<div class="cat">
  <label for={id}><Tag size={13} />카테고리</label>
  <input {id} list="{id}-options" bind:value maxlength="32" autocomplete="off" spellcheck="false" />
  <datalist id="{id}-options">
    {#each app.categories as c (c.category)}
      <option value={c.category}></option>
    {/each}
  </datalist>
</div>

<style>
  .cat { display: flex; align-items: center; gap: 8px; }
  label { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--text-muted); white-space: nowrap; }
  input { width: 140px; height: 38px; font-family: var(--font-mono); font-size: 13px; }
</style>
