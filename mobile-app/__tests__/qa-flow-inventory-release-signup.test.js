const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const surfaceManifest = require('../src/navigation/surfaceManifest.json');
const appNavigator = fs.readFileSync(path.join(ROOT, 'src/navigation/AppNavigator.js'), 'utf8');
const { detectReleaseBlockers } = require('../scripts/qa/generate-flow-inventory');

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
  it('uses the canonical current, redirect, and legacy surface manifest', () => {
    const inventory = readInventory();
    const registeredRoutes = [...appNavigator.matchAll(/<Stack\.Screen\b[\s\S]*?\/>/g)]
      .map(([screen]) => screen.match(/\bname=["']([^"']+)["']/)?.[1])
      .filter(Boolean);
    const expectedRoutes = [...new Set(registeredRoutes)]
      .map(name => ({
        name,
        surfaceStatus: Object.entries(surfaceManifest.routeCategories)
          .find(([, routeNames]) => routeNames.includes(name))?.[0],
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    expect(inventory.routes.map(({ name, surfaceStatus }) => ({ name, surfaceStatus })))
      .toEqual(expectedRoutes);
    const expectedCounts = expectedRoutes.reduce((counts, route) => {
      counts[route.surfaceStatus] = (counts[route.surfaceStatus] || 0) + 1;
      return counts;
    }, {});
    expect(inventory.routeSurfaceCounts).toEqual(expectedCounts);
    const routeNames = new Set(inventory.routes.map(route => route.name));
    expect(surfaceManifest.retiredRoutes.some(routeName => routeNames.has(routeName))).toBe(false);
  });

  it('requires an externally supplied passenger phone and live OTP digits', () => {
    const flow = read('.maestro/flows/qa/e2e/20-passenger-signup-real-android.yaml');

    expect(flow).toContain('appId: br.com.leaf.ride');
    expect(flow).toContain('id: "auth-phone-input"');
    expect(flow).toContain('id: "auth-profile-option-customer"');
    expect(flow).toContain('${PASSENGER_PHONE}');
    for (let digit = 0; digit < 6; digit += 1) {
      expect(flow).toContain('${PASSENGER_OTP_DIGIT_' + digit + '}');
    }
    expect(flow.match(/^\s*inputText:\s*["']\d["']\s*$/gm) || []).toHaveLength(0);
    for (const marker of DEV_OR_MOCK_MARKERS) {
      expect(flow).not.toMatch(marker);
    }
  });

  it('requires an externally supplied driver phone and live OTP digits', () => {
    const flow = read('.maestro/flows/qa/e2e/21-driver-signup-docs-real-android.yaml');

    expect(flow).toContain('appId: br.com.leaf.ride');
    expect(flow).toContain('id: "auth-phone-input"');
    expect(flow).toContain('id: "auth-profile-option-driver"');
    expect(flow).toContain('${DRIVER_PHONE}');
    expect(flow).toContain('CNH');
    expect(flow).toContain('CRLV');
    for (let digit = 0; digit < 6; digit += 1) {
      expect(flow).toContain('${DRIVER_OTP_DIGIT_' + digit + '}');
    }
    expect(flow.match(/^\s*inputText:\s*["']\d["']\s*$/gm) || []).toHaveLength(0);
    for (const marker of DEV_OR_MOCK_MARKERS) {
      expect(flow).not.toMatch(marker);
    }
  });

  it('defines iOS passenger and driver signup without fixed OTP or dev-server flows', () => {
    const passenger = read('.maestro/flows/qa/e2e/20-passenger-signup-real-ios.yaml');
    const driver = read('.maestro/flows/qa/e2e/21-driver-signup-real-ios.yaml');

    for (const [flow, phone, role] of [
      [passenger, '${PASSENGER_PHONE}', 'customer'],
      [driver, '${DRIVER_PHONE}', 'driver'],
    ]) {
      expect(flow).toContain('appId: br.com.leaf.ride');
      expect(flow).toContain('id: "auth-phone-input"');
      expect(flow).toContain(`id: "auth-profile-option-${role}"`);
      expect(flow).toContain(phone);
      for (let digit = 0; digit < 6; digit += 1) {
        const prefix = role === 'customer' ? 'PASSENGER' : 'DRIVER';
        expect(flow).toContain(`\$\{${prefix}_OTP_DIGIT_${digit}\}`);
      }
      expect(flow.match(/^\s*inputText:\s*["']\d["']\s*$/gm) || []).toHaveLength(0);
      for (const marker of DEV_OR_MOCK_MARKERS) {
        expect(flow).not.toMatch(marker);
      }
    }

    expect(driver).toContain('CNH');
    expect(driver).toContain('.pdf');
    expect(driver).not.toMatch(/tapOn:\s*["']Iniciar validação["']/);
  });

  it('blocks flows that type a static OTP fixture from release evidence', () => {
    const fixedOtpFlow = [
      'appId: br.com.leaf.ride',
      '- tapOn:',
      '    id: "auth-otp-digit-0"',
      ...Array.from({ length: 6 }, (_, digit) => [
        `- tapOn: { id: "auth-otp-digit-${digit}" }`,
        `- inputText: "${digit}"`,
      ]).flat(),
    ].join('\n');

    expect(detectReleaseBlockers(fixedOtpFlow)).toContain('fixed-otp-marker');
    expect(detectReleaseBlockers('appId: br.com.leaf.ride\nenv:\n  TEST_OTP: "123456"'))
      .toContain('fixed-otp-marker');
  });

  it('defines signup flows on both platforms without treating them as executed', () => {
    const matrix = readInventory().releaseCoverageMatrix;
    const passenger = matrix.find((row) => row.id === 'passenger_signup');
    const driver = matrix.find((row) => row.id === 'driver_signup');

    expect(readInventory().coverageModel).toBe('static-flow-definition-only');
    expect(passenger).toMatchObject({ status: 'DEFINED', missing: [] });
    expect(passenger.flows).toEqual(expect.arrayContaining([
      '.maestro/flows/qa/e2e/20-passenger-signup-real-android.yaml',
      '.maestro/flows/qa/e2e/20-passenger-signup-real-ios.yaml',
    ]));
    expect(driver).toMatchObject({ status: 'DEFINED', missing: [] });
    expect(driver.flows).toEqual(expect.arrayContaining([
      '.maestro/flows/qa/e2e/21-driver-signup-docs-real-android.yaml',
      '.maestro/flows/qa/e2e/21-driver-signup-real-ios.yaml',
    ]));
  });

  it('labels chat flow availability as a definition, not a completed execution', () => {
    const inventory = readInventory();
    const chat = inventory.releaseCoverageMatrix.find(row => row.id === 'chat');

    expect(inventory.coverageModel).toBe('static-flow-definition-only');
    expect(chat).toMatchObject({
      status: 'DEFINED',
      missing: [],
    });
    expect(chat.flows).toContain('.maestro/flows/rides/02-chat-during-ride.yaml');
  });
});
