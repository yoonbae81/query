#!/usr/bin/env python3
"""Provider 사이트 모듈 검증 하네스 (docs/providers/README.md 참고).

로그인된 실제 Chrome(전용 프로필 + 원격 디버깅 포트)에 붙어서, 확장의 사이트 모듈(Site)을 각 사이트 탭에 주입해
`isLoggedIn → submit → waitForCompletion → extract` 를 실제 DOM에서 직접 실행한다. 서버·확장 설치 없이 동작한다.

  python docs/providers/tools/harness.py launch                     # Chrome 실행 (사용자가 4개 사이트에 로그인)
  python docs/providers/tools/harness.py bundle                     # 사이트 모듈 번들 생성 (소스 수정 후 매번)
  python docs/providers/tools/harness.py smoke                      # 표준 시나리오 전체 (로그인/간단 질문/웹 검색 출처)
  python docs/providers/tools/harness.py run claude -p "질문"       # 한 사이트 한 질문 (최종 텍스트·출처 출력)
  python docs/providers/tools/harness.py trace claude               # 신호(중지 버튼/스트리밍 표시 등)를 0.5초 단위로 추적
  python docs/providers/tools/harness.py probe claude --state done  # DOM 캡처(probe.js)를 파일로 저장

전제: `pip install playwright` (브라우저 다운로드는 불필요, 설치된 Chrome에 CDP로 붙는다), Node(esbuild는 extension/node_modules).
산출물(캡처·리포트·번들·브라우저 프로필)은 모두 user/ 아래(.gitignore 대상)에 저장한다 — 계정 정보가 들어 있을 수 있다.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import pathlib
import platform
import re
import shutil
import subprocess
import sys
import time
import urllib.request

if hasattr(sys.stdout, "reconfigure"):  # Windows 콘솔(cp949)에서 한글/이모지 출력 깨짐 방지
    sys.stdout.reconfigure(encoding="utf-8")

TOOLS = pathlib.Path(__file__).resolve().parent
ROOT = TOOLS.parents[2]  # docs/providers/tools → 저장소 루트
OUT = ROOT / "user" / "verify"
PROFILE = ROOT / "user" / "browser-profile"
BUNDLE = OUT / "sites.js"
CDP = "http://127.0.0.1:9222"

# provider 등록 정보: 호스트(탭 찾기), 새 대화 URL. 확장의 providers/registry.ts 와 같아야 한다.
PROVIDERS = {
    "claude": {"host": "claude.ai", "url": "https://claude.ai/new"},
    "chatgpt": {"host": "chatgpt.com", "url": "https://chatgpt.com/"},
    "gemini": {"host": "gemini.google.com", "url": "https://gemini.google.com/app"},
    "perplexity": {"host": "perplexity.ai", "url": "https://www.perplexity.ai/"},
}

# trace 서브커맨드가 0.5초마다 읽는 신호. UI가 바뀌면 어떤 신호가 어긋났는지 여기서 바로 보인다.
TRACE_JS = {
    "claude": """() => {
      const m = [...document.querySelectorAll('[data-testid="assistant-message"]')].pop();
      return {
        stop: !!document.querySelector('button[data-testid="chat-input-stop"]'),
        streaming: m?.getAttribute('data-is-streaming') ?? null,
        blocks: m ? [...m.querySelectorAll('.standard-markdown')].map(e => e.textContent.length) : null,
        turnStatus: m ? [...m.querySelectorAll('[data-testid="TurnStatus"]')].map(e => e.getAttribute('data-state')) : null,
        send: !!document.querySelector('button[data-testid="chat-input-send"]'),
      };
    }""",
    "chatgpt": """() => {
      const m = [...document.querySelectorAll('[data-message-author-role="assistant"]')].pop();
      return {
        stop: !!document.querySelector('button[data-testid="stop-button"]'),
        send: !!document.querySelector('button[data-testid="send-button"]'),
        streamingBlocks: document.querySelectorAll('.markdown.streaming-animation').length,
        blocks: m ? [...m.querySelectorAll('.markdown')].map(e => e.textContent.length) : null,
        path: location.pathname,
      };
    }""",
    "gemini": """() => {
      const r = [...document.querySelectorAll('model-response')].pop();
      const c = document.querySelector('[data-test-id="send-button-container"]');
      return {
        sendContainer: !!c,
        containerLabel: c?.querySelector('button')?.getAttribute('aria-label') ?? null,
        inputBlank: document.querySelector('rich-textarea .ql-editor')?.classList.contains('ql-blank') ?? null,
        blocks: r ? [...r.querySelectorAll('message-content .markdown')].map(e => e.textContent.length) : null,
        ariaBusy_UNRELIABLE: r?.querySelector('message-content .markdown')?.getAttribute('aria-busy') ?? null,
        path: location.pathname,
      };
    }""",
    "perplexity": """() => ({
      stop: !!document.querySelector('button[aria-label^="Stop response"]'),
      blocks: [...document.querySelectorAll('div.prose[data-renderer="lm"]')].map(e => e.textContent.length),
      path: location.pathname,
    })""",
}

# smoke 표준 시나리오. 질문을 바꾸면 provider 문서(docs/providers/<id>.md)의 기대 결과도 함께 갱신한다.
SCENARIOS = {
    "simple": {"prompt": "1+1은? 숫자만 답해.", "check": lambda a: "2" in a["text"], "expect": "본문에 '2'"},
    "web": {
        "prompt": "오늘 서울 날씨와 최신 뉴스 3개, 출처 포함",
        "check": lambda a: len(a["text"]) > 100 and len(a["citations"]) >= 1,
        "expect": "본문 100자 초과 + 출처 1개 이상",
    },
}


def cdp_alive() -> bool:
    try:
        urllib.request.urlopen(f"{CDP}/json/version", timeout=2).read()
        return True
    except Exception:
        return False


def chrome_path() -> str:
    system = platform.system()
    candidates = {
        "Windows": [r"C:\Program Files\Google\Chrome\Application\chrome.exe", r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"],
        "Darwin": ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
        "Linux": ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium"],
    }.get(system, [])
    for c in candidates:
        if pathlib.Path(c).exists():
            return c
    found = shutil.which("google-chrome") or shutil.which("chrome")
    if found:
        return found
    sys.exit("Chrome 실행 파일을 찾지 못했습니다. chrome_path()에 경로를 추가하세요.")


def cmd_launch(_: argparse.Namespace) -> None:
    if cdp_alive():
        print("이미 실행 중:", CDP)
        return
    PROFILE.mkdir(parents=True, exist_ok=True)
    # 진짜 Chrome + 자동화 플래그 없음: Google(Gemini) 로그인이 자동화 브라우저로 차단되는 것을 피한다.
    # Chrome 136+ 는 기본 프로필에서 원격 디버깅을 막으므로 반드시 별도 --user-data-dir 를 쓴다.
    args = [chrome_path(), "--remote-debugging-port=9222", f"--user-data-dir={PROFILE}", "--no-first-run", "--no-default-browser-check", "--window-size=1280,900"]
    args += [p["url"] for p in PROVIDERS.values()]
    subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(30):
        if cdp_alive():
            print("Chrome 실행됨. 4개 사이트에 로그인한 뒤 알려 주세요. (창을 닫으면 종료됩니다)")
            return
        time.sleep(1)
    sys.exit("Chrome 원격 디버깅 포트에 연결하지 못했습니다.")


def cmd_bundle(_: argparse.Namespace) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    npx = shutil.which("npx") or sys.exit("npx(Node)가 필요합니다.")
    r = subprocess.run(
        [npx, "esbuild", str(TOOLS / "entry.ts"), "--bundle", "--format=iife", "--target=chrome116", f"--outfile={BUNDLE}", "--log-level=warning"],
        cwd=ROOT / "extension",
    )
    if r.returncode != 0:
        sys.exit("번들 실패")
    print("번들 생성:", BUNDLE)


# ---- 페이지 조작 ----------------------------------------------------------------------------------------------

def connect(p):
    if not cdp_alive():
        sys.exit("Chrome이 실행 중이 아닙니다. 먼저: harness.py launch")
    return p.chromium.connect_over_cdp(CDP)


def find_page(browser, name: str):
    host = PROVIDERS[name]["host"]
    for ctx in browser.contexts:
        for pg in ctx.pages:
            if host in pg.url:
                return pg
    ctx = browser.contexts[0]
    pg = ctx.new_page()
    pg.goto(PROVIDERS[name]["url"], wait_until="domcontentloaded")
    return pg


def prep(browser, name: str, goto: bool = True):
    """탭을 새 대화 화면으로 이동하고 사이트 모듈 번들을 주입한다."""
    if not BUNDLE.exists():
        sys.exit("번들이 없습니다. 먼저: harness.py bundle")
    pg = find_page(browser, name)
    pg.bring_to_front()  # 백그라운드 탭은 타이머/렌더링이 늦춰질 수 있다
    if goto:
        pg.goto(PROVIDERS[name]["url"], wait_until="domcontentloaded")
        pg.wait_for_timeout(3000)
    pg.evaluate(BUNDLE.read_text(encoding="utf-8"))
    return pg


def site(pg, name: str, expr: str):
    return pg.evaluate(f"(async () => {{ const s = window.__sites.{name}(); return await ({expr}); }})()")


def run_once(pg, name: str, prompt: str) -> dict:
    """한 질의를 끝까지 실행하고 단계별 결과를 돌려준다. 실패해도 예외 대신 error 필드에 담는다."""
    res: dict = {"provider": name, "prompt": prompt}
    t0 = time.time()
    try:
        res["logged_in"] = site(pg, name, "s.isLoggedIn()")
        if not res["logged_in"]:
            res["error"] = "login_required: 로그인 상태가 아닙니다"
            return res
        site(pg, name, f"s.submit({json.dumps(prompt)})")
        res["submit_s"] = round(time.time() - t0, 1)
        res["url_after_submit"] = pg.url
        site(pg, name, "s.waitForCompletion()")
        res["complete_s"] = round(time.time() - t0, 1)
        ans = site(pg, name, "s.extract()")
        res["text"], res["citations"] = ans["text"], ans["citations"]
    except Exception as e:  # noqa: BLE001 - 하네스는 어떤 실패든 리포트해야 한다
        res["error"] = str(e).splitlines()[0][:300]
    return res


def is_transient(res: dict) -> bool:
    """서비스 쪽 일시 정체(ChatGPT가 답변을 안 주는 경우 등)로 보이는 실패: 한 번 재시도할 가치가 있다."""
    err = res.get("error", "")
    return "timeout" in err or "시간 내에 끝나지" in err or "SiteError" in err and "끝나지" in err


# ---- 서브커맨드 ------------------------------------------------------------------------------------------------

def names_of(arg: str) -> list[str]:
    names = list(PROVIDERS) if arg in ("all", "") else arg.split(",")
    for n in names:
        if n not in PROVIDERS:
            sys.exit(f"알 수 없는 provider: {n} (가능: {', '.join(PROVIDERS)})")
    return names


def cmd_run(a: argparse.Namespace) -> None:
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = connect(p)
        for n in names_of(a.providers):
            res = run_once(prep(browser, n), n, a.prompt)
            print(f"[{n}] {json.dumps({k: v for k, v in res.items() if k not in ('text', 'citations')}, ensure_ascii=False)}")
            if "text" in res:
                print(f"[{n}] TEXT: {res['text'][:1500]}")
                print(f"[{n}] CITATIONS({len(res['citations'])}): {res['citations']}")


def cmd_smoke(a: argparse.Namespace) -> None:
    from playwright.sync_api import sync_playwright

    scenarios = [a.only] if a.only else list(SCENARIOS)
    rows, failed = [], 0
    with sync_playwright() as p:
        browser = connect(p)
        for n in names_of(a.providers):
            for sc in scenarios:
                spec = SCENARIOS[sc]
                res = None
                for attempt in range(a.retries + 1):
                    res = run_once(prep(browser, n), n, spec["prompt"])
                    if "error" not in res or not is_transient(res):
                        break
                    print(f"[{n}/{sc}] 일시 실패로 보여 재시도 ({attempt + 1}/{a.retries}): {res['error']}")
                ok = "error" not in res and bool(spec["check"](res))
                failed += 0 if ok else 1
                detail = res.get("error") or f"{res['complete_s']}s, {len(res['text'])}자, 출처 {len(res['citations'])}건"
                print(f"{'PASS' if ok else 'FAIL'} {n:11} {sc:6} {detail}")
                rows.append((n, sc, ok, spec["expect"], detail, res))
    OUT.mkdir(parents=True, exist_ok=True)
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M")
    lines = [f"# Provider smoke 리포트 {stamp}", "", "| provider | 시나리오 | 결과 | 기대 | 상세 |", "|---|---|---|---|---|"]
    lines += [f"| {n} | {sc} | {'PASS' if ok else '**FAIL**'} | {exp} | {det} |" for n, sc, ok, exp, det, _ in rows]
    for n, sc, ok, _exp, _det, res in rows:
        if not ok:
            lines += ["", f"## FAIL: {n}/{sc}", "```json", json.dumps({k: v for k, v in res.items()}, ensure_ascii=False, indent=1)[:3000], "```"]
    report = OUT / f"report-{stamp}.md"
    report.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("리포트:", report)
    sys.exit(1 if failed else 0)


def cmd_trace(a: argparse.Namespace) -> None:
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = connect(p)
        pg = prep(browser, a.provider)
        site(pg, a.provider, "s.isLoggedIn()")
        pg.evaluate(f"window.__sites.{a.provider}().submit({json.dumps(a.prompt)})")
        t0, last = time.time(), None
        while time.time() - t0 < a.seconds:
            state = json.dumps(pg.evaluate(TRACE_JS[a.provider]), ensure_ascii=False)
            if state != last:
                print(f"{time.time() - t0:5.1f}s {state}")
                last = state
            time.sleep(0.5)


def cmd_probe(a: argparse.Namespace) -> None:
    from playwright.sync_api import sync_playwright

    src = (TOOLS / "probe.js").read_text(encoding="utf-8")
    # 줄 시작에 고정: 헤더 주석에 같은 문구가 있어도 실제 선언만 치환한다
    src, n1 = re.subn(r'^(\s*)const STATE = ".*?";', lambda m: f"{m.group(1)}const STATE = {json.dumps(a.state)};", src, count=1, flags=re.M)
    src, n2 = re.subn(r'^(\s*)const Q = ".*?";', lambda m: f"{m.group(1)}const Q = {json.dumps(a.q)};", src, count=1, flags=re.M)
    if not (n1 and n2):
        sys.exit("probe.js 의 STATE/Q 선언을 찾지 못했습니다(형식이 바뀌었나요?)")
    with sync_playwright() as p:
        browser = connect(p)
        pg = prep(browser, a.provider, goto=not a.no_goto) if BUNDLE.exists() else find_page(browser, a.provider)
        result = pg.evaluate(src)
    text = re.sub(r"[\w.+-]+@[\w-]+(\.[\w-]+)+", "<email>", json.dumps(result, ensure_ascii=False, indent=1))
    dest = OUT / "captures" / a.provider
    dest.mkdir(parents=True, exist_ok=True)
    path = dest / f"{dt.datetime.now().strftime('%Y%m%d-%H%M%S')}-{a.state}.json"
    path.write_text(text, encoding="utf-8")
    print("저장:", path, f"({len(text)}자)")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("launch").set_defaults(fn=cmd_launch)
    sub.add_parser("bundle").set_defaults(fn=cmd_bundle)

    r = sub.add_parser("run")
    r.add_argument("providers", help="쉼표 구분 또는 all")
    r.add_argument("-p", "--prompt", default=SCENARIOS["simple"]["prompt"])
    r.set_defaults(fn=cmd_run)

    s = sub.add_parser("smoke")
    s.add_argument("providers", nargs="?", default="all")
    s.add_argument("--only", choices=list(SCENARIOS))
    s.add_argument("--retries", type=int, default=1, help="일시 정체로 보이는 실패의 재시도 횟수")
    s.set_defaults(fn=cmd_smoke)

    t = sub.add_parser("trace")
    t.add_argument("provider", choices=list(PROVIDERS))
    t.add_argument("-p", "--prompt", default=SCENARIOS["web"]["prompt"])
    t.add_argument("--seconds", type=int, default=75)
    t.set_defaults(fn=cmd_trace)

    pr = sub.add_parser("probe")
    pr.add_argument("provider", choices=list(PROVIDERS))
    pr.add_argument("--state", required=True, help="라벨: home|typed|generating|done|done-sources-open|home-loggedout …")
    pr.add_argument("--q", default="", help="보낸 질문 일부(사용자 메시지 컨테이너를 찾는 데 사용)")
    pr.add_argument("--no-goto", action="store_true", help="현재 화면 그대로 캡처(generating/done 등)")
    pr.set_defaults(fn=cmd_probe)

    a = ap.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
