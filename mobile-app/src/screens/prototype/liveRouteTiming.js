import { useEffect, useRef, useState } from "react";

export const ROUTE_PROGRESS_TICK_MS = 1000;

const MIN_ROUTE_PROGRESS = 0.08;
const MAX_ROUTE_PROGRESS = 0.94;
const ETA_WORSENING_THRESHOLD_MS = 75 * 1000;
const ETA_WORSENING_PERSISTENCE_MS = 10 * 1000;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function resolveStartedAtMs(startedAt) {
  const parsed = startedAt ? new Date(startedAt).getTime() : NaN;
  return Number.isFinite(parsed) ? parsed : NaN;
}

export function clampRouteProgress(value, fallback = 0.42) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return clamp(numeric, MIN_ROUTE_PROGRESS, MAX_ROUTE_PROGRESS);
}

export function resolveRouteProgress({
  remainingMinutes,
  totalMinutes,
  startedAt,
  nowMs = Date.now(),
}) {
  const directTotal = Number(totalMinutes);
  const remaining = Number(remainingMinutes);
  const startedAtMs = resolveStartedAtMs(startedAt);

  if (
    Number.isFinite(startedAtMs) &&
    Number.isFinite(remaining) &&
    remaining > 0
  ) {
    const elapsedMinutes = Math.max(0, (Number(nowMs) - startedAtMs) / 60000);
    const estimatedTotalCandidates = [elapsedMinutes + remaining];

    if (Number.isFinite(directTotal) && directTotal > 0) {
      estimatedTotalCandidates.push(directTotal);
    }

    const estimatedTotal = Math.max(...estimatedTotalCandidates);
    if (estimatedTotal > 0) {
      return clampRouteProgress(elapsedMinutes / estimatedTotal);
    }
  }

  if (Number.isFinite(directTotal) && directTotal > 0 && Number.isFinite(remaining)) {
    return clampRouteProgress(1 - remaining / directTotal);
  }

  return 0.42;
}

export function resolveArrivalTimestamp(minutes, nowMs = Date.now()) {
  const numericMinutes = Number(minutes);
  if (!Number.isFinite(numericMinutes) || numericMinutes <= 0) {
    return null;
  }

  return Number(nowMs) + numericMinutes * 60000;
}

export function resolveDisplayEtaMinutes(arrivalTimestampMs, nowMs = Date.now()) {
  const numericArrival = Number(arrivalTimestampMs);
  if (!Number.isFinite(numericArrival)) {
    return null;
  }

  return Math.max(1, Math.ceil((numericArrival - Number(nowMs)) / 60000));
}

export function formatArrivalClockLabelFromTimestamp(arrivalTimestampMs) {
  const numericArrival = Number(arrivalTimestampMs);
  if (!Number.isFinite(numericArrival)) {
    return "Chegada prevista em instantes";
  }

  const arrivalTime = new Date(numericArrival).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return `Chegada prevista às ${arrivalTime}`;
}

export function resolveMonotonicArrivalState(
  previousState,
  { routeKey, remainingMinutes, nowMs = Date.now() },
) {
  const normalizedRouteKey = String(routeKey || "live-route");
  const numericMinutes = Number(remainingMinutes);
  const targetArrivalMs = resolveArrivalTimestamp(numericMinutes, nowMs);

  if (!Number.isFinite(targetArrivalMs)) {
    return {
      routeKey: normalizedRouteKey,
      acceptedMinutes: null,
      arrivalTimestampMs: null,
      pendingWorseEta: null,
    };
  }

  if (
    !previousState ||
    previousState.routeKey !== normalizedRouteKey ||
    !Number.isFinite(Number(previousState.arrivalTimestampMs))
  ) {
    return {
      routeKey: normalizedRouteKey,
      acceptedMinutes: numericMinutes,
      arrivalTimestampMs: targetArrivalMs,
      pendingWorseEta: null,
    };
  }

  const previousArrivalMs = Number(previousState.arrivalTimestampMs);
  const previousAcceptedMinutes = Number(previousState.acceptedMinutes);
  let nextArrivalMs = previousArrivalMs;
  let nextAcceptedMinutes = Number.isFinite(previousAcceptedMinutes)
    ? previousAcceptedMinutes
    : numericMinutes;
  let pendingWorseEta = previousState.pendingWorseEta || null;

  if (numericMinutes > nextAcceptedMinutes) {
    const pendingMatches = pendingWorseEta?.minutes === numericMinutes;
    const firstSeenAt = pendingMatches ? pendingWorseEta.firstSeenAt : Number(nowMs);
    const persistedLongEnough =
      Number(nowMs) - Number(firstSeenAt) >= ETA_WORSENING_PERSISTENCE_MS;
    const materiallyLater =
      targetArrivalMs - previousArrivalMs >= ETA_WORSENING_THRESHOLD_MS;

    pendingWorseEta = {
      minutes: numericMinutes,
      firstSeenAt,
    };

    if (materiallyLater || persistedLongEnough) {
      nextArrivalMs = Math.max(previousArrivalMs, targetArrivalMs);
      nextAcceptedMinutes = numericMinutes;
      pendingWorseEta = null;
    }
  } else {
    pendingWorseEta = null;
  }

  return {
    routeKey: normalizedRouteKey,
    acceptedMinutes: nextAcceptedMinutes,
    arrivalTimestampMs: nextArrivalMs,
    pendingWorseEta,
  };
}

export function useLiveRouteTiming({
  routeKey,
  remainingMinutes,
  totalMinutes,
  startedAt,
  active = true,
}) {
  const [clockTick, setClockTick] = useState(0);
  const arrivalStateRef = useRef(null);

  useEffect(() => {
    if (!active) {
      return undefined;
    }

    const interval = setInterval(() => {
      setClockTick((value) => (value + 1) % 1000000);
    }, ROUTE_PROGRESS_TICK_MS);

    return () => clearInterval(interval);
  }, [active, routeKey]);

  const nowMs = Date.now();
  const routeProgress = resolveRouteProgress({
    remainingMinutes,
    totalMinutes,
    startedAt,
    nowMs,
  });
  const arrivalState = resolveMonotonicArrivalState(arrivalStateRef.current, {
    routeKey,
    remainingMinutes,
    nowMs,
  });

  arrivalStateRef.current = arrivalState;

  return {
    clockTick,
    routeProgress,
    arrivalTimestampMs: arrivalState.arrivalTimestampMs,
    displayEtaMinutes: resolveDisplayEtaMinutes(arrivalState.arrivalTimestampMs, nowMs),
    arrivalClockLabel: formatArrivalClockLabelFromTimestamp(
      arrivalState.arrivalTimestampMs,
    ),
  };
}
