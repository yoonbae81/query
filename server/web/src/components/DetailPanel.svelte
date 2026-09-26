<script lang="ts">
  import Check from "@lucide/svelte/icons/check";
  import Copy from "@lucide/svelte/icons/copy";
  import Download from "@lucide/svelte/icons/download";
  import Inbox from "@lucide/svelte/icons/inbox";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import Sparkles from "@lucide/svelte/icons/sparkles";

  import { api, apiUrl } from "../lib/api";
  import { getToken } from "../lib/auth";
  import { fmtTime } from "../lib/format";
  import { router } from "../lib/router.svelte";
  import { app } from "../lib/stores.svelte";
  import { toast } from "../lib/toast.svelte";
  import type { ProviderInfo, QueryDetail, ResultDetail, ResultEvent } from "../lib/types";
  import DeleteButton from "./DeleteButton.svelte";
  import MarkdownView from "./MarkdownView.svelte";
  import SourcesList from "./SourcesList.svelte";
  import StatusBadge from "./StatusBadge.svelte";

  let { id }: { id: string | null } = $props();

  let query = $state<QueryDetail | null>(null);
  let results = $state<Record<string, ResultDetail>>({});
  let selected = $state<string | null>(null);
  let copied = $state(false);
  const current = $derived(selected ? (results[selected] as ResultDetail | undefined) : undefined);
  const providers = $derived(app.providers);

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

  async function load(queryId: string) {
    const q = await api.getQuery(queryId);
    query = q;
    results = {};
    q.results.forEach(merge);
    if (!selected || !providers.some((p) => p.id === selected)) {
      selected = q.results[0]?.provider ?? providers.find((p) => p.available)?.id ?? null;
    }
  }

  // SSE로 실시간 갱신하고, 연결을 쓸 수 없으면 5초 폴링으로 대체한다 (PLAN §5.2)
  $effect(() => {
    const queryId = id;
    if (!queryId) return;
    let es: EventSource | undefined;
    let poll: ReturnType<typeof setInterval> | undefined;
    let cancelled = false;

    const startPolling = () => {
      if (!poll) poll = setInterval(() => load(queryId).catch(() => {}), 5000);
    };
    const connect = () => {
      // EventSource는 인증 헤더를 못 붙이므로 API 토큰을 쓰는 경우에는 폴링한다
      if (!("EventSource" in window) || getToken()) return startPolling();
      es = new EventSource(apiUrl(`/queries/${encodeURIComponent(queryId)}/stream`));
      const onEvent = (ev: MessageEvent) => {
        merge(JSON.parse(ev.data) as ResultEvent);
        void app.refresh(); // 헤더 집계(Queue/답변 수)도 함께 갱신
      };
      es.addEventListener("result_update", onEvent);
      es.addEventListener("result_added", onEvent);
      es.onerror = () => {
        if (es?.readyState === EventSource.CLOSED) startPolling();
      };
    };

    (async () => {
      try {
        await load(queryId);
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
    if (!p.available || !id) return;
    try {
      const res = await api.addProvider(id, p.id);
      const created = res.results[0];
      merge({ provider: p.id, status: "pending", ...(created ? { result_id: created.result_id } : {}) });
      selected = p.id;
      void app.refresh();
    } catch (e) {
      toast.show((e as Error).message, true);
    }
  }

  async function retry(r: ResultDetail) {
    if (!id) return;
    try {
      await api.retry(id, r.result_id);
      merge({ provider: r.provider, status: "pending", error_message: null, progress_message: null });
      void app.refresh();
    } catch (e) {
      toast.show((e as Error).message, true);
    }
  }

  const processing = $derived(Object.values(results).some((r) => r.status === "processing"));

  /** 질문 전체(모든 provider 결과) 삭제 */
  async function deleteAll() {
    if (!id) return;
    try {
      await api.deleteQuery(id);
      toast.show("질의를 삭제했습니다");
      app.reloadList();
      void app.refresh();
      router.go({ name: "home" });
    } catch (e) {
      toast.show((e as Error).message, true);
    }
  }

  /** 현재 provider의 결과 하나 삭제. 마지막 결과였다면 질문도 함께 사라지므로 목록으로 돌아간다. */
  async function deleteOne(r: ResultDetail) {
    if (!id) return;
    try {
      const res = await api.deleteResult(id, r.result_id);
      app.reloadList();
      void app.refresh();
      if (res.query_deleted) {
        toast.show("질의를 삭제했습니다");
        router.go({ name: "home" });
        return;
      }
      delete results[r.provider];
      selected = Object.keys(results)[0] ?? null;
      toast.show(`${providers.find((p) => p.id === r.provider)?.name ?? r.provider} 결과를 삭제했습니다`);
    } catch (e) {
      toast.show((e as Error).message, true);
    }
  }

  async function copy(text: string | null) {
    try {
      await navigator.clipboard.writeText(text ?? "");
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      toast.show("복사할 수 없습니다", true);
    }
  }
</script>

<section class="panel">
  {#if !id}
    <div class="empty"><Inbox size={26} />질의를 선택하세요</div>
  {:else}
    <div class="panel-header">
      <div class="header-left">
        <span class="panel-title">답변</span>
        <span class="mono id">{id}</span>
        {#if query}<span class="badge purple">{query.category}</span>{/if}
      </div>
      <div class="header-right">
        <span class="mono time">{fmtTime(query?.created_at)}</span>
        <DeleteButton
          label="질의 삭제"
          text="질의 삭제"
          disabled={processing}
          disabledReason="처리 중인 provider가 있어 삭제할 수 없습니다"
          ondelete={deleteAll}
        />
      </div>
    </div>

    <div class="scroll">
      <div class="question">{query?.query ?? ""}</div>

      <div class="tabs" role="tablist">
        {#each providers as p (p.id)}
          {@const r = results[p.id] as ResultDetail | undefined}
          <button
            role="tab"
            class="tab"
            class:active={p.id === selected}
            class:unqueried={!r}
            aria-selected={p.id === selected}
            disabled={!r && !p.available}
            onclick={() => onTab(p)}
          >
            {p.name}
            {#if r}<StatusBadge status={r.status} />{/if}
          </button>
        {/each}
      </div>

      {#if current}
        <div class="answer">
          <div class="answer-head">
            <span class="title"><Sparkles size={15} class="sparkles" />{providers.find((p) => p.id === selected)?.name ?? selected}</span>
            {#if current.status === "done"}<span class="mono count">{current.answer?.length ?? 0}자</span>{/if}
            <span class="grow"></span>
            {#if current.status === "done"}
              <button class="icon-btn" onclick={() => copy(current.answer)} title={copied ? "복사 완료" : "답변 복사"} aria-label="답변 복사">
                {#if copied}<Check size={15} />{:else}<Copy size={15} />{/if}
              </button>
              <button
                class="icon-btn dl"
                onclick={() => api.download(id, current.result_id).catch((e) => toast.show((e as Error).message, true))}
                title="마크다운 파일 다운로드"
                aria-label="마크다운 파일 다운로드"
              ><Download size={15} /></button>
            {/if}
            <DeleteButton
              label="{providers.find((p) => p.id === selected)?.name ?? selected} 결과 삭제"
              disabled={current.status === "processing"}
              disabledReason="처리 중에는 삭제할 수 없습니다"
              ondelete={() => deleteOne(current)}
            />
          </div>

          <div class="answer-body">
            {#if current.status === "pending"}
              <div class="state">대기 중</div>
            {:else if current.status === "processing"}
              <div class="state"><LoaderCircle size={22} class="spin loader" /><span>{current.progress_message ?? "처리 중"}</span></div>
            {:else if current.status === "failed"}
              <div class="state failed">
                <span class="err">{current.error_message ?? "실패"}</span>
                <button class="secondary" onclick={() => retry(current)}><RefreshCw size={15} />다시 시도</button>
              </div>
            {:else}
              <MarkdownView text={current.answer ?? ""} />
            {/if}
          </div>
        </div>

        {#if current.status === "done"}
          <SourcesList citations={current.citations} />
        {/if}
      {/if}
    </div>
  {/if}
</section>

<style>
  .panel { background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; display: flex; flex-direction: column; height: 100%; min-height: 0; overflow: hidden; }
  .panel-header {
    min-height: 48px; padding: 6px 16px; border-bottom: 1px solid var(--border); display: flex; align-items: center;
    justify-content: space-between; gap: 10px; background: var(--bg-overlay);
  }
  .header-left { display: flex; align-items: center; gap: 8px; min-width: 0; flex-wrap: wrap; }
  .panel-title { font-size: 14px; font-weight: 600; white-space: nowrap; }
  .id, .time { font-size: 12px; color: var(--text-muted); }
  .header-right { display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
  .scroll { flex: 1; overflow-y: auto; min-height: 0; padding: 16px; display: flex; flex-direction: column; gap: 16px; }
  .question { white-space: pre-wrap; word-break: break-word; font-size: 15px; font-weight: 600; line-height: 1.6; }
  .tabs { display: flex; gap: 2px; overflow-x: auto; border-bottom: 1px solid var(--border); flex-shrink: 0; }
  .tab {
    padding: 8px 14px; border-radius: 6px 6px 0 0; border-bottom: 2px solid transparent; color: var(--text-secondary);
    white-space: nowrap; background: none;
  }
  .tab:hover:not(:disabled) { color: var(--text-primary); background: var(--bg-surface-hover); }
  .tab.active { color: var(--text-primary); border-bottom-color: var(--accent); font-weight: 600; }
  .tab.unqueried { opacity: 0.55; }
  .tab:disabled { opacity: 0.3; }
  .answer { border: 1px solid var(--border); border-radius: 8px; overflow: hidden; background: var(--bg-primary); flex-shrink: 0; }
  .answer-head { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-bottom: 1px solid var(--border); background: var(--bg-overlay); }
  .title { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; }
  .title :global(.sparkles) { color: #3b82f6; }
  .count { font-size: 12px; color: var(--text-muted); }
  .grow { flex: 1; }
  .icon-btn { width: 32px; height: 32px; min-width: 32px; min-height: 32px; padding: 0; }
  .dl { display: inline-flex; align-items: center; justify-content: center; border-radius: 6px; }
  .answer-body { padding: 16px; }
  .state { display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 10px; padding: 32px 16px; color: var(--text-secondary); }
  .state.failed { gap: 14px; }
  .state :global(.loader) { color: var(--accent); }
  .err { color: var(--danger-fg); white-space: pre-wrap; text-align: center; }
  .empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; color: var(--text-muted); }
</style>
