<script lang="ts">
  import Send from "@lucide/svelte/icons/send";

  import { api } from "../lib/api";
  import { toast } from "../lib/toast.svelte";
  import type { ProviderInfo } from "../lib/types";

  let { providers, onsubmitted }: { providers: ProviderInfo[]; onsubmitted: () => void } = $props();

  let mode = $state<"single" | "bulk">("single");
  let text = $state("");
  let submitting = $state(false);
  let selected = $state<Record<string, boolean>>({});

  // 기본값: Perplexity 체크(지원되는 경우). 사용자가 건드린 항목은 유지한다.
  // bind:checked가 DOM 값(false)으로 먼저 초기화하지 못하도록 DOM 갱신 전에 실행한다.
  $effect.pre(() => {
    for (const p of providers) {
      if (!(p.id in selected)) selected[p.id] = p.id === "perplexity" && p.available;
    }
  });

  async function submit() {
    if (submitting) return;
    const chosen = providers.filter((p) => p.available && selected[p.id]).map((p) => p.id);
    if (!text.trim()) return toast.show("질문을 입력하세요", true);
    if (chosen.length === 0) return toast.show("Provider를 선택하세요", true);
    submitting = true; // 응답을 받을 때까지 중복 제출 방지
    try {
      let count = 1;
      if (mode === "single") {
        await api.submit(text, chosen);
      } else {
        const lines = text.split("\n").map((s) => s.trim()).filter(Boolean);
        count = (await api.submitBulk(lines, chosen)).items.length;
      }
      toast.show(`질의가 접수되었습니다(${count}건 × ${chosen.length} provider)`);
      text = "";
      onsubmitted();
    } catch (e) {
      toast.show((e as Error).message, true);
    } finally {
      submitting = false;
    }
  }
</script>

<section class="panel">
  <div class="panel-body">
    <div class="segmented" role="tablist">
      <button role="tab" class:active={mode === "single"} onclick={() => (mode = "single")}>개별 입력</button>
      <button role="tab" class:active={mode === "bulk"} onclick={() => (mode = "bulk")}>벌크 입력</button>
    </div>
    <textarea aria-label="질문" rows={mode === "single" ? 4 : 10} bind:value={text}></textarea>
    <div class="row wrap between">
      <div class="checks" aria-label="Provider">
        {#each providers as p (p.id)}
          <label class:disabled={!p.available}>
            <input type="checkbox" disabled={!p.available} bind:checked={selected[p.id]} />
            {p.name}{p.available ? "" : " (준비 중)"}
          </label>
        {/each}
      </div>
      <button class="btn primary" disabled={submitting} onclick={submit}>
        <Send size={16} />{mode === "single" ? "질의하기" : "일괄 질의하기"}
      </button>
    </div>
  </div>
</section>
