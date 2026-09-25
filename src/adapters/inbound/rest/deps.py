from fastapi import Request

from src.container import Container


def get_container(request: Request) -> Container:
    return request.app.state.container


async def get_current_user(request: Request) -> None:
    """인증 훅 (PLAN §8). MVP는 no-op — 추후 API Key/Basic Auth를 여기에만 추가한다."""
    return None
