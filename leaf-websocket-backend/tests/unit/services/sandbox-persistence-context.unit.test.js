jest.mock('../../../services/payment-runtime-profile-service', () => ({
  resolveProfile: jest.fn()
}));

const paymentRuntimeProfileService = require('../../../services/payment-runtime-profile-service');
const { sealFinancialContext } = require('../../../services/financial-runtime-context');
const {
  resolveRidePersistenceScope,
  resolveUserPersistenceScope,
  assertUserSharesPersistenceScope,
  assertRideParticipantsSharePersistenceScope,
  createExplicitSandboxAccessScope,
  assertStoredRecordMatchesScope
} = require('../../../services/sandbox-persistence-context');

describe('sandbox persistence context', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('classifies a QA user from the payment runtime profile without using operational collections', async () => {
    paymentRuntimeProfileService.resolveProfile.mockResolvedValue({
      profileId: 'qa-test-users-sandbox-durable',
      environment: 'sandbox',
      source: 'firestore',
      testUserSandbox: true
    });

    const scope = await resolveUserPersistenceScope({ userId: 'qa-passenger' });

    expect(scope).toMatchObject({
      namespace: 'sandbox',
      classification: 'sandbox_test_user',
      collections: {
        chatMessages: 'sandbox_chat_messages',
        supportTickets: 'sandbox_support_tickets',
        receipts: 'sandbox_receipts',
        rides: 'sandbox_rides',
        bookings: 'sandbox_bookings',
        ratings: 'sandbox_ratings',
        tripRatings: 'sandbox_trip_ratings',
        ratingTripIndex: 'sandbox_rating_trip_index',
        userRatings: 'sandbox_user_ratings',
        incidents: 'sandbox_ops_incidents',
        tripLocationChunks: 'sandbox_trip_location_chunks',
        tripLocationSummaries: 'sandbox_trip_location_summaries'
      }
    });
    expect(scope.collections.chatMessages).not.toBe('chat_messages');
    expect(scope.collections.supportTickets).not.toBe('support_tickets');
  });

  it('fails closed when the payment profile lookup cannot classify the user', async () => {
    paymentRuntimeProfileService.resolveProfile.mockResolvedValue({
      profileId: 'env-default',
      environment: 'production',
      source: 'env',
      classificationUnavailable: true
    });

    await expect(resolveUserPersistenceScope({ userId: 'qa-passenger' })).rejects.toMatchObject({
      code: 'PERSISTENCE_USER_CLASSIFICATION_UNAVAILABLE'
    });
  });

  it('gives passenger and driver the exact same sealed ride context', () => {
    const financialContext = sealFinancialContext({
      providerEnvironment: 'sandbox',
      paymentProfileId: 'qa-test-users-sandbox-durable',
      paymentProfileSource: 'firestore',
      testUserSandbox: true
    });
    const ride = {
      bookingId: 'ride-sandbox-1',
      customerId: 'qa-passenger',
      driverId: 'qa-driver',
      financialContext,
      financialNamespace: 'sandbox',
      financialContextId: financialContext.contextId,
      providerEnvironment: 'sandbox',
      paymentProfileId: financialContext.paymentProfileId
    };

    const passengerScope = resolveRidePersistenceScope(ride);
    const driverScope = resolveRidePersistenceScope(ride);

    expect(passengerScope.financialContextId).toBe(financialContext.contextId);
    expect(driverScope.financialContextId).toBe(financialContext.contextId);
    expect(passengerScope.collections.chatMessages).toBe('sandbox_chat_messages');
    expect(driverScope).toEqual(passengerScope);
  });

  it('fails closed when a sandbox signal has no sealed financial context', () => {
    expect(() => resolveRidePersistenceScope({
      bookingId: 'ride-sandbox-lost',
      financialNamespace: 'sandbox',
      providerEnvironment: 'sandbox'
    })).toThrow(expect.objectContaining({
      code: 'FINANCIAL_SANDBOX_CONTEXT_LOST'
    }));
  });

  it('fails closed when namespace and sealed context diverge', () => {
    const financialContext = sealFinancialContext({
      providerEnvironment: 'sandbox',
      paymentProfileId: 'qa-profile',
      testUserSandbox: true
    });

    expect(() => resolveRidePersistenceScope({
      financialContext,
      financialNamespace: 'operational'
    })).toThrow(expect.objectContaining({
      code: 'PERSISTENCE_NAMESPACE_MISMATCH'
    }));

    expect(() => resolveRidePersistenceScope({
      financialContext,
      namespace: 'operational'
    })).toThrow(expect.objectContaining({
      code: 'PERSISTENCE_NAMESPACE_MISMATCH'
    }));
  });

  it('fails closed when a ride participant resolves outside the ride sandbox profile', async () => {
    const financialContext = sealFinancialContext({
      providerEnvironment: 'sandbox',
      paymentProfileId: 'qa-test-users-sandbox-durable',
      paymentProfileSource: 'firestore',
      testUserSandbox: true
    });
    paymentRuntimeProfileService.resolveProfile.mockResolvedValue({
      profileId: 'env-default',
      environment: 'production',
      source: 'env',
      testUserSandbox: false
    });

    await expect(assertUserSharesPersistenceScope(financialContext, {
      userId: 'driver-outside-sandbox'
    })).rejects.toMatchObject({
      code: 'SANDBOX_PARTICIPANT_CONTEXT_MISMATCH'
    });
  });

  it('checks both ride participants before allowing sandbox persistence', async () => {
    const financialContext = sealFinancialContext({
      providerEnvironment: 'sandbox',
      paymentProfileId: 'qa-test-users-sandbox-durable',
      paymentProfileSource: 'firestore',
      testUserSandbox: true
    });
    paymentRuntimeProfileService.resolveProfile.mockImplementation(async ({ userId }) => (
      userId === 'qa-driver'
        ? {
            profileId: 'env-default',
            environment: 'production',
            source: 'env',
            testUserSandbox: false
          }
        : {
            profileId: 'qa-test-users-sandbox-durable',
            environment: 'sandbox',
            source: 'firestore',
            testUserSandbox: true
          }
    ));

    await expect(assertRideParticipantsSharePersistenceScope(financialContext, {
      passengerId: 'qa-passenger',
      driverId: 'qa-driver'
    })).rejects.toMatchObject({
      code: 'SANDBOX_PARTICIPANT_CONTEXT_MISMATCH'
    });
  });

  it('does not treat a context-less ride as operational when both users are QA sandbox', async () => {
    paymentRuntimeProfileService.resolveProfile.mockResolvedValue({
      profileId: 'qa-test-users-sandbox-durable',
      environment: 'sandbox',
      source: 'firestore',
      testUserSandbox: true
    });

    await expect(assertRideParticipantsSharePersistenceScope({}, {
      passengerId: 'qa-passenger',
      driverId: 'qa-driver'
    })).rejects.toMatchObject({
      code: 'SANDBOX_PARTICIPANT_CONTEXT_MISMATCH'
    });
  });

  it('rejects a stored record whose envelope diverges from its sealed context', () => {
    const financialContext = sealFinancialContext({
      providerEnvironment: 'sandbox',
      paymentProfileId: 'qa-test-users-sandbox-durable',
      testUserSandbox: true
    });

    expect(() => assertStoredRecordMatchesScope({
      financialContext,
      financialNamespace: 'sandbox',
      financialContextId: 'tampered-context-id'
    }, financialContext)).toThrow(expect.objectContaining({
      code: 'PERSISTENCE_CONTEXT_ID_MISMATCH'
    }));

    expect(() => assertStoredRecordMatchesScope({
      financialContext,
      financialNamespace: 'sandbx',
      financialContextId: financialContext.contextId
    }, financialContext)).toThrow(expect.objectContaining({
      code: 'PERSISTENCE_NAMESPACE_INVALID'
    }));
  });

  it('requires an explicit authorization decision for dashboard sandbox access', () => {
    expect(() => createExplicitSandboxAccessScope({ authorized: false })).toThrow(
      expect.objectContaining({ code: 'SANDBOX_PERSISTENCE_ACCESS_DENIED' })
    );
    expect(createExplicitSandboxAccessScope({ authorized: true })).toMatchObject({
      namespace: 'sandbox',
      explicitSandboxAccess: true,
      collections: { supportTickets: 'sandbox_support_tickets' }
    });
  });
});
