const fs = require('fs');
const path = require('path');
const { MARKER, patchSource } = require('../scripts/fix-react-native-maps-android-marker-size');

const UPDATE_SIZE = `  public void update(int width, int height) {
    this.width = width;
    this.height = height;

    update(true);
  }`;
const FIXTURE = `public class MapMarker extends MapFeature {
  private int width;
  private int height;

${UPDATE_SIZE}

  private Bitmap createDrawable() {
    int width = this.width <= 0 ? 100 : this.width;
    int height = this.height <= 0 ? 100 : this.height;
    return null;
  }
}
`;

describe('fix-react-native-maps-android-marker-size', () => {
  it('sizes the marker bitmap from the Fabric layout and redraws when it changes', () => {
    const { status, source } = patchSource(FIXTURE);
    expect(status).toBe('patched');
    expect(source).toContain(UPDATE_SIZE);
    expect(source).toContain(MARKER);
    expect(source).toMatch(/protected void onLayout\(boolean changed, int l, int t, int r, int b\)/);
    expect(source).toContain('this.width = layoutWidth;');
    expect(source).toContain('this.height = layoutHeight;');
    expect(source).toMatch(/clearDrawableCache\(\);\s+update\(true\);/);
  });

  it('is idempotent and leaves an unknown upstream file alone', () => {
    const once = patchSource(FIXTURE).source;
    expect(patchSource(once)).toEqual({ status: 'already', source: once });
    const upstream = FIXTURE.replace(UPDATE_SIZE, '  protected void onLayout(boolean c, int l, int t, int r, int b) {}');
    expect(patchSource(upstream)).toEqual({ status: 'unknown', source: upstream });
  });

  it('is applied to the installed react-native-maps', () => {
    const relativeFile = path.join('react-native-maps', 'android', 'src', 'main', 'java', 'com', 'rnmaps', 'maps', 'MapMarker.java');
    const installed = [
      path.resolve(__dirname, '..', 'node_modules', relativeFile),
      path.resolve(__dirname, '..', '..', 'node_modules', relativeFile),
    ].find((file) => fs.existsSync(file));
    expect(installed).toBeDefined();
    expect(fs.readFileSync(installed, 'utf8')).toContain(MARKER);
  });
});
