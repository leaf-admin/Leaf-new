const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildReport,
  initRun,
  loadConfig,
  validateLabConfig,
  weightedScore,
} = require('../scripts/qa/ux-lab.cjs');
const {
  buildFindings: buildDoctorFindings,
  loadMobileEnv,
  summarizePaymentRuntimeProbe,
} = require('../scripts/qa/current-flow-e2e-lab.cjs');

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const TEST_VIDEO_BYTES = Buffer.from('leaf-ux-lab-video-fixture');

function runSuccessfulMediaCommand(command) {
  if (command !== 'ffprobe' && command !== 'ffmpeg') {
    throw new Error(`unexpected media command: ${command}`);
  }
  return { status: 0, stdout: '', stderr: '' };
}

function buildTestReport(runDir) {
  return buildReport(runDir, {
    runMediaCommand: runSuccessfulMediaCommand,
  });
}

function attachValidEvidence(runDir, observation) {
  const roleDir = path.join(runDir, 'evidence', observation.role);
  fs.mkdirSync(roleDir, { recursive: true });
  const screenshotName = `${observation.role}-${observation.stateId}.png`;
  const videoName = `${observation.role}-${observation.stateId}.mov`;
  const screenshotPath = path.join(roleDir, screenshotName);
  const videoPath = path.join(roleDir, videoName);
  fs.writeFileSync(screenshotPath, ONE_PIXEL_PNG);
  fs.writeFileSync(videoPath, TEST_VIDEO_BYTES);
  observation.evidence = {
    video: path.relative(runDir, videoPath),
    screenshots: [path.relative(runDir, screenshotPath)],
    notes: 'test fixture',
  };
}

function setRunStatus(runDir, status) {
  const runPath = path.join(runDir, 'run.json');
  const run = JSON.parse(fs.readFileSync(runPath, 'utf8'));
  run.status = status;
  fs.writeFileSync(runPath, `${JSON.stringify(run, null, 2)}\n`);
}

function passEveryObservation(runDir, mutateObservation = () => {}) {
  const observationsDir = path.join(runDir, 'observations');
  fs.readdirSync(observationsDir)
    .filter((name) => name.endsWith('.json'))
    .forEach((name) => {
      const filePath = path.join(observationsDir, name);
      const observation = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      observation.status = 'pass';
      observation.platform = 'ios';
      observation.device = 'iPhone Simulator';
      attachValidEvidence(runDir, observation);
      Object.keys(observation.scores).forEach((key) => {
        observation.scores[key] = 3;
      });
      mutateObservation(observation, name);
      fs.writeFileSync(filePath, `${JSON.stringify(observation, null, 2)}\n`);
    });
}

describe('Leaf UX Lab', () => {
  it('prefers explicit local-run endpoints over values from mobile env files', () => {
    const previousApiUrl = process.env.EXPO_PUBLIC_API_URL;
    const previousSocketUrl = process.env.EXPO_PUBLIC_SOCKET_URL;

    process.env.EXPO_PUBLIC_API_URL = 'http://127.0.0.1:3001';
    process.env.EXPO_PUBLIC_SOCKET_URL = 'http://127.0.0.1:3001';

    try {
      const env = loadMobileEnv();
      expect(env.values.EXPO_PUBLIC_API_URL).toBe('http://127.0.0.1:3001');
      expect(env.values.EXPO_PUBLIC_SOCKET_URL).toBe('http://127.0.0.1:3001');
      expect(env.sources.EXPO_PUBLIC_API_URL).toBe('process');
      expect(env.sources.EXPO_PUBLIC_SOCKET_URL).toBe('process');
    } finally {
      if (previousApiUrl === undefined) delete process.env.EXPO_PUBLIC_API_URL;
      else process.env.EXPO_PUBLIC_API_URL = previousApiUrl;
      if (previousSocketUrl === undefined) delete process.env.EXPO_PUBLIC_SOCKET_URL;
      else process.env.EXPO_PUBLIC_SOCKET_URL = previousSocketUrl;
    }
  });

  it('keeps the canonical debug baseline aligned with the controlled-pilot feature surface', () => {
    const debugEnv = fs.readFileSync(
      path.join(__dirname, '../scripts/qa/current-flow-e2e-debug-env.sh'),
      'utf8',
    );

    [
      'EXPO_PUBLIC_ENABLE_DRIVER_WITHDRAWALS',
      'EXPO_PUBLIC_ENABLE_REFERRAL_PROGRAMS',
      'EXPO_PUBLIC_ENABLE_LEAF_DELAS',
      'EXPO_PUBLIC_ENABLE_DRIVER_DESTINATION_MODE',
      'EXPO_PUBLIC_ENABLE_DYNAMIC_PRICING',
      'EXPO_PUBLIC_ENABLE_SMART_PUSH',
      'EXPO_PUBLIC_ENABLE_SOFT_BAN_ENFORCEMENT',
      'EXPO_PUBLIC_ENABLE_ADMIN_MUTATIONS',
    ].forEach((flag) => {
      expect(debugEnv).toContain(`export ${flag}=\"\${${flag}:-false}\"`);
    });

    expect(debugEnv).toContain(
      'export LEAF_LAUNCH_PROFILE="${LEAF_LAUNCH_PROFILE:-ride_flow_validation}"',
    );
    expect(debugEnv).not.toContain('backend already has real Woovi sandbox');

    const debugRunner = fs.readFileSync(
      path.join(__dirname, '../scripts/qa/current-flow-e2e-debug-run.sh'),
      'utf8',
    );
    expect(debugRunner).toContain('nohup env -u CI npx expo start');
    expect(debugRunner).not.toContain('nohup script -q /dev/null');
  });

  it('accepts a backend-scoped sandbox profile for the canonical QA passenger', () => {
    const paymentRuntime = summarizePaymentRuntimeProbe(
      {
        ok: true,
        status: 200,
        json: {
          paymentRuntime: {
            defaultEnvironment: 'production',
            canarySandboxEnabled: true,
            globalSandboxEnabled: false,
            activeProfileCount: 1,
            effectiveProfile: {
              profileId: 'qa-test-users-sandbox-durable',
              environment: 'sandbox',
              scope: 'users',
              source: 'firestore',
              reason: 'durable_test_users_payment_sandbox_policy',
              contextMatched: true,
            },
          },
        },
      },
      { source: 'test-results/qa-preflight/ensure-users.json' },
    );
    const findings = buildDoctorFindings({
      envSummary: [
        'EXPO_PUBLIC_API_URL',
        'EXPO_PUBLIC_BACKEND_URL',
        'EXPO_PUBLIC_WS_URL',
        'EXPO_PUBLIC_SOCKET_URL',
        'EXPO_PUBLIC_DASHBOARD_URL',
      ].map((key) => ({ key, present: true })),
      backend: {
        health: { ok: true },
        runtimeFlags: {
          ok: true,
          json: {
            guards: {
              requirePaymentBeforeBooking: true,
              mockPaymentForTests: false,
              paymentForceBypass: false,
              authTestOtpBypassEnabled: true,
            },
          },
        },
        paymentRuntime,
      },
      devices: { android: [], ios: [{ state: 'Booted' }] },
      artifacts: { androidDebug: { exists: false }, iosDebug: { exists: true } },
      metro: { ok: true },
      iosOnly: true,
    });

    expect(paymentRuntime.json.paymentRuntime.defaultEnvironment).toBe('production');
    expect(paymentRuntime.json.paymentRuntime.effectiveProfile.environment).toBe('sandbox');
    expect(findings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'payment_strategy_required' }),
      ]),
    );
  });

  it('keeps canonical journeys valid and free from legacy entry links', () => {
    const config = loadConfig();
    expect(validateLabConfig(config.journeys, config.rubric)).toEqual([]);

    const serializedJourneys = JSON.stringify(config.journeys.journeys);
    config.journeys.forbiddenAcceptanceDeepLinks.forEach((legacyLink) => {
      expect(serializedJourneys).not.toContain(legacyLink);
    });
    config.journeys.forbiddenAcceptanceTestIds.forEach((standaloneTestId) => {
      expect(serializedJourneys).not.toContain(standaloneTestId);
    });

    const driverJourney = config.journeys.journeys.find(
      (journey) => journey.role === 'driver',
    );
    const passengerJourney = config.journeys.journeys.find(
      (journey) => journey.role === 'passenger',
    );
    const driverStates = Object.fromEntries(
      driverJourney.states.map((state) => [state.id, state.requiredTestIds]),
    );
    const driverPrimaryActions = Object.fromEntries(
      driverJourney.states.map((state) => [state.id, state.primaryAction]),
    );

    expect(driverStates.offer).toEqual([
      'driver-live-ride-overlay-wrap',
      'driver-live-offer-card',
      'driver-live-offer-accept-button',
    ]);
    expect(driverStates.accepted).toContain('driver-live-primary-action-arrive-button');
    expect(driverStates.arrived).toContain('driver-live-primary-action-start-button');
    expect(driverStates.started).toContain('driver-live-primary-action-complete-button');
    expect(driverStates.operational_interruption).toContain(
      'driver-live-operational-hold-title',
    );
    expect(driverPrimaryActions.accepted).toBe('Cheguei ao embarque');
    expect(driverPrimaryActions.started).toBe('Finalizar corrida');
    expect(driverPrimaryActions.operational_interruption).toBe(
      'Aguardar decisão do passageiro',
    );
    const passengerStates = Object.fromEntries(
      passengerJourney.states.map((state) => [state.id, state.requiredTestIds]),
    );
    expect(passengerStates.no_drivers).toContain('passenger-no-drivers-screen');
    expect(passengerStates.operational_interruption).toEqual(
      expect.arrayContaining([
        'passenger-trip-operational-title',
        'passenger-trip-operational-continue-button',
      ]),
    );
  });

  it('rejects a state that references a forbidden legacy entry link', () => {
    const config = loadConfig();
    const invalid = JSON.parse(JSON.stringify(config.journeys));
    invalid.journeys[0].states[0].entryDeepLink = 'leafapp://robotaxi/destination';

    expect(validateLabConfig(invalid, config.rubric)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('references forbidden link leafapp://robotaxi/destination'),
      ]),
    );
  });

  it('rejects standalone driver surface IDs as current lifecycle evidence', () => {
    const config = loadConfig();
    const invalid = JSON.parse(JSON.stringify(config.journeys));
    const driverJourney = invalid.journeys.find(
      (journey) => journey.role === 'driver',
    );
    const acceptedState = driverJourney.states.find(
      (state) => state.id === 'accepted',
    );
    acceptedState.requiredTestIds = ['driver-live-trip-screen'];

    expect(validateLabConfig(invalid, config.rubric)).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          'references forbidden standalone testID driver-live-trip-screen',
        ),
      ]),
    );
  });

  it('creates a complete run scaffold and generates a prioritized report', () => {
    const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leaf-ux-lab-'));
    const runDir = initRun({ runId: 'test-run', runsDir });
    const observationPath = path.join(runDir, 'observations', 'passenger--home.json');
    const run = JSON.parse(fs.readFileSync(path.join(runDir, 'run.json'), 'utf8'));
    const observation = JSON.parse(fs.readFileSync(observationPath, 'utf8'));
    const config = loadConfig();

    expect(run.rules.executionTarget).toBe('ios-simulator');
    setRunStatus(runDir, 'completed');

    observation.status = 'fail';
    observation.platform = 'ios';
    observation.device = 'iPhone test';
    attachValidEvidence(runDir, observation);
    Object.keys(observation.scores).forEach((key) => {
      observation.scores[key] = key === 'primary_action' ? 0 : 2;
    });
    observation.findings.push({
      severity: 'critical',
      title: 'Ação principal ambígua',
      evidence: 'Dois CTAs preenchidos na captura home.png',
      recommendation: 'Manter somente o CTA de destino',
    });
    fs.writeFileSync(observationPath, `${JSON.stringify(observation, null, 2)}\n`);

    expect(weightedScore(observation, config.rubric)).toBeLessThan(2);
    const result = buildTestReport(runDir);
    const report = fs.readFileSync(result.outputPath, 'utf8');

    expect(result.validationErrors).toEqual([]);
    expect(result.acceptanceBlockers).toEqual(
      expect.arrayContaining([
        expect.stringContaining('19/20 states remain not_run'),
        expect.stringContaining('1 states failed UX acceptance'),
      ]),
    );
    expect(report).toContain('P0 [passenger/home] Ação principal ambígua');
    expect(report).toContain('Coverage: 1/20 states');
    expect(report).toContain('Acceptance: FAIL');
  });

  it('passes the acceptance gate only when every lifecycle state passed', () => {
    const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leaf-ux-lab-pass-'));
    const runDir = initRun({ runId: 'complete-run', runsDir });
    setRunStatus(runDir, 'completed');
    passEveryObservation(runDir);

    const result = buildTestReport(runDir);
    const report = fs.readFileSync(result.outputPath, 'utf8');

    expect(result.validationErrors).toEqual([]);
    expect(result.acceptanceBlockers).toEqual([]);
    expect(result.coverage).toEqual([20, 20]);
    expect(report).toContain('Acceptance: PASS');
  });

  it('requires the run to be completed before acceptance', () => {
    const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leaf-ux-lab-prepared-'));
    const runDir = initRun({ runId: 'prepared-run', runsDir });
    passEveryObservation(runDir);

    const result = buildTestReport(runDir);
    const report = fs.readFileSync(result.outputPath, 'utf8');

    expect(result.validationErrors).toEqual([]);
    expect(result.acceptanceBlockers).toEqual(
      expect.arrayContaining([
        expect.stringContaining('run status must be completed for acceptance'),
      ]),
    );
    expect(report).toContain('Acceptance: FAIL');
  });

  it('does not allow run rules to disable mandatory acceptance gates', () => {
    const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leaf-ux-lab-rules-'));
    const runDir = initRun({ runId: 'invalid-rules-run', runsDir });
    const runPath = path.join(runDir, 'run.json');
    const run = JSON.parse(fs.readFileSync(runPath, 'utf8'));
    run.status = 'completed';
    run.buildType = 'release';
    run.canonicalStartDeepLink = 'leafapp://robotaxi/payment';
    run.rules.executionTarget = 'physical-device';
    run.rules.legacyEvidenceAllowed = true;
    run.rules.stateInjectionCountsAsIntegratedE2E = true;
    run.rules.screenshotAloneCountsAsUxValidation = true;
    run.rules.requireAllStatesForAcceptance = false;
    run.rules.requirePassForAcceptance = false;
    fs.writeFileSync(runPath, `${JSON.stringify(run, null, 2)}\n`);

    const result = buildTestReport(runDir);
    const report = fs.readFileSync(result.outputPath, 'utf8');

    expect(result.validationErrors).toEqual([]);
    expect(result.acceptanceBlockers).toEqual(
      expect.arrayContaining([
        expect.stringContaining('run buildType must be debug'),
        expect.stringContaining(
          'run canonicalStartDeepLink must be leafapp://robotaxi/home',
        ),
        expect.stringContaining('run rule executionTarget must be ios-simulator'),
        expect.stringContaining('run rule legacyEvidenceAllowed must be false'),
        expect.stringContaining('run rule stateInjectionCountsAsIntegratedE2E must be false'),
        expect.stringContaining('run rule screenshotAloneCountsAsUxValidation must be false'),
        expect.stringContaining('run rule requireAllStatesForAcceptance must be true'),
        expect.stringContaining('run rule requirePassForAcceptance must be true'),
        expect.stringContaining('20/20 states remain not_run'),
      ]),
    );
    expect(report).toContain('Coverage: 0/20 states');
    expect(report).toContain('Acceptance: FAIL');
  });

  it('rejects observation manifests that drift from the canonical journey contract', () => {
    const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leaf-ux-lab-contract-'));
    const runDir = initRun({ runId: 'invalid-contract-run', runsDir });
    const observationPath = path.join(runDir, 'observations', 'passenger--home.json');
    const observation = JSON.parse(fs.readFileSync(observationPath, 'utf8'));
    observation.journeyId = 'legacy_passenger_journey';
    observation.task.objective = 'Legacy objective';
    observation.task.question = 'Legacy question';
    observation.task.expectedPrimaryAction = 'Legacy action';
    observation.task.requiredTestIds = ['legacy-screen'];
    fs.writeFileSync(observationPath, `${JSON.stringify(observation, null, 2)}\n`);

    const result = buildTestReport(runDir);

    expect(result.validationErrors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('journeyId must be passenger_request_and_ride'),
        expect.stringContaining('task.objective does not match'),
        expect.stringContaining('task.question does not match'),
        expect.stringContaining('task.expectedPrimaryAction does not match'),
        expect.stringContaining('task.requiredTestIds does not match'),
      ]),
    );
  });

  it('rejects a passing observation when a rubric gate is below 2', () => {
    const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leaf-ux-lab-gate-'));
    const runDir = initRun({ runId: 'gate-failure-run', runsDir });
    setRunStatus(runDir, 'completed');
    passEveryObservation(runDir, (observation, name) => {
      if (name === 'passenger--home.json') {
        observation.scores.primary_action = 1;
      }
    });

    const result = buildTestReport(runDir);
    const report = fs.readFileSync(result.outputPath, 'utf8');

    expect(result.validationErrors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('gate score primary_action must be at least 2 for pass'),
      ]),
    );
    expect(result.acceptanceBlockers).toEqual([]);
    expect(report).toContain('Validation errors: 1');
    expect(report).toContain('Acceptance: FAIL');
  });

  it('rejects duplicate role and state observations', () => {
    const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leaf-ux-lab-duplicate-'));
    const runDir = initRun({ runId: 'duplicate-run', runsDir });
    setRunStatus(runDir, 'completed');
    passEveryObservation(runDir);
    const observationsDir = path.join(runDir, 'observations');
    fs.copyFileSync(
      path.join(observationsDir, 'passenger--home.json'),
      path.join(observationsDir, 'passenger--home-copy.json'),
    );

    const result = buildTestReport(runDir);
    const report = fs.readFileSync(result.outputPath, 'utf8');

    expect(result.validationErrors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('duplicate observation files for passenger--home: 2'),
      ]),
    );
    expect(result.acceptanceBlockers).toEqual(
      expect.arrayContaining([
        expect.stringContaining('1 lifecycle states have duplicate observations'),
      ]),
    );
    expect(report).toContain('Acceptance: FAIL');
  });
});
