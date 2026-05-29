from __future__ import annotations

from contextlib import asynccontextmanager
from functools import lru_cache
from typing import Any, Dict, Sequence

from fastapi import Body, Depends, FastAPI, File, HTTPException, Request, UploadFile

from app.config import Settings
from app.schemas import (
    CompareResponse,
    GenerateEmbeddingResponse,
    HealthResponse,
    ModelInfo,
)
from app.security import ApiKeyAuth
from app.services.face_engine import (
    FaceEngine,
    FaceEngineError,
    ImageDecodeError,
    ModelLoadError,
    NoFaceDetectedError,
)
from app.services.similarity import (
    SimilarityError,
    classify_similarity,
    cosine_similarity,
    euclidean_distance,
)


settings = Settings.from_env()
auth = ApiKeyAuth(settings)


@lru_cache(maxsize=1)
def get_engine() -> FaceEngine:
    return FaceEngine(settings)


@asynccontextmanager
async def lifespan(_: FastAPI):
    if settings.load_model_on_startup:
        get_engine().load()
    yield


app = FastAPI(
    title=settings.service_name,
    version=settings.version,
    description="Isolated biometric face embedding and comparison API for Leaf.",
    lifespan=lifespan,
    docs_url="/docs" if settings.expose_docs else None,
    redoc_url="/redoc" if settings.expose_docs else None,
    openapi_url="/openapi.json" if settings.expose_docs else None,
)


def _require_api_key(request: Request) -> None:
    auth.verify(request.headers.get(settings.api_key_header))


@app.get("/", response_model=HealthResponse)
async def root() -> HealthResponse:
    return _health_payload("ok")


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return _health_payload("ok")


@app.get("/ready", response_model=HealthResponse)
async def ready() -> HealthResponse:
    engine = get_engine()
    return _health_payload("ready" if engine.is_ready else "model_not_loaded")


@app.post("/generate-embedding", response_model=GenerateEmbeddingResponse)
async def generate_embedding(
    image: UploadFile = File(...),
    _: None = Depends(_require_api_key),
) -> Dict[str, Any]:
    image_bytes = await _read_image(image)
    try:
        return get_engine().generate_embedding(image_bytes)
    except FaceEngineError as exc:
        raise _to_http_error(exc) from exc


@app.post("/compare", response_model=CompareResponse)
async def compare(
    payload: Dict[str, Any] = Body(...),
    _: None = Depends(_require_api_key),
) -> Dict[str, Any]:
    embedding_a = _payload_value(payload, "embedding_a", "embeddingA")
    embedding_b = _payload_value(payload, "embedding_b", "embeddingB")

    try:
        approve_threshold = float(
            _payload_value(
                payload,
                "approve_threshold",
                "approveThreshold",
                default=settings.approve_threshold,
            )
        )
        review_threshold = float(
            _payload_value(
                payload,
                "review_threshold",
                "reviewThreshold",
                default=settings.review_threshold,
            )
        )
        left = _as_sequence(embedding_a)
        right = _as_sequence(embedding_b)
        score = cosine_similarity(left, right)
        distance = euclidean_distance(left, right)
        decision = classify_similarity(score, approve_threshold, review_threshold)
    except (SimilarityError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {
        "cosine_similarity": score,
        "euclidean_distance": distance,
        "decision": decision,
        "thresholds": {
            "approve": approve_threshold,
            "review": review_threshold,
        },
        "metadata": {
            "dimension": len(left),
            "metric": "cosine_similarity",
        },
    }


async def _read_image(image: UploadFile) -> bytes:
    content_type = image.content_type or ""
    if content_type and not (
        content_type.startswith("image/") or content_type == "application/octet-stream"
    ):
        raise HTTPException(status_code=415, detail="upload must be an image")

    data = await image.read(settings.max_image_bytes + 1)
    if not data:
        raise HTTPException(status_code=400, detail="image is empty")
    if len(data) > settings.max_image_bytes:
        raise HTTPException(status_code=413, detail="image is too large")
    return data


def _health_payload(status: str) -> HealthResponse:
    engine = get_engine()
    return HealthResponse(
        service=settings.service_name,
        version=settings.version,
        status=status,
        model_loaded=engine.is_ready,
        model=ModelInfo(**engine.model_info()),
    )


def _to_http_error(exc: FaceEngineError) -> HTTPException:
    if isinstance(exc, ModelLoadError):
        return HTTPException(status_code=503, detail=str(exc))
    if isinstance(exc, ImageDecodeError):
        return HTTPException(status_code=400, detail=str(exc))
    if isinstance(exc, NoFaceDetectedError):
        return HTTPException(status_code=422, detail=str(exc))
    return HTTPException(status_code=500, detail=str(exc))


def _payload_value(payload: Dict[str, Any], *keys: str, default: Any = None) -> Any:
    for key in keys:
        if key in payload:
            return payload[key]
    if default is not None:
        return default
    raise HTTPException(status_code=400, detail=f"missing field: {keys[0]}")


def _as_sequence(value: Any) -> Sequence[float]:
    if not isinstance(value, list):
        raise TypeError("embedding must be a JSON array of numbers")
    return value
