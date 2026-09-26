<script lang="ts">
  import ListPlus from "@lucide/svelte/icons/list-plus";
  import Send from "@lucide/svelte/icons/send";
  import { untrack } from "svelte";

  import { api } from "../lib/api";
  import { app, defaultProviderSelection } from "../lib/stores.svelte";
  import { toast } from "../lib/toast.svelte";
  import CategoryInput from "./CategoryInput.svelte";
  import Modal from "./Modal.svelte";
  import ProviderChips from "./ProviderChips.svelte";

  let { onclose }: { onclose: () => void } = $props();

  let text = $state("");
  let category = $state(untrack(() => app.categoryFilter ?? "general"));
  let submitting = $state(false);
  let selected = $state<Record<string, boolean>>(untrack(() => defaultProviderSelection(app.providers)));

  const lines = $derived(text.split("\n").map((s) => s.trim()).filter(Boolean));

  async function submit() {
    if (submitting) return;
    const chosen = app.providers.filter((p) => p.available && selected[p.id]).map((p) => p.id);
    if (lines.length === 0) return toast.show("질문을 입력하세요", true);
    if (chosen.length === 0) return toast.show("Provider를 선택하세요", true);
    submitting = true;
    try {
      const res = await api.submitBulk(lines, chosen, category.trim() || "general");
      toast.show(`질의가 접수되었습니다(${res.items.length}건 × ${chosen.length} provider)`);
      app.reloadList();
      void app.refresh();
      onclose();
    } catch (e) {
      toast.show((e as Error).message, true);
    } finally {
      submitting = false;
    }
  }
</script>

<Modal title="벌크 입력" icon={ListPlus} size="lg" {onclose}>
  <div class="form">
    <textarea bind:value={text} rows="12" aria-label="질문 목록"></textarea>
    <div class="row">
      <CategoryInput bind:value={category} id="bulk-category" />
      <ProviderChips providers={app.providers} bind:selected />
    </div>
  </div>
  {#snippet footer()}
    <span class="count mono">{lines.length}건</span>
    <button class="secondary" onclick={onclose}>닫기</button>
    <button class="primary" onclick={submit} disabled={submitting}><Send size={16} />일괄 질의하기</button>
  {/snippet}
</Modal>

<style>
  .form { display: flex; flex-direction: column; gap: 12px; }
  textarea { width: 100%; font-size: 14px; line-height: 1.6; }
  .row { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; }
</style>
