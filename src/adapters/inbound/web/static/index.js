(function () {
  const { BASE, el, api, toast, icons, fmtTime, providerName, statusBadge } = window.Q;
  const $ = (id) => document.getElementById(id);

  let mode = "single";
  let items = [];
  let nextCursor = null;
  let providers = [];

  // ---- 시스템 프롬프트 ----
  async function loadPrompt() {
    try { $("prompt-text").value = (await api("/config/system-prompt")).content; }
    catch (e) { toast(e.message, true); }
  }
  $("prompt-save").addEventListener("click", async (ev) => {
    ev.currentTarget.disabled = true;
    try { await api("/config/system-prompt", { method: "PUT", body: { content: $("prompt-text").value } }); toast("저장되었습니다"); }
    catch (e) { toast(e.message, true); }
    finally { ev.currentTarget.disabled = false; }
  });

  // ---- 입력 ----
  document.querySelectorAll("#mode button").forEach((b) =>
    b.addEventListener("click", () => {
      mode = b.dataset.mode;
      document.querySelectorAll("#mode button").forEach((x) => x.classList.toggle("active", x === b));
      $("submit-label").textContent = mode === "single" ? "질의하기" : "일괄 질의하기";
      $("question").rows = mode === "single" ? 4 : 10;
    })
  );

  async function loadProviders() {
    providers = (await api("/providers")).providers;
    const box = $("providers");
    box.replaceChildren(
      ...providers.map((p) => {
        const input = el("input", { type: "checkbox", value: p.id, checked: p.id === "perplexity" && p.available, disabled: !p.available });
        return el("label", { class: p.available ? "" : "disabled" }, input, p.name + (p.available ? "" : " (준비 중)"));
      })
    );
  }

  const selectedProviders = () => [...document.querySelectorAll("#providers input:checked")].map((i) => i.value);

  $("submit").addEventListener("click", async (ev) => {
    const btn = ev.currentTarget;
    const text = $("question").value;
    const chosen = selectedProviders();
    if (!text.trim()) return toast("질문을 입력하세요", true);
    if (!chosen.length) return toast("Provider를 선택하세요", true);
    btn.disabled = true; // 응답 도달 전 중복 제출 방지
    try {
      let count = 1;
      if (mode === "single") {
        await api("/queries", { method: "POST", body: { query: text, providers: chosen } });
      } else {
        const lines = text.split("\n").map((s) => s.trim()).filter(Boolean);
        const res = await api("/queries/bulk", { method: "POST", body: { queries: lines, providers: chosen } });
        count = res.items.length;
      }
      toast(`질의가 접수되었습니다(${count}건 × ${chosen.length} provider)`);
      $("question").value = "";
      await refresh(true);
    } catch (e) {
      toast(e.message, true);
    } finally {
      btn.disabled = false;
    }
  });

  // ---- 목록 ----
  function render() {
    const rows = $("rows");
    rows.replaceChildren(
      ...items.map((it) =>
        el("tr", { onclick: () => (location.href = `${BASE}/queries/${it.query_id}`) },
          el("td", {}, it.query_id),
          el("td", {}, it.batch_id || "-"),
          el("td", { class: "q", title: it.query }, it.query),
          el("td", {}, it.results_summary.map((r) => statusBadge(r.status, `${providerName(r.provider)}: ${r.status}`))),
          el("td", { class: "time" }, fmtTime(it.created_at))
        )
      )
    );
    $("empty").hidden = items.length > 0;
    $("more").hidden = !nextCursor;
    icons();
  }

  // reset=true: 처음부터 다시 로드. false: 현재 보이는 개수만큼 다시 받아 상태만 갱신
  async function refresh(reset = false) {
    try {
      const limit = reset ? 20 : Math.min(Math.max(items.length, 20), 100);
      const page = await api(`/queries?limit=${limit}`);
      items = page.items;
      nextCursor = page.next_cursor;
      render();
    } catch (e) { toast(e.message, true); }
  }

  $("more").addEventListener("click", async (ev) => {
    ev.currentTarget.disabled = true;
    try {
      const page = await api(`/queries?limit=20&cursor=${encodeURIComponent(nextCursor)}`);
      items = items.concat(page.items);
      nextCursor = page.next_cursor;
      render();
    } catch (e) { toast(e.message, true); }
    finally { ev.currentTarget.disabled = false; }
  });

  icons();
  Promise.all([loadPrompt(), loadProviders().catch((e) => toast(e.message, true)), refresh(true)]);
  setInterval(() => { if (!document.hidden) refresh(false); }, 5000);
})();
