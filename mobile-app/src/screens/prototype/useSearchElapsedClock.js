import { useEffect, useRef, useState } from "react";
import { SEARCH_TOTAL_DURATION_SECONDS } from "./searchPresentation";

function normalizeElapsed(value) {
  const nextValue = Number(value);
  if (!Number.isFinite(nextValue) || nextValue <= 0) {
    return 0;
  }

  return Math.min(
    SEARCH_TOTAL_DURATION_SECONDS,
    Math.max(0, Math.floor(nextValue)),
  );
}

function normalizeAnchorElapsed(anchorTimestamp) {
  if (!anchorTimestamp) {
    return 0;
  }

  const parsedMs = new Date(anchorTimestamp).getTime();
  if (Number.isNaN(parsedMs)) {
    return 0;
  }

  return Math.min(
    SEARCH_TOTAL_DURATION_SECONDS,
    Math.max(0, Math.floor((Date.now() - parsedMs) / 1000)),
  );
}

export default function useSearchElapsedClock(
  runtimeElapsedSeconds,
  isActive,
  anchorTimestamp = null,
) {
  const normalizedRuntimeElapsed = Math.max(
    normalizeElapsed(runtimeElapsedSeconds),
    normalizeAnchorElapsed(anchorTimestamp),
  );
  const syncRef = useRef({
    elapsedSeconds: normalizedRuntimeElapsed,
    syncedAtMs: Date.now(),
  });
  const [displayElapsedSeconds, setDisplayElapsedSeconds] = useState(
    normalizedRuntimeElapsed,
  );

  useEffect(() => {
    syncRef.current = {
      elapsedSeconds: normalizedRuntimeElapsed,
      syncedAtMs: Date.now(),
    };
    setDisplayElapsedSeconds(normalizedRuntimeElapsed);
  }, [anchorTimestamp, normalizedRuntimeElapsed]);

  useEffect(() => {
    if (!isActive) {
      setDisplayElapsedSeconds(normalizedRuntimeElapsed);
      return undefined;
    }

    const updateDisplayElapsed = () => {
      const elapsedSinceSync = Math.max(
        0,
        Math.floor((Date.now() - syncRef.current.syncedAtMs) / 1000),
      );
      const nextValue = Math.min(
        SEARCH_TOTAL_DURATION_SECONDS,
        syncRef.current.elapsedSeconds + elapsedSinceSync,
      );
      setDisplayElapsedSeconds((previousValue) =>
        previousValue === nextValue ? previousValue : nextValue,
      );
    };

    updateDisplayElapsed();
    const interval = setInterval(updateDisplayElapsed, 250);

    return () => {
      clearInterval(interval);
    };
  }, [anchorTimestamp, isActive, normalizedRuntimeElapsed]);

  return displayElapsedSeconds;
}
