import { robotaxiPrototypeTokens } from '../src/components/design-system/robotaxiPrototypeTokens';

const TOKEN_COLOR_KEYS = ['bg', 'surface', 'text', 'accent', 'brand', 'feedback', 'border', 'shadow'];

describe('dark ambient token foundation', () => {
  it('colorDark mirrors the canonical light color groups', () => {
    const { color, colorDark } = robotaxiPrototypeTokens;

    TOKEN_COLOR_KEYS.forEach((groupKey) => {
      expect(colorDark[groupKey]).toBeDefined();
      expect(Object.keys(colorDark[groupKey]).sort()).toEqual(
        Object.keys(color[groupKey]).sort()
      );
    });
  });

  it('dark surfaces provide at least four elevation levels', () => {
    const { colorDark } = robotaxiPrototypeTokens;
    const surfaces = new Set([
      colorDark.bg.app,
      colorDark.bg.panelSolid,
      colorDark.surface.tertiary,
      colorDark.surface.activeSoft,
      colorDark.surface.activeStrong,
    ]);
    expect(surfaces.size).toBeGreaterThanOrEqual(4);
  });

  it('dark background is green-black ambient, not pure black or light', () => {
    const { colorDark } = robotaxiPrototypeTokens;
    expect(colorDark.bg.app.toLowerCase()).toBe('#0e1409');
  });

  it('dark accent and lime pop against the dark base', () => {
    const { colorDark } = robotaxiPrototypeTokens;
    expect(colorDark.accent.primary.toLowerCase()).toBe('#d4e84a');
    expect(colorDark.brand.lime.toLowerCase()).toBe('#d4e84a');
  });
});
