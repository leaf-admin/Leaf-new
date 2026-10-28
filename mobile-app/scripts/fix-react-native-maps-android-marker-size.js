const fs = require('fs');
const path = require('path');

// react-native-maps 1.20.1 (Android) só fica sabendo do tamanho de um marcador com filho
// customizado pelo SizeReportingShadowNode -> updateExtraData. Com a New Architecture
// (newArchEnabled=true) o Fabric não usa esse shadow node: width/height do MapMarker ficam
// em 0 e o createDrawable() tira o bitmap em 100x100 px. O carro do motorista (56 dp, 158 px
// num aparelho de densidade 450) saía cortado à direita e embaixo (QA de 2026-10-28).
//
// Aqui o MapMarker passa a usar o tamanho que o Fabric aplica no layout da view (como o
// react-native-maps faz a partir da 1.2x) e refaz o bitmap quando esse tamanho muda, mesmo
// com tracksViewChanges desligado.

const projectRoot = path.resolve(__dirname, '..');
const candidates = [
  path.resolve(projectRoot, 'node_modules', 'react-native-maps'),
  path.resolve(projectRoot, '..', 'node_modules', 'react-native-maps'),
];
const relativeFile = path.join(
  'android', 'src', 'main', 'java', 'com', 'rnmaps', 'maps', 'MapMarker.java'
);
const MARKER = 'LEAF_MARKER_LAYOUT_SIZE';

const originalBody = `  public void update(int width, int height) {
    this.width = width;
    this.height = height;

    update(true);
  }`;

const patchedBody = `${originalBody}

  // ${MARKER}: patched by mobile-app/scripts/fix-react-native-maps-android-marker-size.js
  @Override
  protected void onLayout(boolean changed, int l, int t, int r, int b) {
    super.onLayout(changed, l, t, r, b);
    int layoutWidth = r - l;
    int layoutHeight = b - t;
    if (layoutWidth <= 0 || layoutHeight <= 0) return;
    if (layoutWidth == this.width && layoutHeight == this.height) return;
    this.width = layoutWidth;
    this.height = layoutHeight;
    // Next frame: Fabric lays out the children after this view.
    post(new Runnable() {
      @Override
      public void run() {
        clearDrawableCache();
        update(true);
      }
    });
  }`;

function patchSource(source) {
  if (source.includes(MARKER)) {
    return { status: 'already', source };
  }
  if (!source.includes(originalBody) || /void onLayout\(/.test(source)) {
    return { status: 'unknown', source };
  }
  return { status: 'patched', source: source.replace(originalBody, patchedBody) };
}

function main() {
  const root = candidates.find((candidate) => fs.existsSync(path.join(candidate, relativeFile)));
  if (!root) {
    console.log('[fix-react-native-maps-android-marker-size] react-native-maps not found, skipping');
    return;
  }
  const filePath = path.join(root, relativeFile);
  const result = patchSource(fs.readFileSync(filePath, 'utf8'));
  if (result.status === 'unknown') {
    // Versão nova do react-native-maps: conferir se o MapMarker já usa o tamanho do layout.
    console.warn('[fix-react-native-maps-android-marker-size] MapMarker.java changed upstream, not patched');
    return;
  }
  if (result.status === 'patched') {
    fs.writeFileSync(filePath, result.source);
  }
  console.log(`[fix-react-native-maps-android-marker-size] ${result.status}`);
}

if (require.main === module) {
  main();
}

module.exports = { MARKER, patchSource };
