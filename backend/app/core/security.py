"""Password hashing + session tokens.

- Passwords: Argon2id (argon2-cffi) with per-password salt.
- Sessions: random opaque token; only its SHA-256 hash is stored server-side,
  so a database leak cannot be replayed as live sessions.
"""
from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, VerificationError, InvalidHashError

from app.core.config import get_settings

_hasher = PasswordHasher(time_cost=2, memory_cost=64 * 1024, parallelism=2)

PASSWORD_MIN_LEN = 10
PASSWORD_MAX_LEN = 128


def hash_password(password: str) -> str:
    if not (PASSWORD_MIN_LEN <= len(password) <= PASSWORD_MAX_LEN):
        raise ValueError(
            f"Password must be {PASSWORD_MIN_LEN}-{PASSWORD_MAX_LEN} characters."
        )
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        _hasher.verify(password_hash, password)
        return True
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def needs_rehash(password_hash: str) -> bool:
    try:
        return _hasher.check_needs_rehash(password_hash)
    except InvalidHashError:
        return True


def new_session_token() -> tuple[str, str]:
    """Return (plaintext_token, stored_hash). Plaintext goes to the client once."""
    token = secrets.token_urlsafe(32)
    return token, hash_token(token)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def session_expiry() -> datetime:
    ttl = timedelta(hours=get_settings().session_ttl_hours)
    return datetime.now(timezone.utc) + ttl
