#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import statistics
import time
from pathlib import Path
from typing import Callable

import httpx


def percentile(values: list[float], pct: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = int(round((pct / 100) * (len(ordered) - 1)))
    return ordered[index]


def measure(name: str, count: int, fn: Callable[[], None]) -> dict:
    durations = []
    for _ in range(count):
        started = time.perf_counter()
        fn()
        durations.append((time.perf_counter() - started) * 1000)

    return {
        "name": name,
        "count": count,
        "min_ms": round(min(durations), 2),
        "p50_ms": round(statistics.median(durations), 2),
        "p95_ms": round(percentile(durations, 95), 2),
        "max_ms": round(max(durations), 2),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Benchmark Leaf face compare service endpoints.")
    parser.add_argument("--base-url", default="http://localhost:8008")
    parser.add_argument("--api-key", required=True)
    parser.add_argument("--iterations", type=int, default=20)
    parser.add_argument("--image", type=Path, help="Optional image for /generate-embedding benchmark.")
    args = parser.parse_args()

    headers = {"X-Leaf-Biometric-Key": args.api_key}
    client = httpx.Client(base_url=args.base_url.rstrip("/"), timeout=60)

    health = client.get("/health")
    health.raise_for_status()

    results = [
        measure(
            "compare",
            args.iterations,
            lambda: client.post(
                "/compare",
                headers=headers,
                json={"embeddingA": [1, 0, 0], "embeddingB": [1, 0, 0]},
            ).raise_for_status(),
        )
    ]

    if args.image:
        image_bytes = args.image.read_bytes()
        results.append(
            measure(
                "generate_embedding",
                args.iterations,
                lambda: client.post(
                    "/generate-embedding",
                    headers=headers,
                    files={"image": (args.image.name, image_bytes, "image/jpeg")},
                ).raise_for_status(),
            )
        )

    print(json.dumps({"baseUrl": args.base_url, "results": results}, indent=2))


if __name__ == "__main__":
    main()
