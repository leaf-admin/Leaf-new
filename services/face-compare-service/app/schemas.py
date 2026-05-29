from __future__ import annotations

from typing import Any, Dict, List

from pydantic import BaseModel, Field


class ModelInfo(BaseModel):
    model_pack: str
    detector: str
    recognizer: str
    providers: List[str]
    det_size: List[int]


class Thresholds(BaseModel):
    approve: float = Field(..., ge=0.0, le=1.0)
    review: float = Field(..., ge=0.0, le=1.0)


class FaceMetadata(BaseModel):
    bbox: List[float]
    landmarks: List[List[float]]
    detection_score: float


class GenerateEmbeddingResponse(BaseModel):
    embedding: List[float]
    dimension: int
    embedding_norm: float
    face_count: int
    selected_face: FaceMetadata
    model: ModelInfo


class CompareResponse(BaseModel):
    cosine_similarity: float
    euclidean_distance: float
    decision: str
    thresholds: Thresholds
    metadata: Dict[str, Any] = Field(default_factory=dict)


class HealthResponse(BaseModel):
    service: str
    version: str
    status: str
    model_loaded: bool
    model: ModelInfo
