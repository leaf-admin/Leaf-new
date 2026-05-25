export const SEARCH_TOTAL_DURATION_SECONDS = 180;
export const SEARCH_MESSAGE_ROTATION_SECONDS = 5;
export const SEARCH_MAX_RADIUS_KM = 5;

export const SEARCH_STATUS_MESSAGES = Object.freeze([
  "Estamos localizando sua viagem",
  "Informando aos motoristas na sua região",
  "Expandindo o raio de busca",
  "Sua viagem começará em breve",
]);

const SEARCH_RADIUS_STAGES = Object.freeze([
  { startElapsedSeconds: 0, maxElapsedSeconds: 4, radiusKm: 1 },
  { startElapsedSeconds: 5, maxElapsedSeconds: 9, radiusKm: 2 },
  { startElapsedSeconds: 10, maxElapsedSeconds: 14, radiusKm: 3 },
  { startElapsedSeconds: 15, maxElapsedSeconds: 19, radiusKm: 4 },
  {
    startElapsedSeconds: 20,
    maxElapsedSeconds: Number.POSITIVE_INFINITY,
    radiusKm: SEARCH_MAX_RADIUS_KM,
  },
]);

function clampToPositiveInteger(value) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return 0;
  }

  return Math.max(0, Math.floor(normalized));
}

export function formatSearchElapsed(seconds) {
  const normalized = clampToPositiveInteger(seconds);
  const mins = String(Math.floor(normalized / 60)).padStart(2, "0");
  const secs = String(normalized % 60).padStart(2, "0");
  return `${mins}:${secs}`;
}

export function getSearchRadiusKm(seconds) {
  const normalized = clampToPositiveInteger(seconds);
  const stage = getSearchRadiusStage(normalized);

  return stage.radiusKm;
}

export function getSearchRadiusStage(seconds) {
  const normalized = clampToPositiveInteger(seconds);

  return (
    SEARCH_RADIUS_STAGES.find((candidate) => normalized <= candidate.maxElapsedSeconds) ||
    SEARCH_RADIUS_STAGES[SEARCH_RADIUS_STAGES.length - 1]
  );
}

export function getSearchStageProgress(seconds) {
  const normalized = clampToPositiveInteger(seconds);
  const stage = getSearchRadiusStage(normalized);
  const nextStageIndex = SEARCH_RADIUS_STAGES.indexOf(stage) + 1;
  const nextStage = SEARCH_RADIUS_STAGES[nextStageIndex] || null;

  if (!nextStage) {
    return 1;
  }

  const stageSpan = Math.max(
    1,
    stage.maxElapsedSeconds - stage.startElapsedSeconds,
  );
  const elapsedWithinStage = Math.max(
    0,
    Math.min(stageSpan, normalized - stage.startElapsedSeconds),
  );

  return Math.min(elapsedWithinStage / stageSpan, 1);
}

export function getSearchPreviewRadiusKm(seconds) {
  const normalized = clampToPositiveInteger(seconds);
  const stage = getSearchRadiusStage(normalized);
  const nextStageIndex = SEARCH_RADIUS_STAGES.indexOf(stage) + 1;
  const nextStage = SEARCH_RADIUS_STAGES[nextStageIndex] || null;

  if (!nextStage) {
    return stage.radiusKm;
  }

  const stageProgress = getSearchStageProgress(normalized);
  const easedProgress = 1 - Math.pow(1 - stageProgress, 2);
  const previewRadiusKm =
    stage.radiusKm + (nextStage.radiusKm - stage.radiusKm) * easedProgress;

  return Number(previewRadiusKm.toFixed(2));
}

export function getSearchDiameterKm(seconds) {
  return getSearchRadiusKm(seconds) * 2;
}

export function getSearchProgress(seconds) {
  const normalized = clampToPositiveInteger(seconds);
  return Math.min(normalized / SEARCH_TOTAL_DURATION_SECONDS, 1);
}

export function getSearchStatusMessage(seconds) {
  const normalized = clampToPositiveInteger(seconds);
  const index = getSearchStatusMessageIndex(normalized);

  return SEARCH_STATUS_MESSAGES[index];
}

export function getSearchStatusMessageIndex(seconds) {
  const normalized = clampToPositiveInteger(seconds);
  return (
    Math.floor(normalized / SEARCH_MESSAGE_ROTATION_SECONDS) %
    SEARCH_STATUS_MESSAGES.length
  );
}

export function getSearchVehicleHint(radiusKm) {
  const normalized = Number(radiusKm);
  if (!Number.isFinite(normalized) || normalized <= 1) {
    return 6;
  }

  return Math.min(18, 6 + Math.round((normalized - 1) * 3));
}

export function getSearchPresentation(seconds) {
  const elapsedSeconds = clampToPositiveInteger(seconds);
  const stage = getSearchRadiusStage(elapsedSeconds);
  const radiusKm = getSearchRadiusKm(elapsedSeconds);
  const previewRadiusKm = getSearchPreviewRadiusKm(elapsedSeconds);
  const diameterKm = radiusKm * 2;
  const previewDiameterKm = previewRadiusKm * 2;
  const progress = getSearchProgress(elapsedSeconds);
  const remainingSeconds = Math.max(
    0,
    SEARCH_TOTAL_DURATION_SECONDS - elapsedSeconds,
  );
  const statusMessageIndex = getSearchStatusMessageIndex(elapsedSeconds);
  const nextStageIndex = SEARCH_RADIUS_STAGES.indexOf(stage) + 1;
  const nextStage = SEARCH_RADIUS_STAGES[nextStageIndex] || null;
  const stageRemainingSeconds = nextStage
    ? Math.max(0, stage.maxElapsedSeconds - elapsedSeconds)
    : 0;

  return {
    elapsedSeconds,
    elapsedLabel: formatSearchElapsed(elapsedSeconds),
    totalElapsedLabel: formatSearchElapsed(SEARCH_TOTAL_DURATION_SECONDS),
    remainingSeconds,
    remainingLabel: formatSearchElapsed(remainingSeconds),
    progress,
    progressPercent: Math.round(progress * 100),
    radiusKm,
    diameterKm,
    previewRadiusKm,
    previewDiameterKm,
    radiusLabel: `${radiusKm.toFixed(0)} km de raio`,
    diameterLabel: `${diameterKm.toFixed(0)} km de diâmetro`,
    previewRadiusLabel: `${previewRadiusKm.toFixed(1)} km de raio`,
    previewDiameterLabel: `${previewDiameterKm.toFixed(1)} km de diâmetro`,
    statusMessageIndex,
    statusMessage: SEARCH_STATUS_MESSAGES[statusMessageIndex],
    nearbyVehiclesCount: getSearchVehicleHint(radiusKm),
    stageProgress: getSearchStageProgress(elapsedSeconds),
    stageRemainingSeconds,
    stageRemainingLabel: formatSearchElapsed(stageRemainingSeconds),
    nextRadiusKm: nextStage?.radiusKm || radiusKm,
    nextDiameterKm: (nextStage?.radiusKm || radiusKm) * 2,
    isMaxRadius: radiusKm >= SEARCH_MAX_RADIUS_KM,
  };
}
