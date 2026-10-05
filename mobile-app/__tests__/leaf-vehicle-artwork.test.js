import { createLeafVehicleSvg, createLeafMapMarkerSvg, resolveVehicleMarkerShapeKey, resolveVehicleArtworkPose } from '../src/components/prototype/leafVehicleArtwork';
import { parse } from 'react-native-svg';

describe('Leaf vehicle vector artwork', () => {
  it('parses all paint and direction variants with the installed native SVG parser', () => {
    for (const colorToken of ['black', 'white', 'silver', 'gray', 'red', 'blue', 'green', 'yellow', 'brown', 'beige', 'orange', 'purple', 'pink']) {
      for (const screenHeading of [0, 90, 180, 270]) {
        const ast = parse(createLeafVehicleSvg({ colorToken, screenHeading }));
        expect(ast).not.toBeNull();
        expect(ast.props.viewBox).toBe('0 0 64 64');
      }
    }
  });
  it('renders the bundled Halloween shape in every direction and safely falls back for unknown keys', () => {
    expect(resolveVehicleMarkerShapeKey(' HALLOWEEN_PUMPKIN ')).toBe('halloween_pumpkin');
    expect(resolveVehicleMarkerShapeKey('__proto__')).toBe('');
    expect(createLeafMapMarkerSvg({ shapeKey: 'unreleased', colorToken: 'silver' }))
      .toEqual(createLeafVehicleSvg({ colorToken: 'silver' }));
    for (let screenHeading = 0; screenHeading < 360; screenHeading += 45) {
      const xml = createLeafMapMarkerSvg({ shapeKey: 'halloween_pumpkin', screenHeading });
      expect(parse(xml)).not.toBeNull();
      expect(xml).toContain('#E7933E');
      expect(xml).not.toMatch(/<image|<filter|skew|scale|matrix/);
    }
    expect(createLeafMapMarkerSvg({ shapeKey: 'leaf_vehicle', colorToken: 'white' })).toContain('#F0F0F1');
  });
  it('uses a compact vector silhouette with subtle paint and a ground shadow', () => {
    const xml = createLeafVehicleSvg();
    expect(xml).toContain('viewBox="0 0 64 64"');
    expect(xml).toContain('linearGradient');
    expect(xml).toContain('<ellipse');
    expect(xml).not.toMatch(/skew|scale|matrix/);
    expect((xml.match(/<path /g) || []).length).toBeLessThanOrEqual(9);
    expect(xml).not.toMatch(/<image|<filter|data:image|https?:\/\/[^w]/);
  });

  it('changes light direction without distorting the silhouette at any bearing', () => {
    const north = createLeafVehicleSvg({ screenHeading: 0 });
    const paths = xml => [...xml.matchAll(/<path d="([^"]+)"/g)].map(match => match[1]);
    for (let heading = 0; heading < 360; heading += 5) {
      const xml = createLeafVehicleSvg({ screenHeading: heading });
      expect(paths(xml)).toEqual(paths(north));
      expect(xml).not.toMatch(/skew|scale|matrix/);
    }
    expect(resolveVehicleArtworkPose(0).lightX).not.toBe(resolveVehicleArtworkPose(180).lightX);
  });

  it('normalizes shading directions and avoids rebuilding for tiny angular noise', () => {
    expect(resolveVehicleArtworkPose(359).heading).toBe(0);
    expect(resolveVehicleArtworkPose(-90).heading).toBe(270);
    expect(resolveVehicleArtworkPose(90.8)).toEqual(resolveVehicleArtworkPose(89.5));
    expect(resolveVehicleArtworkPose(NaN)).toEqual(resolveVehicleArtworkPose(0));
  });

  it('preserves vehicle colors and isolates gradient ids between cars', () => {
    expect(createLeafVehicleSvg({ colorToken: 'white' })).toContain('#F0F0F1');
    expect(createLeafVehicleSvg({ colorToken: 'silver' })).toContain('#B6B8BC');
    expect(createLeafVehicleSvg({ colorToken: 'unknown' })).toEqual(createLeafVehicleSvg());
    const xml = createLeafVehicleSvg({ idPrefix: 'car:two' });
    expect(xml).toContain('id="cartwo-paint"');
    expect(xml).toContain('url(#cartwo-paint)');
  });
});
