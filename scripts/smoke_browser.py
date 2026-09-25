"""브라우저 스텔스 스모크: BROWSER_PROVIDER=custom 으로 Perplexity 진입을 확인한다.

사용: uv run python scripts/smoke_browser.py [--headless]
- 기본 headed(권장). 세션 파일(user/sessions/perplexity.json)이 있으면 함께 적용된다.
- Cloudflare 스코어링상 반복 실행은 IP 평판을 깎으므로 2~3회, 1~2분 간격으로만 실행할 것.
"""
import asyncio
import sys

from src.adapters.outbound.llm.browser import BrowserChallengeError
from src.bootstrap import build_browser_components
from src.config import Settings


async def main() -> int:
    headless = "--headless" in sys.argv
    settings = Settings(browser_provider="custom", playwright_headless=headless)
    provider, handler = build_browser_components(settings)
    context = await provider.open_context("perplexity")
    page = await context.new_page()
    try:
        await page.goto("https://www.perplexity.ai/", timeout=60_000)
        await handler.ensure_clear(page)
        print(f"CLEAR: headless={headless} title={await page.title()!r} url={page.url}")
        return 0
    except BrowserChallengeError as exc:
        print(f"CHALLENGE_FAILED: headless={headless} {exc}")
        return 1
    finally:
        await provider.close()


raise SystemExit(asyncio.run(main()))
