from dataclasses import dataclass

from src.domain.entities import PRIORITY_NORMAL, Query, QueryResult, new_id
from src.domain.errors import InvalidRequest
from src.domain.ports import QueryRepositoryPort

MAX_BULK_SIZE = 100


def normalize_providers(providers: list[str] | None, available: set[str], default: list[str]) -> list[str]:
    """중복 제거(순서 유지), 미지정 시 기본값, 미등록 provider는 InvalidRequest."""
    chosen = list(dict.fromkeys(providers)) if providers else list(default)
    if not chosen:
        raise InvalidRequest("providers가 비어 있습니다.")
    unknown = [p for p in chosen if p not in available]
    if unknown:
        raise InvalidRequest(f"사용할 수 없는 provider: {', '.join(unknown)}")
    return chosen


@dataclass
class Submitted:
    query: Query
    results: list[QueryResult]


class SubmitQuery:
    def __init__(
        self,
        repo: QueryRepositoryPort,
        available_providers: set[str],
        default_providers: list[str],
        max_query_length: int = 4000,
    ):
        self._repo = repo
        self._available = available_providers
        self._default = default_providers
        self._max_len = max_query_length

    def _build(self, text: str, providers: list[str], batch_id: str | None, priority: int) -> Submitted:
        q = Query(id=new_id("q"), query_text=text, providers=providers, batch_id=batch_id)
        results = [
            QueryResult(id=new_id("r"), query_id=q.id, provider=p, priority=priority) for p in providers
        ]
        return Submitted(q, results)

    def _check_text(self, text: str) -> str:
        text = (text or "").strip()
        if not text:
            raise InvalidRequest("질문 내용은 비어 있을 수 없습니다.")
        if len(text) > self._max_len:
            raise InvalidRequest(f"질문은 {self._max_len}자를 초과할 수 없습니다.")
        return text

    async def submit(
        self, text: str, providers: list[str] | None = None, priority: int = PRIORITY_NORMAL
    ) -> Submitted:
        text = self._check_text(text)
        chosen = normalize_providers(providers, self._available, self._default)
        s = self._build(text, chosen, None, priority)
        await self._repo.create_queries([(s.query, s.results)])
        return s

    async def submit_bulk(
        self, texts: list[str], providers: list[str] | None = None
    ) -> tuple[str, list[Submitted]]:
        cleaned = [t.strip() for t in texts if t and t.strip()]
        if not cleaned:
            raise InvalidRequest("등록할 질문이 없습니다.")
        if len(cleaned) > MAX_BULK_SIZE:
            raise InvalidRequest(f"한 번에 최대 {MAX_BULK_SIZE}건까지 등록할 수 있습니다.")
        cleaned = [self._check_text(t) for t in cleaned]
        chosen = normalize_providers(providers, self._available, self._default)
        batch_id = new_id("b")
        items = [self._build(t, chosen, batch_id, PRIORITY_NORMAL) for t in cleaned]
        await self._repo.create_queries([(s.query, s.results) for s in items])
        return batch_id, items
