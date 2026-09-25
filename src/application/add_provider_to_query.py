from src.application.submit_query import normalize_providers
from src.domain.entities import PRIORITY_NORMAL, QueryResult, new_id
from src.domain.errors import InvalidRequest, NotFound
from src.domain.ports import QueryRepositoryPort


class AddProviderToQuery:
    def __init__(self, repo: QueryRepositoryPort, available_providers: set[str]):
        self._repo = repo
        self._available = available_providers

    async def execute(
        self, query_id: str, providers: list[str], priority: int = PRIORITY_NORMAL
    ) -> list[QueryResult]:
        """새로 추가된 결과만 반환. 전부 이미 존재하면 빈 리스트(PLAN §4.5, 멱등)."""
        if not providers:
            raise InvalidRequest("providers가 비어 있습니다.")
        chosen = normalize_providers(providers, self._available, [])
        if await self._repo.get_query(query_id) is None:
            raise NotFound(f"query_id를 찾을 수 없습니다: {query_id}")
        results = [QueryResult(id=new_id("r"), query_id=query_id, provider=p, priority=priority) for p in chosen]
        return await self._repo.add_results(query_id, results)
