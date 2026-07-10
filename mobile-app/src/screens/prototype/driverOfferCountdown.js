import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";

const COUNTDOWN_REFRESH_INTERVAL_MS = 250;

function parseTimestampMs(value) {
  if (value instanceof Date) {
    const dateMs = value.getTime();
    return Number.isFinite(dateMs) ? dateMs : null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 0 && value < 1e12 ? value * 1000 : value;
  }

  const normalized = String(value || "").trim();
  if (!normalized) {
    return null;
  }

  const numeric = Number(normalized);
  if (Number.isFinite(numeric)) {
    return numeric > 0 && numeric < 1e12 ? numeric * 1000 : numeric;
  }

  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parsePositiveSeconds(...values) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

export function toDriverOfferIsoTimestamp(value) {
  const timestampMs = parseTimestampMs(value);
  return timestampMs === null ? null : new Date(timestampMs).toISOString();
}

export function resolveDriverOfferDeadlineMs(offer = {}, receivedAtMs = Date.now()) {
  const explicitDeadline = parseTimestampMs(
    offer?.expiresAt ||
      offer?.expiresAtIso ||
      offer?.offerExpiresAt ||
      offer?.responseDeadlineAt,
  );
  if (explicitDeadline !== null) {
    return explicitDeadline;
  }

  const timeoutSeconds = parsePositiveSeconds(
    offer?.expiresInSec,
    offer?.expiresInSeconds,
    offer?.timeout,
    offer?.responseTimeoutSeconds,
  );
  if (timeoutSeconds === null) {
    return null;
  }

  const authoritativeTimestamp = parseTimestampMs(
    offer?.timestamp || offer?.notifiedAt || offer?.offeredAt,
  );
  const anchorMs = authoritativeTimestamp ?? Number(receivedAtMs);
  return Number.isFinite(anchorMs)
    ? anchorMs + timeoutSeconds * 1000
    : null;
}

export function getDriverOfferRemainingSeconds(deadlineMs, nowMs = Date.now()) {
  if (
    deadlineMs === null ||
    deadlineMs === undefined ||
    !Number.isFinite(Number(deadlineMs))
  ) {
    return null;
  }

  return Math.max(0, Math.ceil((Number(deadlineMs) - Number(nowMs)) / 1000));
}

export function formatDriverOfferCountdown(remainingSeconds) {
  if (remainingSeconds === null || remainingSeconds === undefined) {
    return "--:--";
  }
  const normalizedSeconds = Number(remainingSeconds);
  if (!Number.isFinite(normalizedSeconds) || normalizedSeconds < 0) {
    return "--:--";
  }

  const wholeSeconds = Math.max(0, Math.ceil(normalizedSeconds));
  const minutes = Math.floor(wholeSeconds / 60);
  const seconds = wholeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function useDriverOfferCountdown(offer) {
  const offerKey = String(offer?.bookingId || offer?.rideId || offer?.id || "").trim();
  const receivedAnchorRef = useRef({ offerKey, receivedAtMs: Date.now() });
  if (receivedAnchorRef.current.offerKey !== offerKey) {
    receivedAnchorRef.current = { offerKey, receivedAtMs: Date.now() };
  }

  const deadlineMs = useMemo(
    () =>
      resolveDriverOfferDeadlineMs(
        offer,
        receivedAnchorRef.current.receivedAtMs,
      ),
    [
      offer?.expiresAt,
      offer?.expiresAtIso,
      offer?.expiresInSec,
      offer?.expiresInSeconds,
      offer?.notifiedAt,
      offer?.offerExpiresAt,
      offer?.offeredAt,
      offer?.responseDeadlineAt,
      offer?.responseTimeoutSeconds,
      offer?.timeout,
      offer?.timestamp,
      offerKey,
    ],
  );
  const [remainingSeconds, setRemainingSeconds] = useState(() =>
    getDriverOfferRemainingSeconds(deadlineMs),
  );

  const refresh = useCallback(() => {
    const nextRemaining = getDriverOfferRemainingSeconds(deadlineMs);
    setRemainingSeconds((previous) =>
      previous === nextRemaining ? previous : nextRemaining,
    );
  }, [deadlineMs]);

  useEffect(() => {
    refresh();
    if (!Number.isFinite(deadlineMs)) {
      return undefined;
    }

    const intervalId = setInterval(refresh, COUNTDOWN_REFRESH_INTERVAL_MS);
    const appStateSubscription = AppState?.addEventListener?.(
      "change",
      (nextState) => {
        if (nextState === "active") {
          refresh();
        }
      },
    );

    return () => {
      clearInterval(intervalId);
      appStateSubscription?.remove?.();
    };
  }, [deadlineMs, refresh]);

  return {
    deadlineMs,
    remainingSeconds,
    label: formatDriverOfferCountdown(remainingSeconds),
    expired: remainingSeconds === 0,
  };
}
