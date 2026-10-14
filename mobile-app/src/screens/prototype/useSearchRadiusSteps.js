import { useEffect, useState } from "react";
import { SEARCH_TOTAL_DURATION_SECONDS, getSearchPresentation } from "./searchPresentation";

// Raio da busca para a tela inicial. Igual ao relógio da busca, mas só muda de estado quando o
// raio troca de degrau: o relógio por segundo re-renderizava a tela inicial inteira (~10 mil
// linhas) a cada segundo de busca só para recalcular um raio que muda poucas vezes.

function elapsedNow(runtimeElapsedSeconds, anchorTimestamp) {
  const runtime = Math.max(0, Math.floor(Number(runtimeElapsedSeconds) || 0));
  const anchorMs = anchorTimestamp ? new Date(anchorTimestamp).getTime() : NaN;
  const anchored = Number.isNaN(anchorMs) ? 0 : Math.floor((Date.now() - anchorMs) / 1000);
  return Math.min(SEARCH_TOTAL_DURATION_SECONDS, Math.max(runtime, anchored, 0));
}

function stepsFor(elapsedSeconds) {
  const { radiusKm, previewRadiusKm } = getSearchPresentation(elapsedSeconds);
  return { radiusKm, previewRadiusKm };
}

const sameSteps = (a, b) => a.radiusKm === b.radiusKm && a.previewRadiusKm === b.previewRadiusKm;

export default function useSearchRadiusSteps(runtimeElapsedSeconds, isActive, anchorTimestamp = null) {
  const [steps, setSteps] = useState(() => stepsFor(elapsedNow(runtimeElapsedSeconds, anchorTimestamp)));

  useEffect(() => {
    const update = () => {
      const next = stepsFor(elapsedNow(runtimeElapsedSeconds, anchorTimestamp));
      setSteps((previous) => (sameSteps(previous, next) ? previous : next));
    };
    update();
    if (!isActive) return undefined;
    // Base local avança sozinha entre atualizações do runtime.
    const base = elapsedNow(runtimeElapsedSeconds, anchorTimestamp);
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const elapsed = Math.min(SEARCH_TOTAL_DURATION_SECONDS, base + Math.floor((Date.now() - startedAt) / 1000));
      const next = stepsFor(elapsed);
      setSteps((previous) => (sameSteps(previous, next) ? previous : next));
    }, 1000);
    return () => clearInterval(timer);
  }, [anchorTimestamp, isActive, runtimeElapsedSeconds]);

  return steps;
}
