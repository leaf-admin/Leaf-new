'use strict';

const fs = require('fs');
const path = require('path');

function readBackendSource(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, '../../..', relativePath), 'utf8');
}

describe('KYC runtime scope wiring', () => {
  test('online gate resolves the authoritative runtime before consulting legacy operational state', () => {
    const source = readBackendSource('server.js');
    const start = source.indexOf('async function enforceDailyKYCForOnline(driverId)');
    const end = source.indexOf('\nasync function findAvailableDriversForPickup', start);
    const onlineGate = source.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(source).toContain(
      "const { resolveKycRuntimeForUser } = require('./services/kyc-runtime-scope-service');"
    );
    expect(onlineGate).toContain('const kycRuntime = await resolveKycRuntimeForUser({');
    expect(onlineGate).toContain("if (kycRuntime.namespace === 'operational')");
    expect(onlineGate).toContain('return kycRuntime.trust.evaluateOnlineGate(driverId);');
    expect(onlineGate.indexOf('resolveKycRuntimeForUser'))
      .toBeLessThan(onlineGate.indexOf('applyDeferredIdentityReverificationIfSafe'));
    expect(onlineGate).not.toContain('driverIdentityTrustService.evaluateOnlineGate');
  });

  test('support identity workflow resolves runtime with the already authorized persistence context', () => {
    const source = readBackendSource('bootstrap/register-socket-safety-support-handlers.js');

    expect(source).toContain(
      "const { resolveKycRuntimeForUser } = require('../services/kyc-runtime-scope-service');"
    );
    expect(source).toContain('expectedPersistenceContext: persistenceContext');
    expect(source).toContain('identityReviewWorkflowService = kycRuntime.workflow;');
    expect(source.indexOf('const kycRuntime = await resolveKycRuntimeForUser({'))
      .toBeLessThan(source.indexOf('const { ticket, queue } = await supportQueueService.createSupportTicket({'));
  });
});
