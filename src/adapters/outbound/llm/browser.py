"""Playwright 어댑터(Perplexity 등)가 공통으로 쓰는 브라우저 확장 지점.

- BrowserProvider: 브라우저/컨텍스트를 어떻게 띄우고 구성할지
- ChallengeHandler: 페이지 이동 후 사이트의 봇 검증 화면(예: Cloudflare)을 어떻게 처리할지

기본 구현은 표준 Playwright 실행 + 검증 화면 "감지 시 에러"까지만 한다.
그 이상의 동작은 custom_browser.py에서 구현하고 BROWSER_PROVIDER=custom 으로 선택한다.
"""
from abc import ABC, abstractmethod
from pathlib import Path

from playwright.async_api import Browser, BrowserContext, Page, Playwright, async_playwright


class BrowserChallengeError(RuntimeError):
    """봇 검증 화면을 통과하지 못해 진행할 수 없음 (워커의 재시도/실패 정책이 적용된다)."""


class BrowserProvider(ABC):
    @abstractmethod
    async def open_context(self, provider_id: str) -> BrowserContext:
        """provider별 세션(storageState)이 적용된 새 컨텍스트를 반환한다."""

    @abstractmethod
    async def save_session(self, provider_id: str, context: BrowserContext) -> None:
        """재로그인 후 등 세션을 저장해야 할 때 호출된다."""

    @abstractmethod
    async def close(self) -> None: ...


class ChallengeHandler(ABC):
    @abstractmethod
    async def ensure_clear(self, page: Page) -> None:
        """page.goto 직후, 그리고 주요 상호작용 전에 호출된다. 진행 불가면 BrowserChallengeError."""


class PlaywrightBrowserProvider(BrowserProvider):
    """기본 구현: 번들 Chromium을 표준 옵션으로 실행."""

    def __init__(self, sessions_dir: str | Path, headless: bool = True):
        self._sessions_dir = Path(sessions_dir)
        self._headless = headless
        self._pw: Playwright | None = None
        self._browser: Browser | None = None

    def _state_path(self, provider_id: str) -> Path:
        return self._sessions_dir / f"{provider_id}.json"

    async def open_context(self, provider_id: str) -> BrowserContext:
        if self._browser is None:
            self._pw = await async_playwright().start()
            self._browser = await self._pw.chromium.launch(headless=self._headless)
        state = self._state_path(provider_id)
        return await self._browser.new_context(
            locale="en-US",
            viewport={"width": 1280, "height": 900},
            storage_state=str(state) if state.exists() else None,
        )

    async def save_session(self, provider_id: str, context: BrowserContext) -> None:
        self._sessions_dir.mkdir(parents=True, exist_ok=True)
        await context.storage_state(path=str(self._state_path(provider_id)))

    async def close(self) -> None:
        if self._browser:
            await self._browser.close()
        if self._pw:
            await self._pw.stop()
        self._browser = self._pw = None


class DetectOnlyChallengeHandler(ChallengeHandler):
    """기본 구현: 검증 화면이면 BrowserChallengeError만 발생시킨다(통과 시도 없음)."""

    async def ensure_clear(self, page: Page) -> None:
        if "just a moment" in (await page.title()).lower():
            raise BrowserChallengeError("봇 검증 화면(Cloudflare)에서 진행할 수 없습니다.")
