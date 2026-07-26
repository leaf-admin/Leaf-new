const fs = require('fs');
const path = require('path');

function readMobileSource(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

function readHandler(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe('canonical server-side KYC caller contract', () => {
  it('routes the current Robotaxi AWS success directly through the canonical server-side compare', () => {
    const source = readMobileSource('src/screens/prototype/RobotaxiHomeScreen.js');
    const handler = readHandler(
      source,
      'const handleDriverKycAwsSuccess = useCallback',
      'const runDriverOnlineMutation = useCallback',
    );

    expect(handler).toContain('kycService.verifyDriverWithAwsReference(driverId,');
    expect(handler).not.toContain('verifyDriverServerSideSelfie(');
    expect(handler).not.toContain('null,');
    expect(handler).toContain('await handleDriverKycVerificationSuccess();');
    expect(handler).toContain('presentDriverKycFailure({');
    expect(handler).not.toContain("setDriverKycLivenessMode('local_after_aws')");
    expect(handler).not.toContain('Tire uma selfie rápida');
    expect(handler).not.toContain('Tente novamente com boa iluminação');
  });

  it('offers one identity-review action and routes it outside the ride flow', () => {
    const source = readMobileSource('src/screens/prototype/RobotaxiHomeScreen.js');
    const presenter = readHandler(
      source,
      'const navigateToDriverIdentityReview = useCallback',
      'useEffect(() => {',
    );

    expect(presenter).toContain("navigation.navigate('RobotaxiPrototypeSupportTicket', ticketParams)");
    expect(presenter).toContain("text: errorPresentation.primaryActionLabel || 'Solicitar análise'");
    expect(presenter).toContain('if (driverHasAcceptedOrActiveWork)');
    expect(presenter).not.toContain('reenviar');
    expect(presenter).not.toContain('trocar CNH');
  });

  it('keeps the runtime support scope limited to opaque KYC review references', () => {
    const source = readMobileSource('src/screens/prototype/prototypeRideRuntime.js');
    const scopeBuilder = readHandler(
      source,
      'function buildRuntimeSupportScope',
      'async function getRealtimeSocket',
    );

    expect(scopeBuilder).toContain('kycEvidenceId');
    expect(scopeBuilder).toContain('kycReviewCaseId');
    expect(scopeBuilder).toContain('kycChallengeId');
    expect(scopeBuilder).toContain('requirement');
    expect(scopeBuilder).not.toContain('similarityScore');
    expect(scopeBuilder).not.toContain('referenceImageUrl');
    expect(scopeBuilder).not.toContain('sourceImageHash');
  });

  it('routes the active earnings withdrawal through native liveness and the canonical server-side compare', () => {
    const source = readMobileSource('src/screens/EarningsReportScreen.js');
    const handler = readHandler(
      source,
      'async function handleWithdrawKycAwsSuccess',
      'function handleWithdrawKycFallbackLocal',
    );

    expect(source).toContain(
      "import AWSNativeLivenessScreen from '../components/KYC/AWSNativeLivenessScreen';",
    );
    expect(source).toContain('<AWSNativeLivenessScreen');
    expect(source).not.toContain('AWSLivenessWebViewScreen');
    expect(handler).toContain('kycService.verifyDriverWithAwsReference(auth.profile.uid,');
    expect(handler).not.toContain('verifyDriverServerSideSelfie(');
    expect(handler).not.toContain('null,');
    expect(handler).toContain('awsSessionId: sessionId,');
    expect(handler).toContain('challengeId: withdrawStepUpChallenge.challengeId,');
    expect(handler).toContain('requirement: withdrawStepUpChallenge.requirement,');
    expect(handler).toContain('DriverBalanceService.requestWithdrawal(');
    expect(handler).not.toContain('kycService.verifyDriver(');
  });
});
