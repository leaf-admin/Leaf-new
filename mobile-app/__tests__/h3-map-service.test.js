import {
  isCoordinateInsideRegion,
  resolveH3LabelAnchor,
  selectSeparatedH3Labels,
} from '../src/services/runtime/h3MapService';

const region = {
  latitude: -22.95,
  longitude: -43.2,
  latitudeDelta: 0.2,
  longitudeDelta: 0.2,
};

describe('h3 map presentation helpers', () => {
  test('keeps only label centers inside the safe viewport', () => {
    expect(isCoordinateInsideRegion({ lat: -22.95, lng: -43.2 }, region, 0.04)).toBe(true);
    expect(isCoordinateInsideRegion({ lat: -22.95, lng: -43.101 }, region, 0.04)).toBe(false);
  });

  test('moves edge labels inward instead of clipping the percentage', () => {
    expect(resolveH3LabelAnchor({ lat: -22.95, lng: -43.105 }, region)).toEqual({
      x: 1,
      y: 0.5,
    });
    expect(resolveH3LabelAnchor({ lat: -22.855, lng: -43.2 }, region)).toEqual({
      x: 0.5,
      y: 0,
    });
    expect(resolveH3LabelAnchor({ lat: -22.95, lng: -43.2 }, region)).toEqual({
      x: 0.5,
      y: 0.5,
    });
  });

  test('limits and spaces demand labels to avoid map pollution', () => {
    const cells = [
      { h3Index: 'a', center: { lat: -22.95, lng: -43.2 } },
      { h3Index: 'b', center: { lat: -22.951, lng: -43.201 } },
      { h3Index: 'c', center: { lat: -22.9, lng: -43.15 } },
      { h3Index: 'd', center: { lat: -23.0, lng: -43.25 } },
      { h3Index: 'e', center: { lat: -22.88, lng: -43.24 } },
      { h3Index: 'f', center: { lat: -23.02, lng: -43.12 } },
    ];

    const selected = selectSeparatedH3Labels(cells, region, {
      maxVisible: 5,
      minDistanceRatio: 0.18,
    });

    expect(selected.map((cell) => cell.h3Index)).not.toContain('b');
    expect(selected).toHaveLength(5);
  });
});
