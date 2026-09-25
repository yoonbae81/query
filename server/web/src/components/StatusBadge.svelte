<script lang="ts">
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";

  import type { Status } from "../lib/types";

  let { status, label }: { status: Status; label?: string } = $props();
</script>

<span class="badge st-{status}">
  {#if status === "processing"}<LoaderCircle size={14} class="spin" />{/if}
  {label ?? status}
</span>
