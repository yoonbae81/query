import asyncio
import base64
import re
import time
from datetime import datetime
from pathlib import Path

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

from src.domain.ports import AuthCodeProviderPort

# Perplexity 로그인 메일 (2026-09 관찰): 발신 team@mail.perplexity.ai, 제목 "Sign in to Perplexity".
# 본문 링크의 `token=XXXXXX` 와 본문 단독 라인의 6자리 숫자가 같은 인증번호이며 5분간 유효.
PERPLEXITY_SENDER = "team@mail.perplexity.ai"
PERPLEXITY_SUBJECT = "Sign in to Perplexity"
_LINK_TOKEN = re.compile(r"[?&]token=(\d{6})\b")
_STANDALONE = re.compile(r"^\s*(\d{6})\s*$", re.MULTILINE)
_CLOCK_SKEW_MS = 10_000


def extract_code(text: str) -> str | None:
    """메일 본문(text/plain)에서 6자리 인증번호 추출. 링크의 token 파라미터를 우선한다."""
    m = _LINK_TOKEN.search(text) or _STANDALONE.search(text)
    return m.group(1) if m else None


class GmailApiAuthCodeAdapter(AuthCodeProviderPort):
    def __init__(
        self,
        token_path: str | Path,
        sender: str = PERPLEXITY_SENDER,
        subject: str = PERPLEXITY_SUBJECT,
        poll_interval: float = 2.0,
    ):
        self._token_path = Path(token_path)
        self._sender = sender
        self._subject = subject
        self._poll = poll_interval

    async def fetch_code(self, since: datetime, timeout_seconds: int) -> str:
        since_ms = int(since.timestamp() * 1000) - _CLOCK_SKEW_MS
        deadline = time.monotonic() + timeout_seconds
        while True:
            messages = await asyncio.to_thread(self._list_messages, since_ms)
            for _, text in sorted(messages, reverse=True):  # 최신 메일 우선
                code = extract_code(text)
                if code:
                    return code
            if time.monotonic() >= deadline:
                raise TimeoutError(f"{timeout_seconds}초 내에 인증번호 메일이 도착하지 않았습니다.")
            await asyncio.sleep(self._poll)

    # --- 아래는 블로킹 Gmail API 호출 (to_thread로 실행) ---

    def _credentials(self) -> Credentials:
        creds = Credentials.from_authorized_user_file(str(self._token_path))
        if not creds.valid and creds.refresh_token:
            creds.refresh(Request())
            self._token_path.write_text(creds.to_json(), encoding="utf-8")
        return creds

    def _list_messages(self, since_ms: int) -> list[tuple[int, str]]:
        """since 이후 도착한 조건 일치 메일의 (internalDate, text/plain 본문) 목록."""
        gmail = build("gmail", "v1", credentials=self._credentials(), cache_discovery=False)
        query = f'from:{self._sender} subject:"{self._subject}" after:{since_ms // 1000}'
        refs = gmail.users().messages().list(userId="me", q=query, maxResults=5).execute().get("messages", [])
        found = []
        for ref in refs:
            msg = gmail.users().messages().get(userId="me", id=ref["id"], format="full").execute()
            received = int(msg["internalDate"])
            if received >= since_ms:
                found.append((received, _plain_text(msg["payload"])))
        return found


def _plain_text(payload: dict) -> str:
    chunks = []
    stack = [payload]
    while stack:
        part = stack.pop(0)
        data = part.get("body", {}).get("data")
        if data and part.get("mimeType") == "text/plain":
            chunks.append(base64.urlsafe_b64decode(data).decode("utf-8", "replace"))
        stack.extend(part.get("parts", []) or [])
    return "\n".join(chunks)
