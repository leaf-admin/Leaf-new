import { createLeafVehicleSvg, resolveVehicleArtworkPose } from '../src/components/prototype/leafVehicleArtwork';
import { parse } from 'react-native-svg';

describe('Leaf vehicle vector artwork', () => {
  it('parses all paint and direction variants with the installed native SVG parser', () => {
    for (const colorToken of ['black', 'white', 'silver', 'gray', 'red', 'blue', 'green', 'yellow']) {
      for (const screenHeading of [0, 90, 180, 270]) {
        const ast = parse(createLeafVehicleSvg({ colorToken, screenHeading }));
        expect(ast).not.toBeNull();
        expect(ast.props.viewBox).toBe('0 0 64 64');
      }
    }
  });
  it('uses only vector surfaces with paint, glass, extrusion and a soft ground shadow', () => {
    const xml = createLeafVehicleSvg();
    expect(xml).toContain('viewBox="0 0 64 64"');
    expect(xml).toContain('linearGradient');
    expect(xml).toContain('<ellipse');
    expect(xml).toContain('skewX(');
    expect(xml).not.toMatch(/<image|<filter|data:image|https?:\/\/[^w]/);
  });

  it('keeps shading and perspective subtle while adapting to screen direction', () => {
    const north = resolveVehicleArtworkPose(0);
    const south = resolveVehicleArtworkPose(180);
    expect(north.side).toBe(-south.side);
    expect(north.skew).toBe(-south.skew);
    for (let heading = 0; heading < 360; heading += 5) {
      const pose = resolveVehicleArtworkPose(heading);
      expect(Math.abs(pose.skew)).toBeLessThanOrEqual(2.2);
      expect(Math.abs(pose.side)).toBeLessThanOrEqual(1.15);
      expect(pose.rise).toBeLessThanOrEqual(1.45);
    }
  });

  it('normalizes shading directions and avoids rebuilding for tiny angular noise', () => {
    expect(resolveVehicleArtworkPose(359).heading).toBe(0);
    expect(resolveVehicleArtworkPose(-90).heading).toBe(270);
    expect(resolveVehicleArtworkPose(90.8)).toEqual(resolveVehicleArtworkPose(89.5));
    expect(resolveVehicleArtworkPose(NaN)).toEqual(resolveVehicleArtworkPose(0));
  });

  it('preserves vehicle colors and isolates gradient ids between cars', () => {
    expect(createLeafVehicleSvg({ colorToken: 'white' })).toContain('#E8EDF0');
    expect(createLeafVehicleSvg({ colorToken: 'silver' })).toContain('#AAB8C0');
    expect(createLeafVehicleSvg({ colorToken: 'unknown' })).toEqual(createLeafVehicleSvg());
    const xml = createLeafVehicleSvg({ idPrefix: 'car:two' });
    expect(xml).toContain('id="cartwo-paint"');
    expect(xml).toContain('url(#cartwo-paint)');
  });
});
