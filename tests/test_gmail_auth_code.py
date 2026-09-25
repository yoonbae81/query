from datetime import datetime, timezone

import pytest

from src.adapters.outbound.auth.gmail_api_auth_code_adapter import GmailApiAuthCodeAdapter, extract_code

# 실제 메일(2026-09-25 관찰) 형식. 번호는 임의값.
SAMPLE = """


https://www.perplexity.ai/api/auth/callback/email?callbackUrl=https%3A%2F%2Fwww.perplexity.ai%2F%3Flogin-source%3DsignupButton%23locale%3Den-US&email=yoonbae%40xcv.kr&token=123456


Sign in to your account

Sign in
[https://www.perplexity.ai/api/auth/callback/email?callbackUrl=x&email=yoonbae%40xcv.kr&token=123456]

This link and code will only be valid for the next 5 minutes. If the link does not work, you can use the login verification code
directly:


123456


If you did not request this, you can safely ignore it.
"""


def test_extract_from_link_and_standalone_line():
    assert extract_code(SAMPLE) == "123456"
    assert extract_code("Your code:\n\n  654321  \n") == "654321"
    assert extract_code("no code here 12345 or 1234567") is None


class FakeGmailAdapter(GmailApiAuthCodeAdapter):
    def __init__(self, batches):
        super().__init__("unused.json", poll_interval=0.01)
        self._batches = list(batches)

    def _list_messages(self, since_ms):
        return self._batches.pop(0) if self._batches else []


async def test_fetch_code_polls_until_mail_arrives_and_prefers_newest():
    since = datetime.now(timezone.utc)
    adapter = FakeGmailAdapter([[], [(1, "x?token=111111"), (2, "x?token=222222")]])
    assert await adapter.fetch_code(since, timeout_seconds=2) == "222222"


async def test_fetch_code_times_out():
    with pytest.raises(TimeoutError):
        await FakeGmailAdapter([]).fetch_code(datetime.now(timezone.utc), timeout_seconds=0)
