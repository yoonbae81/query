"""사용자 구현 영역. BROWSER_PROVIDER=custom 일 때 이 파일의 두 클래스가 사용된다.

스텔스 구현(patchright):
- patchright는 CDP Runtime.enable 유출 등 Playwright 탐지 포인트를 제거한
  Playwright 드롭인 대체재다. channel="chrome" 등 권장 설정에서 Cloudflare
  Turnstile/관리형 챌린지를 통과한다.
- CustomBrowserProvider: patchright + 시스템 Google Chrome으로 브라우저를 띄우고
  provider별 세션(<sessions_dir>/<provider_id>.json)을 적용/저장한다.
- CustomChallengeHandler: "Just a moment..." interstitial / Turnstile 체크박스를
  자동 클릭해 통과를 시도하고, 실패 시 BrowserChallengeError를 발생시켜 워커의
  재시도/실패 정책(PLAN §6.5)을 따르게 한다.

주의(patchright 권장 사항):
- 커스텀 user_agent/헤더/viewport 지문 주입을 하지 않는다(no_viewport 사용).
- add_init_script, page.route, expose_function 같은 API는 스텔스를 깨므로 쓰지 않는다.
- headless보다 headed가 통과율이 높다(PLAYWRIGHT_HEADLESS=false 권장).
"""
import asyncio
import random
from pathlib import Path
from typing import TYPE_CHECKING

from playwright.async_api import BrowserContext, Error as PlaywrightError, Frame, Locator, Page

from src.adapters.outbound.llm.browser import (
    BrowserChallengeError,
    BrowserProvider,
    ChallengeHandler,
)

if TYPE_CHECKING:
    from patchright.async_api import Browser as PatchrightBrowser
    from patchright.async_api import Playwright as PatchrightPlaywright

try:  # playwright와 patchright는 공존 가능하며 서로 다른 Error 클래스를 쓴다.
    from patchright.async_api import Error as PatchrightError

    _BROWSER_ERRORS: tuple[type[Exception], ...] = (PlaywrightError, PatchrightError)
except ImportError:  # patchright 미설치: _ensure_browser에서 안내 예외로 변환된다.
    _BROWSER_ERRORS = (PlaywrightError,)


class CustomBrowserProvider(BrowserProvider):
    """patchright(패치된 Playwright) + 시스템 Google Chrome 채널 구현.

    patchright README의 Best Practice(channel="chrome", no_viewport,
    custom UA/헤더 미지정)를 따른다. 시스템 Chrome이 없으면 patchright가
    설치한 chromium으로 폴백한다(사전에 `patchright install chromium` 필요).
    """

    def __init__(self, sessions_dir: str | Path, headless: bool = True):
        self._sessions_dir = Path(sessions_dir)
        self._headless = headless
        self._pw: PatchrightPlaywright | None = None
        self._browser: PatchrightBrowser | None = None

    def _state_path(self, provider_id: str) -> Path:
        return self._sessions_dir / f"{provider_id}.json"

    async def _ensure_browser(self) -> None:
        if self._browser is not None:
            return
        try:
            from patchright.async_api import async_playwright
        except ImportError as exc:
            raise RuntimeError(
                "BROWSER_PROVIDER=custom 은 patchright가 필요합니다: "
                "pip install patchright && patchright install chromium"
            ) from exc
        self._pw = await async_playwright().start()
        try:
            self._browser = await self._pw.chromium.launch(
                channel="chrome", headless=self._headless
            )
        except _BROWSER_ERRORS:
            # 시스템 Chrome 미설치: patchright 전용 chromium 빌드로 폴백
            self._browser = await self._pw.chromium.launch(headless=self._headless)

    async def open_context(self, provider_id: str) -> BrowserContext:
        await self._ensure_browser()
        state = self._state_path(provider_id)
        return await self._browser.new_context(
            locale="en-US",
            no_viewport=True,  # 실제 창 크기를 그대로 써서 지문 불일치를 피한다
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


class CustomChallengeHandler(ChallengeHandler):
    """Cloudflare 검증 화면(Turnstile/관리형 챌린지) 통과를 시도한다.

    - 좋은 지문이면 "Just a moment..." interstitial이 클릭 없이 자동 통과된다.
    - 자동 통과가 없으면 challenges.cloudflare.com iframe의 체크박스를 클릭한다.
      (interstitial과 로그인 폼의 인라인 위젯 모두 이 iframe 안에 있다)
    - 최대 시도 후에도 통과하지 못하면 BrowserChallengeError를 발생시킨다.
    """

    _CHALLENGE_TITLES = ("just a moment", "attention required", "verifying you are human")
    _CHALLENGE_FRAME_URL = "challenges.cloudflare.com"
    # Turnstile은 input을 시각적으로 숨기고 label.ctp-checkbox-label을 체크박스로 렌더링하므로
    # 클릭/감지 모두 label을 먼저 본다.
    _CLICK_TARGET_SELECTORS = (".ctp-checkbox-label", 'input[type="checkbox"]')
    _POLL_INTERVAL_SECONDS = 0.5
    _AUTO_PASS_WAIT_SECONDS = 6.0
    _SOLVE_WAIT_SECONDS = 20.0
    _MAX_CLICKS = 3

    async def ensure_clear(self, page: Page) -> None:
        if not await self._is_challenged(page):
            return
        if await self._wait_until_clear(page, self._AUTO_PASS_WAIT_SECONDS):
            return
        for _ in range(self._MAX_CLICKS):
            await asyncio.sleep(random.uniform(0.6, 1.6))  # 클릭 전 사람 같은 딜레이
            await self._click_challenge_checkboxes(page)
            if await self._wait_until_clear(page, self._SOLVE_WAIT_SECONDS):
                return
        raise BrowserChallengeError(
            "봇 검증 화면(Cloudflare)을 통과하지 못했습니다. "
            "PLAYWRIGHT_HEADLESS=false 로 headed 실행을 시도해 보세요."
        )

    async def _is_challenged(self, page: Page) -> bool:
        title = (await page.title()).strip().lower()
        if any(marker in title for marker in self._CHALLENGE_TITLES):
            return True
        for frame in page.frames:
            if self._CHALLENGE_FRAME_URL not in frame.url:
                continue
            if await self._unsolved_target(frame) is not None:
                return True
        return False

    async def _unsolved_target(self, frame: Frame) -> Locator | None:
        """풀리지 않은 체크박스의 클릭 대상(보이는 것)을 반환하거나 None."""
        for selector in self._CLICK_TARGET_SELECTORS:
            try:
                target = frame.locator(selector)
                if await target.count() > 0 and await target.first.is_visible():
                    return target.first
            except _BROWSER_ERRORS:
                continue  # 탐색 중 프레임 분리 경쟁 상태: 다음 셀렉터 확인
        return None

    async def _click_challenge_checkboxes(self, page: Page) -> None:
        for frame in list(page.frames):
            if self._CHALLENGE_FRAME_URL not in frame.url:
                continue
            try:
                target = await self._unsolved_target(frame)
                if target is None:
                    continue
                box = await target.bounding_box()
                if box is None:
                    continue
                await self._human_click(page, box)
            except _BROWSER_ERRORS:
                continue  # 클릭 시점에 이미 통과/프레임 해제된 경우

    async def _human_click(self, page: Page, box: dict[str, float]) -> None:
        """iframe 안 요소 좌표도 메인 프레임 기준이므로 page.mouse로 누른다.
        이동 궤적/오프셋/타이밍을 사람처럼 흉내낸다."""
        x = box["x"] + box["width"] * random.uniform(0.35, 0.65)
        y = box["y"] + box["height"] * random.uniform(0.35, 0.65)
        await page.mouse.move(x - random.uniform(60, 120), y + random.uniform(-30, 30))
        await asyncio.sleep(random.uniform(0.15, 0.4))
        await page.mouse.move(x, y, steps=random.randint(8, 20))
        await asyncio.sleep(random.uniform(0.1, 0.3))
        await page.mouse.down()
        await asyncio.sleep(random.uniform(0.02, 0.08))
        await page.mouse.up()

    async def _wait_until_clear(self, page: Page, timeout_seconds: float) -> bool:
        """검증 화면이 사라질 때까지 폴링한다. 탐색 직후의 빈 타이틀 오판을 막기 위해
        연속 2회 clear 관측 시에만 통과로 본다."""
        loop = asyncio.get_running_loop()
        deadline = loop.time() + timeout_seconds
        clear_streak = 0
        while loop.time() < deadline:
            if await self._is_challenged(page):
                clear_streak = 0
            else:
                clear_streak += 1
                if clear_streak >= 2:
                    return True
            await asyncio.sleep(self._POLL_INTERVAL_SECONDS)
        return clear_streak >= 2
