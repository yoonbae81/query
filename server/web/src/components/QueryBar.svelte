<script lang="ts">
  import Send from "@lucide/svelte/icons/send";
  import { untrack } from "svelte";

  import { api } from "../lib/api";
  import { router } from "../lib/router.svelte";
  import { app, defaultProviderSelection } from "../lib/stores.svelte";
  import { toast } from "../lib/toast.svelte";
  import CategoryInput from "./CategoryInput.svelte";
  import ProviderChips from "./ProviderChips.svelte";

  let text = $state("");
  let category = $state("general");
  let submitting = $state(false);
  let selected = $state<Record<string, boolean>>({});
  let inputEl = $state<HTMLTextAreaElement>();

  // provider 목록이 처음 도착하면 기본 선택(Perplexity)을 적용한다. bind:checked류가 DOM 값으로 먼저 채우지 않도록 DOM 갱신 전에 실행한다.
  $effect.pre(() => {
    if (app.providers.length > 0 && Object.keys(untrack(() => selected)).length === 0) {
      selected = defaultProviderSelection(app.providers);
    }
  });

  // 목록 필터(app.categoryFilter)가 정해지면 입력 카테고리도 따라간다
  $effect(() => {
    const filter = app.categoryFilter;
    if (filter) category = filter;
  });

  function autosize() {
    if (!inputEl) return;
    inputEl.style.height = "auto";
    inputEl.style.height = `${Math.min(inputEl.scrollHeight, 168)}px`;
  }

  async function submit() {
    if (submitting) return; // 응답 전 중복 제출 방지 (PLAN §5.1)
    const chosen = app.providers.filter((p) => p.available && selected[p.id]).map((p) => p.id);
    if (!text.trim()) return toast.show("질문을 입력하세요", true);
    if (chosen.length === 0) return toast.show("Provider를 선택하세요", true);
    submitting = true;
    try {
      const res = await api.submit(text, chosen, category.trim() || "general");
      toast.show(`질의가 접수되었습니다(1건 × ${chosen.length} provider)`);
      text = "";
      queueMicrotask(autosize);
      app.reloadList();
      void app.refresh();
      router.go({ name: "detail", id: res.query_id }); // 진행 상황을 바로 볼 수 있게 상세로 이동
    } catch (e) {
      toast.show((e as Error).message, true);
    } finally {
      submitting = false;
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      void submit();
    }
  }
</script>

<div class="query-bar">
  <CategoryInput bind:value={category} id="bar-category" />
  <textarea
    bind:this={inputEl}
    bind:value={text}
    oninput={autosize}
    onkeydown={onKeydown}
    class="q-input"
    rows="1"
    aria-label="질문"
  ></textarea>
  <div class="controls">
    <ProviderChips providers={app.providers} bind:selected />
    <button class="primary send" onclick={submit} disabled={submitting}>
      <Send size={16} />질의하기
    </button>
  </div>
</div>

<style>
  .query-bar {
    display: flex; gap: 12px; align-items: stretch; background: var(--bg-surface); padding: 12px 16px; border-radius: 8px;
    border: 1px solid var(--border);
  }
  .q-input { flex: 1; min-width: 0; min-height: 40px; max-height: 168px; line-height: 1.5; padding: 9px 12px; font-size: 15px; resize: none; }
  .controls { display: flex; align-items: center; align-self: flex-end; gap: 12px; flex-wrap: wrap; justify-content: flex-end; }
  .send { height: 40px; white-space: nowrap; padding: 0 18px; }
  @media (max-width: 980px) {
    .query-bar { flex-direction: column; align-items: stretch; }
    .controls { align-self: stretch; justify-content: flex-start; }
  }
</style>
