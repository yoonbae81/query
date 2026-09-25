(function () {
  const BASE = document.body.dataset.base || "";

  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") node.className = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else if (k === "text") node.textContent = v;
      else node.setAttribute(k, v === true ? "" : v);
    }
    for (const c of children.flat()) {
      if (c == null) continue;
      node.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return node;
  }

  async function api(path, opts = {}) {
    const init = { method: opts.method || "GET", headers: {} };
    if (opts.body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(opts.body);
    }
    const res = await fetch(`${BASE}/api/v1${path}`, init);
    let data = null;
    try { data = await res.json(); } catch (_) { /* 본문 없음 */ }
    if (!res.ok) throw new Error((data && data.error && data.error.message) || `요청 실패 (${res.status})`);
    return data;
  }

  let toastTimer;
  function toast(message, isError = false) {
    const t = document.getElementById("toast");
    t.textContent = message;
    t.className = isError ? "error" : "";
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 3500);
  }

  function icons() {
    if (window.lucide) window.lucide.createIcons();
  }

  const icon = (name, cls) => el("i", { "data-lucide": name, class: cls });
  const fmtTime = (iso) => (iso ? iso.slice(0, 16).replace("T", " ") : "");
  const PROVIDER_NAMES = { perplexity: "Perplexity", claude: "Claude", gemini: "Gemini", chatgpt: "ChatGPT" };
  const providerName = (id) => PROVIDER_NAMES[id] || id;

  function statusBadge(status, label) {
    const spinner = status === "processing" ? icon("loader-circle", "spin") : null;
    return el("span", { class: `badge st-${status}` }, spinner, label ?? status);
  }

  window.Q = { BASE, el, api, toast, icons, icon, fmtTime, providerName, statusBadge };
})();
