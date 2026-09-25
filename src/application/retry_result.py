from src.domain.entities import QueryResult
from src.domain.errors import Conflict, NotFound
from src.domain.ports import QueryRepositoryPort


class RetryResult:
    def __init__(self, repo: QueryRepositoryPort):
        self._repo = repo

    async def execute(self, query_id: str, result_id: str) -> QueryResult:
        result = await self._repo.get_result(result_id)
        if result is None or result.query_id != query_id:
            raise NotFound(f"result_id를 찾을 수 없습니다: {result_id}")
        if not await self._repo.reset_for_retry(result_id):
            raise Conflict("failed 상태의 결과만 재시도할 수 있습니다.")
        return await self._repo.get_result(result_id)
