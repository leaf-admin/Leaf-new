const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function readInventory() {
  return JSON.parse(read('docs/qa-flow-inventory.json'));
}

const DEV_OR_MOCK_MARKERS = [
  /No development servers found/i,
  /Enter URL manually/i,
  /10\.0\.2\.2:8081/i,
  /localhost:8081/i,
  /payment[-_\s]?bypass/i,
  /PaymentBypassService/i,
  /mockPayment|paymentMock|mock-payment/i,
];

describe('release signup flow inventory', () => {
  it('keeps Android passenger signup flow release-safe', () => {
    const flow = read('.maestro/flows/qa/e2e/20-passenger-signup-real-android.yaml');

    expect(flow).toContain('appId: br.com.leaf.ride');
    expect(flow).toContain('id: "auth-phone-input"');
    expect(flow).toContain('id: "auth-profile-option-customer"');
    for (const marker of DEV_OR_MOCK_MARKERS) {
      expect(flow).not.toMatch(marker);
    }
  });

  it('keeps Android driver signup and document flow release-safe', () => {
    const flow = read('.maestro/flows/qa/e2e/21-driver-signup-docs-real-android.yaml');

    expect(flow).toContain('appId: br.com.leaf.ride');
    expect(flow).toContain('id: "auth-phone-input"');
    expect(flow).toContain('id: "auth-profile-option-driver"');
    expect(flow).toContain('CNH');
    expect(flow).toContain('CRLV');
    for (const marker of DEV_OR_MOCK_MARKERS) {
      expect(flow).not.toMatch(marker);
    }
  });

  it('tracks remaining signup gap as iOS only', () => {
    const matrix = readInventory().releaseCoverageMatrix;
    const passenger = matrix.find((row) => row.id === 'passenger_signup');
    const driver = matrix.find((row) => row.id === 'driver_signup');

    expect(passenger).toMatchObject({
      status: 'GAP',
      missing: ['platform:ios'],
      flows: ['.maestro/flows/qa/e2e/20-passenger-signup-real-android.yaml'],
    });
    expect(driver).toMatchObject({
      status: 'GAP',
      missing: ['platform:ios'],
      flows: ['.maestro/flows/qa/e2e/21-driver-signup-docs-real-android.yaml'],
    });
  });
});
