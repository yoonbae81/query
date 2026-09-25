from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from src.adapters.inbound.rest.routes import router
from src.adapters.inbound.web.routes import STATIC_DIR
from src.adapters.inbound.web.routes import router as web_router
from src.config import Settings
from src.container import Container, build_container
from src.domain.errors import Conflict, DomainError, InvalidRequest, NotFound

_STATUS = {InvalidRequest: 400, NotFound: 404, Conflict: 409}


def _error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message}})


def create_app(container: Container | None = None) -> FastAPI:
    settings = container.settings if container else Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        c = container or build_container(settings)
        app.state.container = c
        await c.repo.init()
        yield

    app = FastAPI(title="Query", root_path=settings.base_path, lifespan=lifespan)
    if container:  # 테스트 등 lifespan 없이 쓰는 경우
        app.state.container = container

    @app.exception_handler(DomainError)
    async def domain_error(_: Request, exc: DomainError):
        return _error(_STATUS.get(type(exc), 400), exc.code, str(exc))

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError):
        detail = "; ".join(f"{'.'.join(map(str, e['loc'][1:]))}: {e['msg']}" for e in exc.errors())
        return _error(400, "INVALID_REQUEST", detail)

    app.include_router(router, prefix="/api/v1")
    app.include_router(web_router)
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
    return app


app = create_app()
