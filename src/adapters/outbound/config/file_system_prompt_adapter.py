import asyncio
from datetime import datetime, timezone
from pathlib import Path

from src.domain.ports import SystemPromptConfigPort


class FileSystemPromptAdapter(SystemPromptConfigPort):
    def __init__(self, path: str | Path):
        self._path = Path(path)

    async def read(self) -> tuple[str, datetime]:
        def _read():
            if not self._path.exists():
                return "", datetime.now(timezone.utc)
            mtime = datetime.fromtimestamp(self._path.stat().st_mtime, timezone.utc)
            return self._path.read_text(encoding="utf-8"), mtime

        return await asyncio.to_thread(_read)

    async def write(self, content: str) -> datetime:
        def _write():
            self._path.parent.mkdir(parents=True, exist_ok=True)
            self._path.write_text(content, encoding="utf-8")

        await asyncio.to_thread(_write)
        return (await self.read())[1]
