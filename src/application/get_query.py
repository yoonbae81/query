from src.domain.entities import Query, QueryResult, ResultStatus
from src.domain.errors import InvalidRequest, NotFound
from src.domain.ports import QueryPage, QueryRepositoryPort

MAX_LIST_LIMIT = 100


class GetQuery:
    def __init__(self, repo: QueryRepositoryPort):
        self._repo = repo

    async def execute(self, query_id: str) -> tuple[Query, list[QueryResult]]:
        query = await self._repo.get_query(query_id)
        if query is None:
            raise NotFound(f"query_id를 찾을 수 없습니다: {query_id}")
        return query, await self._repo.get_results(query_id)


class ListQueries:
    def __init__(self, repo: QueryRepositoryPort):
        self._repo = repo

    async def execute(
        self, status: str | None = None, batch_id: str | None = None, limit: int = 20, cursor: str | None = None
    ) -> QueryPage:
        if status and status not in {s.value for s in ResultStatus}:
            raise InvalidRequest(f"알 수 없는 status: {status}")
        if not 1 <= limit <= MAX_LIST_LIMIT:
            raise InvalidRequest(f"limit는 1~{MAX_LIST_LIMIT} 사이여야 합니다.")
        try:
            return await self._repo.list_queries(status, batch_id, limit, cursor)
        except (ValueError, KeyError) as e:  # 손상된 cursor
            raise InvalidRequest("유효하지 않은 cursor입니다.") from e
