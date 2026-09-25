from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """환경변수/.env 설정 (PLAN §8). 상대 경로는 실행 디렉터리(저장소 루트) 기준."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    base_path: str = ""
    perplexity_login_email: str = ""
    gmail_oauth_credentials_path: str = "user/config/gmail_credentials.json"
    gmail_oauth_token_path: str = "user/sessions/gmail_token.json"
    gmail_account_email: str = ""
    playwright_sessions_dir: str = "user/sessions"
    playwright_headless: bool = True
    browser_provider: str = "default"  # default | custom (src/adapters/outbound/llm/custom_browser.py)
    default_providers: list[str] = ["perplexity"]
    max_concurrent_workers: int = 4
    max_retry: int = 2
    retry_backoff_seconds: int = 30
    worker_poll_interval_seconds: float = 1.0
    cleanup_interval_hours: int = 24
    db_path: str = "user/query.db"
    system_prompt_path: str = "user/config/system_prompt.md"
    answers_dir: str = "user/answers"
    retention_days: int = 7
    max_query_length: int = 4000
    ask_default_timeout_seconds: int = 60
    ask_max_timeout_seconds: int = 300
    display_timezone: str = "Asia/Seoul"
