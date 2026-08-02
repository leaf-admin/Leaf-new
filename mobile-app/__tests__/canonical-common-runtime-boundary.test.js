const fs = require('fs');
const path = require('path');

const MOBILE_ROOT = path.resolve(__dirname, '..');

function listJavaScriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listJavaScriptFiles(absolutePath);
    return entry.isFile() && /\.(?:js|jsx|ts|tsx)$/.test(entry.name)
      ? [absolutePath]
      : [];
  });
}

describe('canonical common runtime boundary', () => {
  it('does not load the legacy common package barrel from mobile runtime code', () => {
    const barrelImportPattern = /(?:from\s+|require\()\s*['"](?:\.\.\/)+common['"]/;
    const legacyPackageImportPattern = /common\/common-packages\/src\//;
    const violations = listJavaScriptFiles(path.join(MOBILE_ROOT, 'src'))
      .flatMap((filePath) => {
        const source = fs.readFileSync(filePath, 'utf8');
        return barrelImportPattern.test(source) || legacyPackageImportPattern.test(source)
          ? [path.relative(MOBILE_ROOT, filePath)]
          : [];
      });

    expect(violations).toEqual([]);
  });

  it('routes shared map helpers through canonical runtime bridges', () => {
    const source = fs.readFileSync(
      path.join(MOBILE_ROOT, 'src/common/sharedFunctions.js'),
      'utf8',
    );

    expect(source).toContain("from '../services/runtime/locationRouteBridge';");
    expect(source).toContain("from '../services/runtime/mapGeoService';");
    expect(source).not.toContain("from '../../common';");
  });
});
