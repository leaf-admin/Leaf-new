from __future__ import annotations

import os
from dataclasses import dataclass


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None:
        return default
    return int(value)


def _env_float(name: str, default: float) -> float:
    value = os.getenv(name)
    if value is None:
        return default
    return float(value)


def _env_list(name: str, default: list[str]) -> list[str]:
    value = os.getenv(name)
    if value is None:
        return default
    values = [item.strip() for item in value.split(",") if item.strip()]
    return values or default


def _env_secret_list(name: str) -> list[str]:
    value = os.getenv(name)
    if value is None:
        return []
    return [item.strip() for item in value.split(",") if item.strip()]


def _env_size(name: str, default: tuple[int, int]) -> tuple[int, int]:
    value = os.getenv(name)
    if value is None:
        return default

    separator = "x" if "x" in value.lower() else ","
    parts = [part.strip() for part in value.lower().split(separator) if part.strip()]
    if len(parts) != 2:
        raise ValueError(f"{name} must look like 640,640 or 640x640")
    return int(parts[0]), int(parts[1])


@dataclass(frozen=True)
class Settings:
    service_name: str
    version: str
    model_pack: str
    allowed_modules: list[str]
    providers: list[str]
    ctx_id: int
    det_size: tuple[int, int]
    approve_threshold: float
    review_threshold: float
    max_image_bytes: int
    load_model_on_startup: bool
    expose_docs: bool
    api_keys: list[str]
    api_key_header: str

    @classmethod
    def from_env(cls) -> "Settings":
        review_threshold = _env_float("FACE_REVIEW_THRESHOLD", 0.40)
        approve_threshold = _env_float("FACE_APPROVE_THRESHOLD", 0.61)
        if review_threshold > approve_threshold:
            raise ValueError("FACE_REVIEW_THRESHOLD must be <= FACE_APPROVE_THRESHOLD")

        return cls(
            service_name=os.getenv("FACE_SERVICE_NAME", "Leaf Face Compare Service"),
            version=os.getenv("FACE_SERVICE_VERSION", "0.1.0"),
            model_pack=os.getenv("INSIGHTFACE_MODEL_PACK", "buffalo_l"),
            allowed_modules=_env_list("INSIGHTFACE_ALLOWED_MODULES", ["detection", "recognition"]),
            providers=_env_list("INSIGHTFACE_PROVIDERS", ["CPUExecutionProvider"]),
            ctx_id=_env_int("INSIGHTFACE_CTX_ID", -1),
            det_size=_env_size("INSIGHTFACE_DET_SIZE", (640, 640)),
            approve_threshold=approve_threshold,
            review_threshold=review_threshold,
            max_image_bytes=_env_int("FACE_MAX_IMAGE_BYTES", 8 * 1024 * 1024),
            load_model_on_startup=_env_bool("FACE_LOAD_MODEL_ON_STARTUP", False),
            expose_docs=_env_bool("FACE_EXPOSE_DOCS", False),
            api_keys=_env_secret_list("FACE_API_KEYS"),
            api_key_header=os.getenv("FACE_API_KEY_HEADER", "X-Leaf-Biometric-Key"),
        )
