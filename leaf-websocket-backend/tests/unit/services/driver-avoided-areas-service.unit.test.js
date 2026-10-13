const h3 = require('h3-js');
const {
  AVOIDED_AREAS_H3_RESOLUTION,
  MAX_AVOIDED_CELLS,
  buildAvoidedAreasPatch,
  cellsAroundPoint,
  isDestinationAvoided,
  normalizeAvoidedCells,
  parseAvoidedCells
} = require('../../../services/driver-avoided-areas-service');

const COPACABANA = { lat: -22.9711, lng: -43.1822 };
const COPACABANA_CELL = h3.latLngToCell(COPACABANA.lat, COPACABANA.lng, 8);
const BARRA = { lat: -23.0045, lng: -43.3659 };
const BARRA_CELL = h3.latLngToCell(BARRA.lat, BARRA.lng, 8);

describe('driver-avoided-areas-service', () => {
  it('exposes the agreed resolution and cell limit', () => {
    expect(AVOIDED_AREAS_H3_RESOLUTION).toBe(8);
    expect(MAX_AVOIDED_CELLS).toBe(60);
  });

  describe('normalizeAvoidedCells', () => {
    it('keeps only valid resolution 8 cells and removes duplicates', () => {
      const res7 = h3.latLngToCell(COPACABANA.lat, COPACABANA.lng, 7);
      const result = normalizeAvoidedCells([
        COPACABANA_CELL,
        COPACABANA_CELL,
        'not-a-cell',
        res7,
        '',
        null,
        42,
        BARRA_CELL
      ]);

      expect(result).toEqual([COPACABANA_CELL, BARRA_CELL]);
    });

    it('returns an empty array for non-array input', () => {
      expect(normalizeAvoidedCells(undefined)).toEqual([]);
      expect(normalizeAvoidedCells(COPACABANA_CELL)).toEqual([]);
    });
  });

  describe('parseAvoidedCells', () => {
    it('reads a JSON string stored on the driver hash', () => {
      expect(
        parseAvoidedCells({ avoidedH3Cells: JSON.stringify([COPACABANA_CELL]) })
      ).toEqual([COPACABANA_CELL]);
    });

    it('reads an array directly', () => {
      expect(parseAvoidedCells({ avoidedH3Cells: [BARRA_CELL] })).toEqual([BARRA_CELL]);
    });

    it('returns empty on missing or invalid data', () => {
      expect(parseAvoidedCells({})).toEqual([]);
      expect(parseAvoidedCells({ avoidedH3Cells: '{broken' })).toEqual([]);
      expect(parseAvoidedCells({ avoidedH3Cells: '{"not":"array"}' })).toEqual([]);
      expect(parseAvoidedCells(undefined)).toEqual([]);
    });
  });

  describe('isDestinationAvoided', () => {
    it('returns true when the destination falls inside an avoided cell', () => {
      expect(
        isDestinationAvoided(
          { avoidedH3Cells: JSON.stringify([COPACABANA_CELL]) },
          COPACABANA
        )
      ).toBe(true);
    });

    it('accepts numeric string coordinates', () => {
      expect(
        isDestinationAvoided(
          { avoidedH3Cells: JSON.stringify([COPACABANA_CELL]) },
          { lat: String(COPACABANA.lat), lng: String(COPACABANA.lng) }
        )
      ).toBe(true);
    });

    it('returns false when the destination is in a different cell', () => {
      expect(
        isDestinationAvoided({ avoidedH3Cells: [COPACABANA_CELL] }, BARRA)
      ).toBe(false);
    });

    it('returns false when there is no destination, invalid coordinates or no cells', () => {
      const driver = { avoidedH3Cells: [COPACABANA_CELL] };
      expect(isDestinationAvoided(driver, null)).toBe(false);
      expect(isDestinationAvoided(driver, undefined)).toBe(false);
      expect(isDestinationAvoided(driver, {})).toBe(false);
      expect(isDestinationAvoided(driver, { lat: '', lng: '' })).toBe(false);
      expect(isDestinationAvoided(driver, { lat: 'abc', lng: -43 })).toBe(false);
      expect(isDestinationAvoided(driver, { lat: 200, lng: -43 })).toBe(false);
      expect(isDestinationAvoided({}, COPACABANA)).toBe(false);
      expect(isDestinationAvoided({ avoidedH3Cells: [] }, COPACABANA)).toBe(false);
    });
  });

  describe('cellsAroundPoint', () => {
    it('returns a single cell for ring 0', () => {
      const cells = cellsAroundPoint(COPACABANA.lat, COPACABANA.lng, 0);
      expect(cells).toEqual([COPACABANA_CELL]);
    });

    it('returns seven cells for ring 1', () => {
      expect(cellsAroundPoint(COPACABANA.lat, COPACABANA.lng, 1)).toHaveLength(7);
    });

    it('clamps the ring size to 0..2', () => {
      expect(cellsAroundPoint(COPACABANA.lat, COPACABANA.lng, 5)).toHaveLength(19);
      expect(cellsAroundPoint(COPACABANA.lat, COPACABANA.lng, -3)).toHaveLength(1);
    });
  });

  describe('buildAvoidedAreasPatch', () => {
    it('returns the hash fields with JSON cells and an ISO timestamp', () => {
      const patch = buildAvoidedAreasPatch(
        [COPACABANA_CELL, COPACABANA_CELL, 'invalid'],
        '2026-10-13T12:00:00.000Z'
      );

      expect(patch).toEqual({
        avoidedH3Cells: JSON.stringify([COPACABANA_CELL]),
        avoidedAreasUpdatedAt: '2026-10-13T12:00:00.000Z'
      });
    });

    it('produces an empty JSON array when cleared', () => {
      expect(buildAvoidedAreasPatch([]).avoidedH3Cells).toBe('[]');
      expect(typeof buildAvoidedAreasPatch([]).avoidedAreasUpdatedAt).toBe('string');
    });
  });
});
