from __future__ import annotations

import math
from typing import Iterable, List, Sequence


class SimilarityError(ValueError):
    """Raised when embeddings cannot be compared."""


def normalize_vector(values: Iterable[float]) -> List[float]:
    vector = [float(value) for value in values]
    if not vector:
        raise SimilarityError("embedding must not be empty")
    if not all(math.isfinite(value) for value in vector):
        raise SimilarityError("embedding contains non-finite values")

    norm = math.sqrt(sum(value * value for value in vector))
    if norm == 0:
        raise SimilarityError("embedding norm must be greater than zero")
    return [value / norm for value in vector]


def _validate_pair(a: Sequence[float], b: Sequence[float]) -> tuple[List[float], List[float]]:
    left = [float(value) for value in a]
    right = [float(value) for value in b]

    if not left or not right:
        raise SimilarityError("both embeddings are required")
    if len(left) != len(right):
        raise SimilarityError("embeddings must have the same dimension")
    if not all(math.isfinite(value) for value in left + right):
        raise SimilarityError("embeddings contain non-finite values")
    return left, right


def cosine_similarity(a: Sequence[float], b: Sequence[float]) -> float:
    left, right = _validate_pair(a, b)
    left_norm = math.sqrt(sum(value * value for value in left))
    right_norm = math.sqrt(sum(value * value for value in right))

    if left_norm == 0 or right_norm == 0:
        raise SimilarityError("embedding norm must be greater than zero")

    score = sum(x * y for x, y in zip(left, right)) / (left_norm * right_norm)
    return max(-1.0, min(1.0, score))


def euclidean_distance(a: Sequence[float], b: Sequence[float]) -> float:
    left, right = _validate_pair(a, b)
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(left, right)))


def classify_similarity(score: float, approve_threshold: float, review_threshold: float) -> str:
    if not 0 <= review_threshold <= approve_threshold <= 1:
        raise SimilarityError("thresholds must satisfy 0 <= review <= approve <= 1")

    if score >= approve_threshold:
        return "approve"
    if score >= review_threshold:
        return "review"
    return "reject"
