(function () {
  const { el, api, toast, icons, icon, fmtTime, providerName, statusBadge } = window.Q;
  const $ = (id) => document.getElementById(id);
  const queryId = $("header").dataset.queryId;

  let providers = []; // GET /providers
  let results = {}; // provider -> 결과 상태
  let selected = null;
  let es = null;
  let pollTimer = null;

  function merge(r) {
    results[r.provider] = { ...(results[r.provider] || {}), ...r };
  }

  // ---- 렌더링 ----
  function renderTabs() {
    $("tabs").replaceChildren(
      ...providers.map((p) => {
        const r = results[p.id];
        const cls = ["tab", p.id === selected ? "active" : "", r ? "" : "unqueried"].join(" ");
        return el("button", { class: cls, role: "tab", disabled: !r && !p.available, onclick: () => onTab(p, r) },
          p.name, r ? statusBadge(r.status) : null);
      })
    );
  }

  function markdown(text) {
    const div = el("div", { class: "answer" });
    div.innerHTML = window.DOMPurify.sanitize(window.marked.parse(text || ""));
    div.querySelectorAll("a").forEach((a) => { a.target = "_blank"; a.rel = "noopener noreferrer"; });
    return div;
  }

  function renderPanel() {
    const panel = $("panel");
    const r = results[selected];
    if (!r) { panel.replaceChildren(); return; }
    if (r.status === "pending") {
      panel.replaceChildren(el("div", {}, "대기 중"));
    } else if (r.status === "processing") {
      panel.replaceChildren(el("div", { class: "row" }, icon("loader-circle", "spin"), r.progress_message || "처리 중"));
    } else if (r.status === "failed") {
      panel.replaceChildren(
        el("div", { class: "error" }, r.error_message || "실패"),
        el("div", { class: "row" }, el("button", { class: "btn", onclick: () => retry(r) }, icon("refresh-cw"), "다시 시도"))
      );
    } else {
      const links = (r.citations || []).filter((u) => /^https?:\/\//i.test(u));
      panel.replaceChildren(
        el("div", { class: "row end" },
          el("button", { class: "btn", onclick: (ev) => copy(ev.currentTarget, r.answer) }, icon("copy"), "복사")),
        markdown(r.answer),
        links.length ? el("ol", { class: "citations" }, links.map((u) => el("li", {}, el("a", { href: u, target: "_blank", rel: "noopener noreferrer" }, u)))) : null
      );
    }
  }

  function render() {
    renderTabs();
    renderPanel();
    icons();
  }

  // ---- 동작 ----
  async function onTab(p, r) {
    if (r) { selected = p.id; return render(); }
    try {
      const res = await api(`/queries/${queryId}/providers`, { method: "POST", body: { providers: [p.id] } });
      res.results.forEach(merge);
      selected = p.id;
      render();
    } catch (e) { toast(e.message, true); }
  }

  async function retry(r) {
    try {
      await api(`/queries/${queryId}/results/${r.result_id}/retry`, { method: "POST" });
      merge({ provider: r.provider, status: "pending", error_message: null, progress_message: null });
      render();
    } catch (e) { toast(e.message, true); }
  }

  async function copy(btn, text) {
    try { await navigator.clipboard.writeText(text || ""); toast("복사되었습니다"); }
    catch (_) { toast("복사할 수 없습니다", true); }
  }

  // ---- 데이터 로드 / 실시간 ----
  async function load() {
    const q = await api(`/queries/${queryId}`);
    $("q-created").textContent = fmtTime(q.created_at);
    $("q-text").textContent = q.query;
    results = {};
    q.results.forEach(merge);
    if (!selected || !providers.some((p) => p.id === selected)) {
      selected = (q.results[0] && q.results[0].provider) || (providers.find((p) => p.available) || {}).id;
    }
    render();
  }

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(() => load().catch(() => {}), 5000);
  }

  function connect() {
    if (!window.EventSource) return startPolling();
    es = new EventSource(`${window.Q.BASE}/api/v1/queries/${queryId}/stream`);
    const onEvent = (ev) => { merge(JSON.parse(ev.data)); render(); };
    es.addEventListener("result_update", onEvent);
    es.addEventListener("result_added", onEvent);
    es.onerror = () => { if (es.readyState === EventSource.CLOSED) startPolling(); };
  }

  window.addEventListener("pagehide", () => { if (es) es.close(); clearInterval(pollTimer); });

  (async function init() {
    try {
      providers = (await api("/providers")).providers;
      await load();
      connect();
    } catch (e) { toast(e.message, true); }
  })();
})();
