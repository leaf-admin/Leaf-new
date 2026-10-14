import { projectMapPoint } from '../src/screens/prototype/home/projectMapPoint';

const region = { latitude: -22.92, longitude: -43.4, latitudeDelta: 0.02, longitudeDelta: 0.012 };

describe('projectMapPoint', () => {
  it('puts the region centre in the middle of the screen', () => {
    const point = projectMapPoint(region, { latitude: -22.92, longitude: -43.4 }, 400, 800);
    expect(point.x).toBeCloseTo(200, 3);
    expect(point.y).toBeCloseTo(400, 0);
  });

  it('maps the corners of the region to the screen edges', () => {
    const topLeft = projectMapPoint(region, { latitude: -22.91, longitude: -43.406 }, 400, 800);
    expect(topLeft.x).toBeCloseTo(0, 3);
    expect(topLeft.y).toBeCloseTo(0, 3);
    const bottomRight = projectMapPoint(region, { latitude: -22.93, longitude: -43.394 }, 400, 800);
    expect(bottomRight.x).toBeCloseTo(400, 3);
    expect(bottomRight.y).toBeCloseTo(800, 3);
  });

  it('gives nothing for incomplete input', () => {
    expect(projectMapPoint(null, { latitude: 0, longitude: 0 }, 400, 800)).toBeNull();
    expect(projectMapPoint(region, null, 400, 800)).toBeNull();
    expect(projectMapPoint({ ...region, latitudeDelta: 0 }, { latitude: 0, longitude: 0 }, 400, 800)).toBeNull();
  });
});
