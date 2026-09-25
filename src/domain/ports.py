from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime
from typing import Awaitable, Callable

from src.domain.entities import ProviderAnswer, Query, QueryResult

ProgressCallback = Callable[[str], Awaitable[None]]


class LLMProviderPort(ABC):
    @abstractmethod
    async def ask(self, system_prompt: str, question: str, on_progress: ProgressCallback) -> ProviderAnswer: ...


@dataclass
class QueryPage:
    items: list[tuple[Query, list[QueryResult]]]
    next_cursor: str | None


class QueryRepositoryPort(ABC):
    @abstractmethod
    async def init(self) -> None: ...

    @abstractmethod
    async def create_queries(self, items: list[tuple[Query, list[QueryResult]]]) -> None: ...

    @abstractmethod
    async def add_results(self, query_id: str, results: list[QueryResult]) -> list[QueryResult]:
        """이미 (query_id, provider)가 존재하는 결과는 건너뛰고, 실제 추가된 것만 반환."""

    @abstractmethod
    async def get_query(self, query_id: str) -> Query | None: ...

    @abstractmethod
    async def get_results(self, query_id: str) -> list[QueryResult]: ...

    @abstractmethod
    async def get_result(self, result_id: str) -> QueryResult | None: ...

    @abstractmethod
    async def list_queries(
        self, status: str | None, batch_id: str | None, limit: int, cursor: str | None
    ) -> QueryPage: ...

    @abstractmethod
    async def claim_pending(self, now: datetime, limit: int) -> list[QueryResult]:
        """priority DESC, created_at ASC 순으로 pending 행을 원자적으로 processing으로 전환해 반환."""

    @abstractmethod
    async def set_progress(self, result_id: str, message: str | None) -> None: ...

    @abstractmethod
    async def set_system_prompt_snapshot(self, result_id: str, snapshot: str) -> None: ...

    @abstractmethod
    async def mark_done(
        self, result_id: str, answer: str, citations: list[str], answer_file_path: str
    ) -> None: ...

    @abstractmethod
    async def schedule_retry(self, result_id: str, error_message: str, next_attempt_at: datetime) -> None:
        """retry_count += 1, status='pending'."""

    @abstractmethod
    async def mark_failed(self, result_id: str, error_message: str) -> None:
        """retry_count += 1, status='failed'."""

    @abstractmethod
    async def reset_for_retry(self, result_id: str) -> bool:
        """failed 상태일 때만 retry_count=0, pending으로 리셋. 리셋했으면 True."""

    @abstractmethod
    async def recover_processing(self) -> int:
        """워커 기동 시 processing 잔여 행을 pending으로 복구. 복구 건수 반환."""

    @abstractmethod
    async def find_expired(self, cutoff: datetime) -> list[QueryResult]:
        """done/failed이며 updated_at < cutoff 인 결과."""

    @abstractmethod
    async def delete_results(self, result_ids: list[str]) -> None:
        """결과 삭제 후 결과가 하나도 없는 queries 행도 함께 삭제."""


class AnswerFileStoragePort(ABC):
    @abstractmethod
    async def save(
        self,
        query_id: str,
        provider: str,
        system_prompt: str,
        question: str,
        answer: ProviderAnswer,
        created_at: datetime,
        answered_at: datetime,
    ) -> str:
        """저장 후 상대 경로 반환 (예: answers/250925_q_abc123_perplexity.md)."""

    @abstractmethod
    async def delete(self, path: str) -> None: ...


class SystemPromptConfigPort(ABC):
    @abstractmethod
    async def read(self) -> tuple[str, datetime]:
        """(내용, 수정시각) 반환. 파일이 없으면 ("", 현재시각)."""

    @abstractmethod
    async def write(self, content: str) -> datetime: ...


class AuthCodeProviderPort(ABC):
    @abstractmethod
    async def fetch_code(self, since: datetime, timeout_seconds: int) -> str:
        """since 이후 도착한 인증 메일에서 인증번호를 폴링해 반환. 시간 초과 시 예외."""
