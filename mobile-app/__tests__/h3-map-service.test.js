import {
  isCoordinateInsideRegion,
  resolveH3LabelAnchor,
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
});
