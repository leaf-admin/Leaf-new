import {
  SEARCH_TOTAL_DURATION_SECONDS,
  formatSearchElapsed,
  getSearchPreviewRadiusKm,
  getSearchPresentation,
  getSearchProgress,
  getSearchRadiusKm,
  getSearchStageProgress,
  getSearchStatusMessageIndex,
  getSearchStatusMessage,
} from "../src/screens/prototype/searchPresentation";

describe("searchPresentation", () => {
  it("formats elapsed time as mm:ss", () => {
    expect(formatSearchElapsed(0)).toBe("00:00");
    expect(formatSearchElapsed(12)).toBe("00:12");
    expect(formatSearchElapsed(180)).toBe("03:00");
  });

  it("rotates messages every five seconds and expands the radius by stage", () => {
    expect(getSearchRadiusKm(0)).toBe(1);
    expect(getSearchRadiusKm(12)).toBe(3);
    expect(getSearchStageProgress(0)).toBe(0);
    expect(getSearchStageProgress(4)).toBe(1);
    expect(getSearchPreviewRadiusKm(2)).toBeGreaterThan(1);
    expect(getSearchPreviewRadiusKm(2)).toBeLessThan(2);
    expect(getSearchStatusMessage(0)).toBe("Estamos localizando sua viagem");
    expect(getSearchStatusMessage(5)).toBe(
      "Informando aos motoristas na sua região",
    );
    expect(getSearchStatusMessage(12)).toBe("Expandindo o raio de busca");
    expect(getSearchStatusMessageIndex(12)).toBe(2);
  });

  it("builds the passenger search presentation with clamped progress", () => {
    const initial = getSearchPresentation(0);
    const expanding = getSearchPresentation(12);
    const capped = getSearchPresentation(SEARCH_TOTAL_DURATION_SECONDS + 45);

    expect(initial).toEqual(
      expect.objectContaining({
        elapsedLabel: "00:00",
        totalElapsedLabel: "03:00",
        progress: 0,
        radiusKm: 1,
        diameterLabel: "2 km de diâmetro",
        previewRadiusKm: 1,
      }),
    );

    expect(expanding).toEqual(
      expect.objectContaining({
        elapsedLabel: "00:12",
        remainingLabel: "02:48",
        radiusKm: 3,
        diameterKm: 6,
        diameterLabel: "6 km de diâmetro",
        radiusLabel: "3 km de raio",
        statusMessageIndex: 2,
        statusMessage: "Expandindo o raio de busca",
        stageRemainingLabel: "00:02",
      }),
    );

    expect(getSearchProgress(SEARCH_TOTAL_DURATION_SECONDS + 1)).toBe(1);
    expect(capped.progress).toBe(1);
    expect(capped.totalElapsedLabel).toBe("03:00");
    expect(capped.previewRadiusKm).toBe(5);
  });
});
