"""사용자 구현 영역. BROWSER_PROVIDER=custom 일 때 이 파일의 두 클래스가 사용된다."""
from pathlib import Path

from playwright.async_api import BrowserContext, Page

from src.adapters.outbound.llm.browser import BrowserProvider, ChallengeHandler


class CustomBrowserProvider(BrowserProvider):
    def __init__(self, sessions_dir: str | Path, headless: bool = True):
        self._sessions_dir = Path(sessions_dir)
        self._headless = headless

    async def open_context(self, provider_id: str) -> BrowserContext:
        # TODO: 브라우저 실행/컨텍스트 구성을 구현 (provider별 세션: <sessions_dir>/<provider_id>.json)
        raise NotImplementedError

    async def save_session(self, provider_id: str, context: BrowserContext) -> None:
        # TODO: 세션 저장을 구현
        raise NotImplementedError

    async def close(self) -> None:
        # TODO: 열린 브라우저/리소스 정리
        raise NotImplementedError


class CustomChallengeHandler(ChallengeHandler):
    async def ensure_clear(self, page: Page) -> None:
        # TODO: 검증 화면 처리를 구현. 진행 불가면 BrowserChallengeError를 발생시킬 것
        raise NotImplementedError
