<script lang="ts">
  import { toast } from "../lib/toast.svelte";
</script>

{#if toast.message}
  <div class="toast" class:error={toast.isError} role="status">{toast.message}</div>
{/if}
