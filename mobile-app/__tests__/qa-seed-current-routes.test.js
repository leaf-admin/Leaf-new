const fs = require('fs');
const path = require('path');

const MOBILE_ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(MOBILE_ROOT, relativePath), 'utf8');
}

describe('prototype QA seeds', () => {
  const seedPaths = [
    'scripts/qa/seed-prototype-ios-state.cjs',
    'scripts/qa/seed-prototype-android-state.cjs',
  ];

  it.each(seedPaths)('does not open stale booking or payment surfaces in %s', (seedPath) => {
    const source = read(seedPath);

    expect(source).not.toContain('leafapp://robotaxi/booking?');
    expect(source).not.toContain('leafapp://robotaxi/payment?');
    expect(source).not.toContain('leafapp://robotaxi/trip?');
    expect(source).toContain("return 'leafapp://robotaxi/home';");
  });

  it('normalizes retired booking and payment links to the current home flow', () => {
    const navigator = read('src/navigation/AppNavigator.js');

    expect(navigator).toContain("normalizedPathname === 'robotaxi/booking'");
    expect(navigator).toContain("normalizedPathname === 'robotaxi/payment'");
    expect(navigator).toContain("return 'robotaxi/home';");
  });
});
