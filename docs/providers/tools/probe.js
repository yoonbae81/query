/**
 * 사이트 DOM 캡처 스니펫 (Claude / ChatGPT / Gemini / Perplexity 공용).
 *
 * 보통은 하네스가 주입한다:  python docs/providers/tools/harness.py probe <provider> --state <라벨> [--q 질문일부] [--no-goto]
 * 결과는 user/verify/captures/<provider>/ 에 저장된다(이메일 자동 마스킹). 절차: docs/providers/README.md
 *
 * 콘솔에 직접 붙여넣는 경우(하네스 브라우저가 로그인 상태라 못 찍는 로그아웃 화면 등, 시크릿 창에서):
 *  1. 아래 STATE 를 라벨로 바꾼다: home | typed(입력만 하고 전송 전) | generating | done | done-sources-open | home-loggedout
 *  2. (선택) Q 에 보낸 질문 문장 일부를 넣으면 사용자 메시지 컨테이너도 찾아 준다.
 *  3. DevTools 콘솔에 전체를 붙여넣고 Enter. 결과 JSON 이 클립보드에 복사되고 콘솔에도 출력된다.
 *  4. 공유 전 확인: 답변 본문 앞 120자, 계정 이름, 대화 제목이 들어갈 수 있다(이메일은 마스킹됨).
 *
 * 주의: harness.py 가 아래 STATE/Q 선언 두 줄을 정규식으로 치환하므로 그 두 줄의 형식(한 줄, 큰따옴표 문자열)을 바꾸지 않는다.
 */
(() => {
  const STATE = "home";
  const Q = ""; // 예: "테스트 질문입니다"

  const cut = (s, n = 120) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
  };
  const attrs = (el, names) => {
    const o = {};
    for (const n of names) {
      const v = el.getAttribute(n);
      if (v !== null) o[n] = cut(v, 80);
    }
    return o;
  };
  const KEY_ATTRS = ["id", "data-testid", "data-test-id", "data-message-author-role", "data-is-streaming", "role", "aria-label", "aria-disabled", "aria-busy", "aria-live", "type", "name", "placeholder", "data-placeholder", "contenteditable", "title", "disabled"];
  const sel = (el) => {
    if (!el || !el.tagName) return "";
    let s = el.tagName.toLowerCase();
    if (el.id) s += "#" + el.id;
    const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 4) : [];
    if (cls.length) s += "." + cls.join(".");
    for (const a of ["data-testid", "data-test-id", "data-message-author-role", "role", "aria-label"]) {
      const v = el.getAttribute(a);
      if (v) s += `[${a}="${cut(v, 40)}"]`;
    }
    return s;
  };
  const chain = (el, depth = 4) => {
    const out = [];
    for (let e = el; e && e !== document.body && out.length < depth; e = e.parentElement) out.push(sel(e));
    return out;
  };
  const describe = (el) => ({
    sel: sel(el),
    attrs: attrs(el, KEY_ATTRS),
    text: cut(el.textContent, 60),
    visible: visible(el),
    hasSvg: !!el.querySelector("svg"),
    chain: chain(el.parentElement, 3),
  });

  // 1) 입력창 후보
  const inputs = [...document.querySelectorAll('textarea, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"], [role="textbox"], input[type="text"], input:not([type])')]
    .map((el) => ({ ...describe(el), tag: el.tagName.toLowerCase(), htmlHead: cut(el.innerHTML, 200), value: cut(el.value ?? el.textContent, 40) }));

  // 2) 입력창 주변 버튼(전송/중지 후보) + 키워드로 잡히는 버튼
  const KW = /send|submit|stop|cancel|interrupt|생성 중|중지|정지|전송|보내기|답변 생성|stop generating|voice|mic/i;
  const primary = [...document.querySelectorAll("textarea, [contenteditable='true'], [contenteditable=''], [role='textbox']")].find(visible);
  const near = new Set();
  if (primary) {
    let box = primary;
    for (let i = 0; i < 8 && box.parentElement; i++) {
      box = box.parentElement;
      if (box.querySelectorAll("button, [role='button']").length >= 2) break;
    }
    box.querySelectorAll("button, [role='button']").forEach((b) => near.add(b));
  }
  const kwButtons = [...document.querySelectorAll("button, [role='button']")].filter((b) => KW.test([b.getAttribute("aria-label"), b.getAttribute("data-testid"), b.getAttribute("title"), b.textContent].join(" ")));
  const buttons = [...new Set([...near, ...kwButtons])].map((b) => ({ ...describe(b), nearInput: near.has(b) }));

  // 3) 답변 컨테이너 후보: 알려진 패턴별 개수 + data-testid 분포
  const PATTERNS = [
    '[data-message-author-role="assistant"]',
    '[data-message-author-role="user"]',
    '[data-testid^="conversation-turn"]',
    "article",
    ".markdown",
    ".prose",
    '[class*="font-claude"]',
    "[data-is-streaming]",
    '[data-testid="user-message"]',
    '[data-testid*="message"]',
    "message-content",
    "model-response",
    "user-query",
    ".model-response-text",
    '[class*="response"]',
    '[class*="markdown"]',
    '[aria-live]',
  ];
  const patterns = {};
  for (const p of PATTERNS) {
    let list;
    try {
      list = [...document.querySelectorAll(p)];
    } catch {
      continue;
    }
    if (!list.length) continue;
    const last = list[list.length - 1];
    patterns[p] = { count: list.length, last: sel(last), lastTextLen: (last.textContent ?? "").length, lastText: cut(last.textContent, 120), lastAttrs: attrs(last, KEY_ATTRS), lastChain: chain(last.parentElement, 3) };
  }
  const testids = {};
  document.querySelectorAll("[data-testid], [data-test-id]").forEach((e) => {
    const k = e.getAttribute("data-testid") || e.getAttribute("data-test-id");
    testids[k] = (testids[k] || 0) + 1;
  });
  const customTags = {};
  document.querySelectorAll("*").forEach((e) => {
    const t = e.tagName.toLowerCase();
    if (t.includes("-")) customTags[t] = (customTags[t] || 0) + 1;
  });

  // 4) 사용자 질문 컨테이너 (Q 지정 시): Q 를 포함하는 가장 작은 요소
  let userMessage = null;
  if (Q) {
    const hit = [...document.querySelectorAll("body *")].filter((e) => !e.closest("textarea, [contenteditable]") && (e.textContent ?? "").includes(Q) && ![...e.children].some((c) => (c.textContent ?? "").includes(Q))).pop();
    if (hit) userMessage = { ...describe(hit), chain: chain(hit, 6) };
  }

  // 5) 마지막 답변 후보의 구조 (done/generating 에서 본문 셀렉터 확정용)
  const answerGuess = patterns['[data-message-author-role="assistant"]'] ? [...document.querySelectorAll('[data-message-author-role="assistant"]')].pop() : (document.querySelector("model-response, [class*='font-claude']") ?? null);
  const outline = (el, depth = 0) => {
    if (!el || depth > 4) return "";
    const kids = [...el.children].slice(0, 6).map((c) => outline(c, depth + 1)).filter(Boolean);
    return `${"  ".repeat(depth)}${sel(el)}\n${kids.join("")}`;
  };
  const answer = answerGuess ? { sel: sel(answerGuess), outline: outline(answerGuess), htmlHead: cut(answerGuess.innerHTML, 1500) } : null;

  // 6) 링크/출처
  const host = location.host;
  const ext = [...document.querySelectorAll("a[href^='http']")].filter((a) => new URL(a.href).host !== host);
  const links = { externalCount: ext.length, samples: ext.slice(0, 6).map((a) => ({ href: cut(a.href, 100), text: cut(a.textContent, 40), chain: chain(a.parentElement, 4) })) };
  const sourceControls = [...document.querySelectorAll("button, [role='tab'], summary, a")].filter((e) => /source|citation|reference|links|출처|참고|링크|웹 검색|search/i.test(cut(e.textContent, 60) + " " + (e.getAttribute("aria-label") ?? ""))).slice(0, 10).map(describe);

  // 7) 로그인 신호 / 오버레이
  const LOGIN = /log ?in|sign ?in|sign ?up|get started|로그인|가입|시작하기/i;
  const loginControls = [...document.querySelectorAll("button, a")].filter((e) => visible(e) && LOGIN.test(cut(e.textContent, 40))).slice(0, 10).map(describe);
  const accountControls = [...document.querySelectorAll("[data-testid*='profile' i], [data-testid*='user' i], [data-testid*='account' i], [aria-label*='profile' i], [aria-label*='account' i], [aria-label*='계정'], [aria-label*='프로필'], img[alt*='profile' i]")].slice(0, 8).map(describe);
  const overlays = [...document.querySelectorAll("[role='dialog'], [aria-modal='true'], [role='alertdialog']")].filter(visible).map((e) => ({ ...describe(e), textHead: cut(e.textContent, 160) }));

  const result = {
    state: STATE,
    url: location.href,
    title: document.title,
    lang: document.documentElement.lang,
    viewport: [innerWidth, innerHeight],
    inputs,
    buttons,
    patterns,
    testids,
    customTags,
    userMessage,
    answer,
    links,
    sourceControls,
    loginControls,
    accountControls,
    overlays,
  };
  // 공유 전 개인 정보 마스킹: 이메일 주소
  const json = JSON.stringify(result, null, 1).replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "<email>");
  try {
    if (typeof copy === "function") copy(json); // DevTools 콘솔 유틸
    else navigator.clipboard?.writeText(json);
  } catch { }
  console.log(`[probe:${STATE}] ${json.length} chars, 클립보드에 복사됨(실패 시 아래 JSON 을 직접 복사)`);
  console.log(json);
  return result;
})();
