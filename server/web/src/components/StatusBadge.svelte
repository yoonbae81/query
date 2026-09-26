<script lang="ts">
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";

  import type { Status } from "../lib/types";

  let { status, label }: { status: Status; label?: string } = $props();

  const COLOR: Record<Status, string> = { pending: "gray", processing: "yellow", done: "green", failed: "red" };
</script>

<span class="badge {COLOR[status]}">
  {#if status === "processing"}<LoaderCircle size={12} class="spin" />{/if}
  {label ?? status}
</span>
