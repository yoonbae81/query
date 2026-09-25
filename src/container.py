from dataclasses import dataclass

from src.adapters.outbound.config.file_system_prompt_adapter import FileSystemPromptAdapter
from src.adapters.outbound.repository.sqlite_query_repository_adapter import SqliteQueryRepositoryAdapter
from src.application.add_provider_to_query import AddProviderToQuery
from src.application.ask_query import AskQuery
from src.application.get_query import GetQuery, ListQueries
from src.application.manage_system_prompt import ManageSystemPrompt
from src.application.retry_result import RetryResult
from src.application.submit_query import SubmitQuery
from src.bootstrap import build_registry
from src.config import Settings
from src.domain.ports import LLMProviderPort, QueryRepositoryPort


@dataclass
class Container:
    """API 프로세스의 의존성 묶음 (드라이빙 어댑터가 유스케이스를 꺼내 쓰는 곳)."""

    settings: Settings
    repo: QueryRepositoryPort
    registry: dict[str, LLMProviderPort]
    submit: SubmitQuery
    add_provider: AddProviderToQuery
    retry: RetryResult
    ask: AskQuery
    get_query: GetQuery
    list_queries: ListQueries
    system_prompt: ManageSystemPrompt


def build_container(
    settings: Settings,
    repo: QueryRepositoryPort | None = None,
    registry: dict[str, LLMProviderPort] | None = None,
) -> Container:
    repo = repo or SqliteQueryRepositoryAdapter(settings.db_path)
    registry = build_registry(settings) if registry is None else registry
    available = set(registry)
    submit = SubmitQuery(repo, available, settings.default_providers, settings.max_query_length)
    return Container(
        settings=settings,
        repo=repo,
        registry=registry,
        submit=submit,
        add_provider=AddProviderToQuery(repo, available),
        retry=RetryResult(repo),
        ask=AskQuery(submit, repo, settings.ask_default_timeout_seconds, settings.ask_max_timeout_seconds),
        get_query=GetQuery(repo),
        list_queries=ListQueries(repo),
        system_prompt=ManageSystemPrompt(FileSystemPromptAdapter(settings.system_prompt_path)),
    )
