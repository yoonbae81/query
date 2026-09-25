import asyncio
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from src.domain.entities import ProviderAnswer
from src.domain.ports import AnswerFileStoragePort


class FileAnswerStorageAdapter(AnswerFileStoragePort):
    """`yyMMdd_{query_id}_{provider}.md` 파일 저장 (PLAN §6.7). 날짜와 시각은 KST 기준."""

    def __init__(self, answers_dir: str | Path, timezone: str = "Asia/Seoul"):
        self._dir = Path(answers_dir)
        self._tz = ZoneInfo(timezone)

    def _iso(self, dt: datetime) -> str:
        return dt.astimezone(self._tz).isoformat(timespec="seconds")

    def _render(self, query_id, provider, system_prompt, question, answer: ProviderAnswer, created_at, answered_at) -> str:
        citations = "\n".join(f"- {c}" for c in answer.citations)
        return (
            f"# {query_id} — {provider}\n\n"
            f"## System Prompt\n{system_prompt}\n\n"
            f"## Question\n{question}\n\n"
            f"## Answer\n{answer.text}\n\n"
            f"## Citations\n{citations}\n\n"
            f"---\n"
            f"provider: {provider}\n"
            f"created_at: {self._iso(created_at)}\n"
            f"answered_at: {self._iso(answered_at)}\n"
        )

    async def save(self, query_id, provider, system_prompt, question, answer, created_at: datetime, answered_at: datetime) -> str:
        name = f"{answered_at.astimezone(self._tz):%y%m%d}_{query_id}_{provider}.md"
        content = self._render(query_id, provider, system_prompt, question, answer, created_at, answered_at)

        def _write() -> None:
            self._dir.mkdir(parents=True, exist_ok=True)
            (self._dir / name).write_text(content, encoding="utf-8")

        await asyncio.to_thread(_write)
        return f"{self._dir.name}/{name}"

    async def delete(self, path: str) -> None:
        target = self._dir.parent / path
        await asyncio.to_thread(lambda: target.unlink(missing_ok=True))
