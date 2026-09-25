<script lang="ts">
  import { onMount } from "svelte";

  import ExtensionStatusBadge from "../components/ExtensionStatusBadge.svelte";
  import QueryForm from "../components/QueryForm.svelte";
  import QueryList from "../components/QueryList.svelte";
  import SystemPromptPanel from "../components/SystemPromptPanel.svelte";
  import { api } from "../lib/api";
  import { toast } from "../lib/toast.svelte";
  import type { ProviderInfo, QuerySummary } from "../lib/types";

  const PAGE = 20;
  let providers = $state<ProviderInfo[]>([]);
  let items = $state<QuerySummary[]>([]);
  let nextCursor = $state<string | null>(null);
  let loadingMore = $state(false);

  // reset=true: 처음부터 다시 로드. false: 현재 보이는 개수만큼 다시 받아 상태만 갱신
  async function refresh(reset = false) {
    try {
      const limit = reset ? PAGE : Math.min(Math.max(items.length, PAGE), 100);
      const page = await api.listQueries(limit);
      items = page.items;
      nextCursor = page.next_cursor;
    } catch (e) {
      toast.show((e as Error).message, true);
    }
  }

  async function more() {
    loadingMore = true;
    try {
      const page = await api.listQueries(PAGE, nextCursor);
      items = items.concat(page.items);
      nextCursor = page.next_cursor;
    } catch (e) {
      toast.show((e as Error).message, true);
    } finally {
      loadingMore = false;
    }
  }

  onMount(() => {
    api.providers().then((p) => (providers = p)).catch((e: Error) => toast.show(e.message, true));
    refresh(true);
    const t = setInterval(() => !document.hidden && refresh(false), 5000);
    return () => clearInterval(t);
  });
</script>

<div class="row between wrap"><ExtensionStatusBadge /></div>
<SystemPromptPanel />
<QueryForm {providers} onsubmitted={() => refresh(true)} />
<QueryList {items} hasMore={nextCursor !== null} {loadingMore} onmore={more} />
