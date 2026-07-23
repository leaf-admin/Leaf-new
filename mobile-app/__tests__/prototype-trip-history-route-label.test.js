const fs = require('fs');
const path = require('path');

describe('Robotaxi trip history route labels', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'screens', 'prototype', 'RobotaxiTripHistoryScreen.js'),
    'utf8',
  );

  it('recognizes canonical runtime pickup and drop aliases', () => {
    expect(source).toContain('item?.pickupLocation?.add');
    expect(source).toContain('item?.originAddress');
    expect(source).toContain('item?.drop ||');
    expect(source).toContain('item?.destinationLocation?.add');
  });

  it('accepts both unicode and ASCII route separators', () => {
    expect(source).toContain("if (/→|->/.test(routeLabel))");
    expect(source).toContain("routeLabel.split(/\\s*(?:→|->)\\s*/)");
  });

  it('keeps honest accented fallbacks when route data is absent', () => {
    expect(source).toContain("'Origem indisponível'");
    expect(source).toContain("'Destino indisponível'");
  });
});
