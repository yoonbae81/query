<script lang="ts">
  import ArrowLeft from "@lucide/svelte/icons/arrow-left";
  import Copy from "@lucide/svelte/icons/copy";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";

  import MarkdownView from "../components/MarkdownView.svelte";
  import StatusBadge from "../components/StatusBadge.svelte";
  import { api, apiUrl } from "../lib/api";
  import { fmtTime, safeLinks } from "../lib/format";
  import { router } from "../lib/router.svelte";
  import { toast } from "../lib/toast.svelte";
  import type { ProviderInfo, QueryDetail, ResultDetail, ResultEvent } from "../lib/types";

  let { id }: { id: string } = $props();

  let providers = $state<ProviderInfo[]>([]);
  let query = $state<QueryDetail | null>(null);
  let results = $state<Record<string, ResultDetail>>({});
  let selected = $state<string | null>(null);
  const current = $derived(selected ? results[selected] : undefined);

  const EMPTY: Omit<ResultDetail, "provider"> = {
    result_id: "",
    status: "pending",
    answer: null,
    citations: null,
    progress_message: null,
    error_message: null,
    retry_count: 0,
  };

  function merge(patch: Partial<ResultDetail> & { provider: string }) {
    const prev = results[patch.provider] as ResultDetail | undefined;
    results[patch.provider] = { ...EMPTY, ...prev, ...patch };
  }

  async function load() {
    const q = await api.getQuery(id);
    query = q;
    results = {};
    q.results.forEach(merge);
    if (!selected || !providers.some((p) => p.id === selected)) {
      selected = q.results[0]?.provider ?? providers.find((p) => p.available)?.id ?? null;
    }
  }

  // SSE로 실시간 갱신하고, 연결을 쓸 수 없으면 5초 폴링으로 대체한다 (PLAN §5.2)
  $effect(() => {
    let es: EventSource | undefined;
    let poll: ReturnType<typeof setInterval> | undefined;
    let cancelled = false;

    const startPolling = () => {
      if (!poll) poll = setInterval(() => load().catch(() => {}), 5000);
    };
    const connect = () => {
      if (!("EventSource" in window)) return startPolling();
      es = new EventSource(apiUrl(`/queries/${id}/stream`));
      const onEvent = (ev: MessageEvent) => merge(JSON.parse(ev.data) as ResultEvent);
      es.addEventListener("result_update", onEvent);
      es.addEventListener("result_added", onEvent);
      es.onerror = () => {
        if (es?.readyState === EventSource.CLOSED) startPolling();
      };
    };

    (async () => {
      try {
        providers = await api.providers();
        await load();
        if (!cancelled) connect();
      } catch (e) {
        toast.show((e as Error).message, true);
      }
    })();

    return () => {
      cancelled = true;
      es?.close();
      clearInterval(poll);
    };
  });

  async function onTab(p: ProviderInfo) {
    if (results[p.id]) {
      selected = p.id;
      return;
    }
    if (!p.available) return;
    try {
      const res = await api.addProvider(id, p.id);
      const created = res.results[0];
      merge({ provider: p.id, status: "pending", ...(created ? { result_id: created.result_id } : {}) });
      selected = p.id;
    } catch (e) {
      toast.show((e as Error).message, true);
    }
  }

  async function retry(r: ResultDetail) {
    try {
      await api.retry(id, r.result_id);
      merge({ provider: r.provider, status: "pending", error_message: null, progress_message: null });
    } catch (e) {
      toast.show((e as Error).message, true);
    }
  }

  async function copy(text: string | null) {
    try {
      await navigator.clipboard.writeText(text ?? "");
      toast.show("복사되었습니다");
    } catch {
      toast.show("복사할 수 없습니다", true);
    }
  }

  function goHome(e: MouseEvent) {
    e.preventDefault();
    router.go({ name: "home" });
  }
</script>

<div class="row">
  <a class="btn ghost" href={router.href({ name: "home" })} onclick={goHome}><ArrowLeft size={16} />목록</a>
</div>

<section class="panel">
  <div class="panel-body">
    <div class="meta"><strong>{id}</strong><span>{fmtTime(query?.created_at)}</span></div>
    <p class="question">{query?.query ?? ""}</p>
  </div>
</section>

<section class="panel">
  <div class="tabs" role="tablist">
    {#each providers as p (p.id)}
      {@const r = results[p.id]}
      <button
        role="tab"
        class="tab"
        class:active={p.id === selected}
        class:unqueried={!r}
        disabled={!r && !p.available}
        onclick={() => onTab(p)}
      >
        {p.name}
        {#if r}<StatusBadge status={r.status} />{/if}
      </button>
    {/each}
  </div>
  <div class="panel-body">
    {#if current}
      {#if current.status === "pending"}
        <div>대기 중</div>
      {:else if current.status === "processing"}
        <div class="row"><LoaderCircle size={16} class="spin" />{current.progress_message ?? "처리 중"}</div>
      {:else if current.status === "failed"}
        <div class="error">{current.error_message ?? "실패"}</div>
        <div class="row">
          <button class="btn" onclick={() => retry(current)}><RefreshCw size={16} />다시 시도</button>
        </div>
      {:else}
        <div class="row end">
          <button class="btn" onclick={() => copy(current.answer)}><Copy size={16} />복사</button>
        </div>
        <MarkdownView text={current.answer ?? ""} />
        {#if safeLinks(current.citations).length > 0}
          <ol class="citations">
            {#each safeLinks(current.citations) as url (url)}
              <li><a href={url} target="_blank" rel="noopener noreferrer">{url}</a></li>
            {/each}
          </ol>
        {/if}
      {/if}
    {/if}
  </div>
</section>
