from src.adapters.outbound.llm.browser import (
    BrowserProvider,
    ChallengeHandler,
    DetectOnlyChallengeHandler,
    PlaywrightBrowserProvider,
)
from src.config import Settings
from src.domain.ports import LLMProviderPort

ALL_PROVIDERS = {"perplexity": "Perplexity", "claude": "Claude", "gemini": "Gemini", "chatgpt": "ChatGPT"}


def build_registry(settings: Settings) -> dict[str, LLMProviderPort]:
    """provider 레지스트리 (PLAN §6.2). 어댑터가 구현되는 대로 여기에 등록한다."""
    registry: dict[str, LLMProviderPort] = {}
    # TODO: registry["perplexity"] = PerplexityPlaywrightAdapter(...)
    return registry


def build_browser_components(settings: Settings) -> tuple[BrowserProvider, ChallengeHandler]:
    """Playwright 어댑터가 공유하는 브라우저 구성 (BROWSER_PROVIDER로 기본/커스텀 선택)."""
    if settings.browser_provider == "custom":
        from src.adapters.outbound.llm.custom_browser import CustomBrowserProvider, CustomChallengeHandler

        return (
            CustomBrowserProvider(settings.playwright_sessions_dir, settings.playwright_headless),
            CustomChallengeHandler(),
        )
    return (
        PlaywrightBrowserProvider(settings.playwright_sessions_dir, settings.playwright_headless),
        DetectOnlyChallengeHandler(),
    )
