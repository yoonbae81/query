from pathlib import Path

from fastapi import APIRouter, Depends, Request
from fastapi.templating import Jinja2Templates

from src.adapters.inbound.rest.deps import get_current_user

_DIR = Path(__file__).parent
STATIC_DIR = _DIR / "static"
templates = Jinja2Templates(directory=str(_DIR / "templates"))

router = APIRouter(dependencies=[Depends(get_current_user)], include_in_schema=False)


def _base(request: Request) -> str:
    """reverse proxy basePath (root_path). 링크/정적 파일/API 호출에 접두사로 붙인다."""
    return request.scope.get("root_path", "").rstrip("/")


@router.get("/")
async def index(request: Request):
    return templates.TemplateResponse(request, "index.html", {"base": _base(request)})


@router.get("/queries/{query_id}")
async def detail(request: Request, query_id: str):
    return templates.TemplateResponse(request, "detail.html", {"base": _base(request), "query_id": query_id})
