<script lang="ts">
  import { toast } from "../lib/toast.svelte";
</script>

{#if toast.message}
  <div class="toast" class:error={toast.isError} role="status">{toast.message}</div>
{/if}

<style>
  .toast {
    position: fixed; left: 50%; bottom: max(24px, var(--sab)); transform: translateX(-50%); z-index: 1100;
    background: var(--bg-surface-hover); color: var(--text-primary); border: 1px solid var(--border);
    padding: 10px 16px; border-radius: 8px; max-width: 90vw; font-size: 13px;
    box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.4);
  }
  .toast.error { background: var(--danger-bg); color: var(--danger-fg); border-color: var(--danger-border); }
</style>
