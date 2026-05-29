from __future__ import annotations

import secrets
from typing import Iterable

from fastapi import HTTPException, status

from app.config import Settings


class ApiKeyAuth:
    def __init__(self, settings: Settings) -> None:
        self._header_name = settings.api_key_header
        self._api_keys = tuple(key for key in settings.api_keys if key)

    @property
    def configured(self) -> bool:
        return bool(self._api_keys)

    def verify(self, api_key: str | None) -> None:
        if not self._api_keys:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="biometric API key is not configured",
            )

        candidate = str(api_key or "")
        if not _contains_secret(self._api_keys, candidate):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="invalid biometric API key",
            )


def _contains_secret(values: Iterable[str], candidate: str) -> bool:
    return any(secrets.compare_digest(value, candidate) for value in values)
