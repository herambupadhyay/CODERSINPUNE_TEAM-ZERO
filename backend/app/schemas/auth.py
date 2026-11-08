"""Auth request/response schemas."""
from __future__ import annotations

from uuid import UUID

from pydantic import EmailStr, Field, field_validator

from app.core.security import PASSWORD_MAX_LEN, PASSWORD_MIN_LEN
from app.schemas.common import ApiModel


class SignupIn(ApiModel):
    email: EmailStr
    name: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=PASSWORD_MIN_LEN, max_length=PASSWORD_MAX_LEN)
    title: str | None = Field(default=None, max_length=120)
    workspace_name: str | None = Field(default=None, max_length=120)

    @field_validator("name")
    @classmethod
    def _strip_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Name cannot be empty.")
        return v


class LoginIn(ApiModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=PASSWORD_MAX_LEN)


class UserOut(ApiModel):
    id: UUID
    email: EmailStr
    name: str
    title: str | None = None


class SessionOut(ApiModel):
    user: UserOut
    # first workspace the user belongs to (UI bootstrap)
    primary_workspace_id: UUID | None = None
    workspaces: list[dict] = []


__all__ = ["SignupIn", "LoginIn", "UserOut", "SessionOut"]
