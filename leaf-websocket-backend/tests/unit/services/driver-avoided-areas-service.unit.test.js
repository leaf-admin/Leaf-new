const h3 = require('h3-js');
const {
  AVOIDED_AREAS_H3_RESOLUTION,
  MAX_AVOIDED_CELLS,
  buildAreaOutline,
  buildAvoidedAreasPatch,
  cellsAroundPoint,
  isDestinationAvoided,
  isRideInAvoidedArea,
  parseStoredAvoided,
  normalizeAvoidedCells,
  parseAvoidedCells,
  parseStoredAvoidedCells
} = require('../../../services/driver-avoided-areas-service');

const COPACABANA = { lat: -22.9711, lng: -43.1822 };
const COPACABANA_CELL = h3.latLngToCell(COPACABANA.lat, COPACABANA.lng, 8);
const BARRA = { lat: -23.0045, lng: -43.3659 };
const BARRA_CELL = h3.latLngToCell(BARRA.lat, BARRA.lng, 8);

describe('driver-avoided-areas-service', () => {
  it('exposes the agreed resolution and cell limit', () => {
    expect(AVOIDED_AREAS_H3_RESOLUTION).toBe(8);
    expect(MAX_AVOIDED_CELLS).toBe(80);
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
        avoidedBairros: '[]',
        avoidedAreasUpdatedAt: '2026-10-13T12:00:00.000Z'
      });
    });

    it('produces an empty JSON array when cleared', () => {
      expect(buildAvoidedAreasPatch([]).avoidedH3Cells).toBe('[]');
      expect(typeof buildAvoidedAreasPatch([]).avoidedAreasUpdatedAt).toBe('string');
    });
  });
  describe('isRideInAvoidedArea', () => {
    const driver = { avoidedH3Cells: [COPACABANA_CELL] };

    it('blocks when the pickup is inside an avoided area', () => {
      expect(isRideInAvoidedArea(driver, { pickupLocation: COPACABANA, destinationLocation: BARRA })).toBe(true);
    });

    it('blocks when the destination is inside an avoided area', () => {
      expect(isRideInAvoidedArea(driver, { pickupLocation: BARRA, destinationLocation: COPACABANA })).toBe(true);
    });

    it('does not block when both ends are outside, or when nothing is known', () => {
      expect(isRideInAvoidedArea(driver, { pickupLocation: BARRA, destinationLocation: BARRA })).toBe(false);
      expect(isRideInAvoidedArea(driver)).toBe(false);
      expect(isRideInAvoidedArea({}, { pickupLocation: COPACABANA })).toBe(false);
    });
  });

  describe('parseStoredAvoidedCells', () => {
    it('reads the cells of the stored display record', () => {
      expect(parseStoredAvoidedCells(JSON.stringify({ cells: [COPACABANA_CELL, BARRA_CELL] }))).toEqual([
        COPACABANA_CELL,
        BARRA_CELL
      ]);
      expect(parseStoredAvoidedCells({ cells: [COPACABANA_CELL] })).toEqual([COPACABANA_CELL]);
    });

    it('returns nothing for a missing or broken record', () => {
      expect(parseStoredAvoidedCells(null)).toEqual([]);
      expect(parseStoredAvoidedCells('{broken')).toEqual([]);
      expect(parseStoredAvoidedCells(JSON.stringify({ cells: 'x' }))).toEqual([]);
    });
  });
  describe('buildAreaOutline', () => {
    it('returns one closed outline for a single cell and for a ring of cells', () => {
      const single = buildAreaOutline([COPACABANA_CELL]);
      expect(single).toHaveLength(1);
      expect(single[0]).toHaveLength(6);
      expect(single[0][0]).toEqual({ latitude: expect.any(Number), longitude: expect.any(Number) });

      const ring = buildAreaOutline(cellsAroundPoint(COPACABANA.lat, COPACABANA.lng, 1));
      expect(ring).toHaveLength(1);
      expect(ring[0].length).toBeGreaterThan(6);
    });

    it('returns nothing without valid cells', () => {
      expect(buildAreaOutline([])).toEqual([]);
      expect(buildAreaOutline(['x'])).toEqual([]);
    });
  });
  describe('whole neighbourhoods', () => {
    const { findBairroAt } = require('../../../services/rio-bairros-service');
    const copacabana = findBairroAt(COPACABANA.lat, COPACABANA.lng);

    it('finds the official neighbourhood of a point', () => {
      expect(copacabana.name).toBe('Copacabana');
      expect(findBairroAt(BARRA.lat, BARRA.lng).name).not.toBe('Copacabana');
      expect(findBairroAt(-23.55, -46.63)).toBeNull();
      expect(findBairroAt('x', null)).toBeNull();
    });

    it('blocks pickup or destination anywhere inside an avoided neighbourhood', () => {
      const driver = { avoidedBairros: JSON.stringify([copacabana.id]) };
      expect(isRideInAvoidedArea(driver, { pickupLocation: BARRA, destinationLocation: COPACABANA })).toBe(true);
      expect(isRideInAvoidedArea(driver, { pickupLocation: { lat: '-22.9668', lng: '-43.1790' }, destinationLocation: BARRA })).toBe(true);
      expect(isRideInAvoidedArea(driver, { pickupLocation: BARRA, destinationLocation: BARRA })).toBe(false);
      expect(isRideInAvoidedArea({ avoidedBairros: ['99999'] }, { destinationLocation: COPACABANA })).toBe(false);
    });

    it('reads cells and neighbourhoods from the stored record and writes both to the hash copy', () => {
      expect(parseStoredAvoided(JSON.stringify({ cells: [COPACABANA_CELL], bairros: [copacabana.id, 'nope'] }))).toEqual({
        cells: [COPACABANA_CELL],
        bairros: [copacabana.id]
      });
      expect(parseStoredAvoided('{broken')).toEqual({ cells: [], bairros: [] });
      expect(buildAvoidedAreasPatch([], '2026-10-13T12:00:00.000Z', [copacabana.id]).avoidedBairros).toBe(
        JSON.stringify([copacabana.id])
      );
    });
  });
});
