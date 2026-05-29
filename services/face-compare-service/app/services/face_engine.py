from __future__ import annotations

from typing import Any, Dict, List, Optional

from app.config import Settings


class FaceEngineError(RuntimeError):
    """Base error for the InsightFace engine."""


class ModelLoadError(FaceEngineError):
    """Raised when InsightFace or its runtime dependencies cannot load."""


class ImageDecodeError(FaceEngineError):
    """Raised when an uploaded image cannot be decoded."""


class NoFaceDetectedError(FaceEngineError):
    """Raised when no face is detected in an image."""


class FaceEngine:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._app: Optional[Any] = None
        self._cv2: Optional[Any] = None
        self._np: Optional[Any] = None

    @property
    def is_ready(self) -> bool:
        return self._app is not None

    def model_info(self) -> Dict[str, Any]:
        return {
            "model_pack": self.settings.model_pack,
            "detector": "SCRFD",
            "recognizer": "ArcFace",
            "allowed_modules": self.settings.allowed_modules,
            "providers": self.settings.providers,
            "det_size": list(self.settings.det_size),
        }

    def load(self) -> None:
        if self._app is not None:
            return

        try:
            import cv2  # type: ignore
            import numpy as np  # type: ignore
            from insightface.app import FaceAnalysis  # type: ignore
        except ModuleNotFoundError as exc:
            raise ModelLoadError(
                "Missing face runtime dependency. Install requirements.txt before using face endpoints."
            ) from exc

        try:
            app = FaceAnalysis(
                name=self.settings.model_pack,
                providers=self.settings.providers,
                allowed_modules=self.settings.allowed_modules,
            )
            app.prepare(ctx_id=self.settings.ctx_id, det_size=self.settings.det_size)
        except Exception as exc:  # pragma: no cover - depends on model/runtime state.
            raise ModelLoadError(f"Could not load InsightFace model pack: {exc}") from exc

        self._cv2 = cv2
        self._np = np
        self._app = app

    def generate_embedding(self, image_bytes: bytes) -> Dict[str, Any]:
        image = self._decode_image(image_bytes)
        faces = self._detect_faces(image, max_faces=1)
        face = faces[0]
        embedding = self._embedding_for(face)
        embedding_norm = self._embedding_norm(embedding)

        return {
            "embedding": [float(value) for value in embedding.tolist()],
            "dimension": int(embedding.shape[0]),
            "embedding_norm": embedding_norm,
            "face_count": len(faces),
            "selected_face": self._face_metadata(face),
            "model": self.model_info(),
        }

    def _decode_image(self, image_bytes: bytes) -> Any:
        self.load()
        assert self._cv2 is not None
        assert self._np is not None

        if not image_bytes:
            raise ImageDecodeError("image is empty")

        image_array = self._np.frombuffer(image_bytes, dtype=self._np.uint8)
        image = self._cv2.imdecode(image_array, self._cv2.IMREAD_COLOR)
        if image is None:
            raise ImageDecodeError("image could not be decoded")
        return image

    def _detect_faces(self, image: Any, max_faces: int = 0) -> List[Any]:
        self.load()
        assert self._app is not None

        faces = self._app.get(image, max_num=max(0, int(max_faces or 0)))
        if not faces:
            raise NoFaceDetectedError("no face detected")
        return sorted(faces, key=self._face_rank, reverse=True)

    def _face_rank(self, face: Any) -> tuple[float, float]:
        bbox = getattr(face, "bbox", [0, 0, 0, 0])
        x1, y1, x2, y2 = [float(value) for value in bbox]
        area = max(0.0, x2 - x1) * max(0.0, y2 - y1)
        score = float(getattr(face, "det_score", 0.0))
        return area, score

    def _face_metadata(self, face: Any) -> Dict[str, Any]:
        landmarks = getattr(face, "kps", None)
        if landmarks is None:
            landmarks_list: List[List[float]] = []
        else:
            landmarks_list = [
                [float(value) for value in point]
                for point in self._to_python_list(landmarks)
            ]

        return {
            "bbox": [float(value) for value in self._to_python_list(getattr(face, "bbox", []))],
            "landmarks": landmarks_list,
            "detection_score": float(getattr(face, "det_score", 0.0)),
        }

    def _embedding_for(self, face: Any) -> Any:
        self.load()
        assert self._np is not None

        embedding = getattr(face, "normed_embedding", None)
        if embedding is None:
            embedding = getattr(face, "embedding", None)
        if embedding is None:
            raise FaceEngineError("recognition model did not return an embedding")

        embedding_array = self._np.asarray(embedding, dtype=self._np.float32)
        norm = float(self._np.linalg.norm(embedding_array))
        if norm == 0:
            raise FaceEngineError("recognition model returned a zero embedding")
        return embedding_array / norm

    def _embedding_norm(self, embedding: Any) -> float:
        assert self._np is not None
        return float(self._np.linalg.norm(embedding))

    def _to_python_list(self, value: Any) -> Any:
        if hasattr(value, "tolist"):
            return value.tolist()
        return value
