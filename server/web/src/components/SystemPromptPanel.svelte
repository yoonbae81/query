<script lang="ts">
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import Save from "@lucide/svelte/icons/save";
  import { onMount } from "svelte";

  import { api } from "../lib/api";
  import { toast } from "../lib/toast.svelte";

  let content = $state("");
  let saving = $state(false);

  onMount(async () => {
    try {
      content = await api.systemPrompt();
    } catch (e) {
      toast.show((e as Error).message, true);
    }
  });

  async function save() {
    saving = true;
    try {
      await api.saveSystemPrompt(content);
      toast.show("저장되었습니다");
    } catch (e) {
      toast.show((e as Error).message, true);
    } finally {
      saving = false;
    }
  }
</script>

<details class="panel">
  <summary><ChevronRight size={16} class="chev" />시스템 프롬프트</summary>
  <div class="panel-body">
    <textarea rows="6" aria-label="시스템 프롬프트" bind:value={content}></textarea>
    <div class="row end">
      <button class="btn" disabled={saving} onclick={save}><Save size={16} />저장</button>
    </div>
  </div>
</details>
