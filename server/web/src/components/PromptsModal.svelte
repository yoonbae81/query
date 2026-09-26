<script lang="ts">
  import Plus from "@lucide/svelte/icons/plus";
  import Save from "@lucide/svelte/icons/save";
  import ScrollText from "@lucide/svelte/icons/scroll-text";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import { onMount } from "svelte";

  import { api, ApiError } from "../lib/api";
  import { app } from "../lib/stores.svelte";
  import { toast } from "../lib/toast.svelte";
  import Modal from "./Modal.svelte";

  let { onclose }: { onclose: () => void } = $props();

  // 서버의 카테고리 이름 규칙과 같다 (domain/category.ts)
  const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,31}$/u;

  let selected = $state("general");
  let content = $state("");
  let original = $state("");
  let loading = $state(false);
  let saving = $state(false);
  let confirmingDelete = $state(false);
  let newName = $state("");
  /** 이번에 새로 만든(아직 저장 전인) 카테고리 이름 */
  let created = $state<string[]>([]);

  const names = $derived([
    ...new Set(["general", ...app.categories.map((c) => c.category), ...created]),
  ]);
  const hasPrompt = (name: string) => app.categories.find((c) => c.category === name)?.has_prompt ?? false;
  const dirty = $derived(content !== original);
  const isGeneral = $derived(selected === "general");

  async function load(name: string) {
    loading = true;
    try {
      const p = await api.getPrompt(name);
      content = original = p.content;
    } catch (e) {
      if (e instanceof ApiError) content = original = ""; // 아직 답변 작성 지침 파일이 없는 카테고리
      else toast.show((e as Error).message, true);
    } finally {
      loading = false;
    }
  }

  async function select(name: string) {
    if (name === selected) return;
    if (dirty && !confirm("저장하지 않은 변경이 있습니다. 버리시겠습니까?")) return;
    selected = name;
    confirmingDelete = false;
    await load(name);
  }

  async function addCategory() {
    const name = newName.trim().toLowerCase();
    if (!NAME_RE.test(name)) return toast.show("카테고리는 글자·숫자·-·_ 로 32자 이내여야 합니다.", true);
    if (!names.includes(name)) created = [...created, name];
    newName = "";
    await select(name);
  }

  async function save() {
    saving = true;
    try {
      await api.savePrompt(selected, content);
      original = content;
      toast.show("저장되었습니다");
      await app.refresh();
    } catch (e) {
      toast.show((e as Error).message, true);
    } finally {
      saving = false;
    }
  }

  async function remove() {
    if (!confirmingDelete) {
      confirmingDelete = true; // 한 번 더 눌러야 삭제된다
      return;
    }
    try {
      await api.deletePrompt(selected);
      toast.show("삭제되었습니다");
      created = created.filter((n) => n !== selected);
      confirmingDelete = false;
      await app.refresh();
      selected = "general";
      await load("general");
    } catch (e) {
      toast.show((e as Error).message, true);
    }
  }

  onMount(() => {
    void app.refresh();
    void load("general");
  });
</script>

<Modal title="카테고리별 답변 작성 지침" icon={ScrollText} size="xl" {onclose}>
  <div class="layout">
    <aside class="list">
      <div class="add">
        <input
          bind:value={newName}
          maxlength="32"
          aria-label="새 카테고리"
          placeholder="새 카테고리"
          autocomplete="off"
          spellcheck="false"
          onkeydown={(e) => e.key === "Enter" && !e.isComposing && addCategory()}
        />
        <button class="icon-btn" onclick={addCategory} aria-label="카테고리 추가" title="카테고리 추가"><Plus size={16} /></button>
      </div>
      <ul>
        {#each names as name (name)}
          <li>
            <button class="item" class:active={name === selected} onclick={() => select(name)}>
              <span class="name mono">{name}</span>
              {#if hasPrompt(name)}<span class="badge purple">지침</span>{:else if name !== "general"}<span class="badge gray">general 적용</span>{/if}
            </button>
          </li>
        {/each}
      </ul>
    </aside>

    <section class="editor">
      <div class="editor-head">
        <span class="mono title">{selected}.md</span>
        {#if dirty}<span class="badge yellow">수정됨</span>{/if}
        {#if !isGeneral && !hasPrompt(selected) && !dirty}<span class="badge gray">general 적용</span>{/if}
      </div>
      <textarea bind:value={content} disabled={loading} aria-label="{selected} 답변 작성 지침" spellcheck="false"></textarea>
      <div class="actions">
        {#if !isGeneral}
          <button class="danger" onclick={remove} disabled={!hasPrompt(selected)}>
            <Trash2 size={15} />{confirmingDelete ? "삭제 확인" : "삭제"}
          </button>
        {/if}
        <span class="grow"></span>
        <span class="mono count">{content.length}자</span>
        <button class="primary" onclick={save} disabled={saving || !dirty}><Save size={16} />저장</button>
      </div>
    </section>
  </div>
</Modal>

<style>
  .layout { display: grid; grid-template-columns: 240px 1fr; gap: 16px; height: 100%; min-height: 0; }
  .list { display: flex; flex-direction: column; gap: 10px; min-height: 0; border-right: 1px solid var(--border); padding-right: 16px; }
  .add { display: flex; gap: 6px; }
  .add input { flex: 1; min-width: 0; height: 36px; font-family: var(--font-mono); font-size: 13px; }
  ul { list-style: none; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
  .item { width: 100%; justify-content: space-between; padding: 8px 10px; border-radius: 6px; color: var(--text-secondary); font-weight: 500; text-align: left; }
  .item:hover { background: var(--bg-surface-hover); color: var(--text-primary); }
  .item.active { background: var(--bg-surface-hover); color: var(--text-primary); box-shadow: inset 2px 0 0 var(--accent); }
  .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .editor { display: flex; flex-direction: column; gap: 10px; min-height: 0; min-width: 0; }
  .editor-head { display: flex; align-items: center; gap: 8px; }
  .title { font-size: 13px; color: var(--text-secondary); }
  textarea { flex: 1; min-height: 240px; font-family: var(--font-mono); font-size: 13px; line-height: 1.6; resize: none; }
  .actions { display: flex; align-items: center; gap: 10px; }
  .grow { flex: 1; }
  .count { font-size: 12px; color: var(--text-muted); }
  @media (max-width: 640px) {
    .layout { grid-template-columns: 1fr; grid-template-rows: auto 1fr; }
    .list { border-right: none; border-bottom: 1px solid var(--border); padding: 0 0 12px; max-height: 34dvh; }
  }
</style>
