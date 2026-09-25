from datetime import datetime

from src.domain.ports import SystemPromptConfigPort


class ManageSystemPrompt:
    def __init__(self, prompt: SystemPromptConfigPort):
        self._prompt = prompt

    async def get(self) -> tuple[str, datetime]:
        return await self._prompt.read()

    async def update(self, content: str) -> tuple[str, datetime]:
        updated_at = await self._prompt.write(content)
        return content, updated_at
