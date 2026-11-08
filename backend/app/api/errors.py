"""Exception handlers — uniform error envelope for the frontend."""
from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError

from app.services.permissions import NotFoundError, PermissionError_


def _envelope(status: int, error: str, detail: str | None = None) -> JSONResponse:
    body = {"error": error}
    if detail:
        body["detail"] = detail
    return JSONResponse(status_code=status, content=body)


def register_handlers(app: FastAPI) -> None:
    @app.exception_handler(PermissionError_)
    async def _perm(_request: Request, exc: PermissionError_):
        # Unauthenticated vs forbidden: message decides (deps raise "Not authenticated.")
        status = 401 if "authenticated" in exc.detail.lower() or "session" in exc.detail.lower() else 403
        return _envelope(status, "permission_denied", exc.detail)

    @app.exception_handler(NotFoundError)
    async def _not_found(_request: Request, exc: NotFoundError):
        return _envelope(404, "not_found", exc.detail)

    @app.exception_handler(RequestValidationError)
    async def _validation(_request: Request, exc: RequestValidationError):
        first = exc.errors()[0] if exc.errors() else {}
        loc = ".".join(str(p) for p in first.get("loc", [])) 
        detail = f"{loc}: {first.get('msg', 'invalid')}" if loc else str(first.get("msg", "invalid"))
        return _envelope(422, "validation_error", detail)

    @app.exception_handler(IntegrityError)
    async def _integrity(_request: Request, _exc: IntegrityError):
        return _envelope(409, "conflict", "That conflicts with existing data (duplicate or in use).")

    @app.exception_handler(ValueError)
    async def _value(_request: Request, exc: ValueError):
        return _envelope(400, "bad_request", str(exc))

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception):
        # log but never leak internals
        import logging

        logging.getLogger("projectpulse").exception(
            "Unhandled error on %s %s", request.method, request.url.path, exc_info=exc
        )
        return _envelope(500, "internal_error", "Something went wrong on our side.")
