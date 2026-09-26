<script lang="ts">
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import { onDestroy } from "svelte";

  let {
    label,
    text = "",
    disabled = false,
    disabledReason = "",
    ondelete,
  }: {
    /** 접근성 이름이자 툴팁 (예: "Perplexity 결과 삭제") */
    label: string;
    /** 평상시에 아이콘 옆에 보일 문구. 비우면 아이콘만 */
    text?: string;
    disabled?: boolean;
    /** 비활성일 때 툴팁으로 알려줄 이유 */
    disabledReason?: string;
    ondelete: () => Promise<void>;
  } = $props();

  let confirming = $state(false);
  let working = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  // 삭제는 두 번 눌러야 실행된다(DESIGN.md §8). 3초 안에 다시 누르지 않으면 원래대로 돌아간다.
  async function click() {
    if (working) return;
    if (!confirming) {
      confirming = true;
      timer = setTimeout(() => (confirming = false), 3000);
      return;
    }
    clearTimeout(timer);
    confirming = false;
    working = true;
    try {
      await ondelete();
    } finally {
      working = false;
    }
  }

  onDestroy(() => clearTimeout(timer));
</script>

<button
  class="delete"
  class:confirming
  disabled={disabled || working}
  title={disabled && disabledReason ? disabledReason : confirming ? "한 번 더 누르면 삭제됩니다" : label}
  aria-label={confirming ? `${label} 확인` : label}
  onclick={click}
>
  <Trash2 size={15} />
  {#if confirming}<span>삭제 확인</span>{:else if text}<span>{text}</span>{/if}
</button>

<style>
  .delete {
    min-height: 32px; padding: 0 9px; background: transparent; color: var(--text-secondary);
    border: 1px solid var(--border); border-radius: 6px; font-size: 13px;
  }
  .delete:hover:not(:disabled) { color: var(--danger); border-color: var(--danger-border); }
  .delete.confirming { background: var(--danger); border-color: var(--danger); color: #fff; }
  .delete.confirming:hover:not(:disabled) { color: #fff; }
</style>
