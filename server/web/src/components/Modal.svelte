<script lang="ts">
  import X from "@lucide/svelte/icons/x";
  import type { Component, Snippet } from "svelte";

  let {
    title,
    icon,
    size = "md",
    onclose,
    children,
    footer,
    actions,
  }: {
    title: string;
    icon?: Component<{ size?: number | string }>;
    size?: "md" | "lg" | "xl";
    onclose: () => void;
    children: Snippet;
    footer?: Snippet;
    /** 헤더 오른쪽(닫기 버튼 앞)에 넣을 버튼들 */
    actions?: Snippet;
  } = $props();
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && onclose()} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="modal-backdrop" onclick={onclose} role="presentation">
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="modal-card"
    class:modal-lg={size === "lg"}
    class:modal-xl={size === "xl"}
    onclick={(e) => e.stopPropagation()}
    role="dialog"
    tabindex="-1"
    aria-modal="true"
    aria-label={title}
  >
    <div class="modal-header">
      <div class="modal-title">
        {#if icon}
          {@const Icon = icon}
          <Icon size={18} />
        {/if}
        <h3>{title}</h3>
      </div>
      <div class="header-actions">
        {@render actions?.()}
        <button class="icon-btn-ghost" onclick={onclose} aria-label="닫기"><X size={18} /></button>
      </div>
    </div>
    <div class="modal-body">{@render children()}</div>
    {#if footer}<div class="modal-footer">{@render footer()}</div>{/if}
  </div>
</div>

<style>
  .header-actions { display: flex; align-items: center; gap: 4px; }
</style>
