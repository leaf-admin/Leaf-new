import { resolveExistingAccountLogin } from '../src/components/auth/authFlowRecovery';

const verifiedUser = { uid: 'uid_1', phoneNumber: '+5521102938475' };

describe('existing account after OTP', () => {
  it('logs a passenger with a defined role straight in', () => {
    const login = resolveExistingAccountLogin({ verifiedUser, remoteProfile: { uid: 'uid_1', usertype: 'customer', firstName: 'Ana' } });
    expect(login).toEqual(expect.objectContaining({ uid: 'uid_1', userType: 'customer', usertype: 'customer', firstName: 'Ana', phoneNumber: '+5521102938475' }));
  });

  it('logs a driver who completed onboarding straight in', () => {
    const login = resolveExistingAccountLogin({
      verifiedUser,
      remoteProfile: { uid: 'uid_1', userType: 'driver', onboardingVersion: 1 },
    });
    expect(login?.userType).toBe('driver');
  });

  it('keeps role selection for new, incomplete, or mismatched accounts', () => {
    expect(resolveExistingAccountLogin({ verifiedUser, remoteProfile: null })).toBeNull();
    expect(resolveExistingAccountLogin({ verifiedUser, remoteProfile: { uid: 'uid_1' } })).toBeNull();
    expect(resolveExistingAccountLogin({ verifiedUser, remoteProfile: { uid: 'uid_1', usertype: 'customer', onboardingPending: true } })).toBeNull();
    expect(resolveExistingAccountLogin({ verifiedUser, remoteProfile: { uid: 'other', usertype: 'customer' } })).toBeNull();
    expect(resolveExistingAccountLogin({ verifiedUser: {}, remoteProfile: { uid: 'uid_1', usertype: 'customer' } })).toBeNull();
  });

  it('does not skip onboarding for a v2 driver missing completion flags', () => {
    expect(resolveExistingAccountLogin({
      verifiedUser,
      remoteProfile: { uid: 'uid_1', usertype: 'driver', onboardingVersion: 2, onboardingCompleted: true, profileComplete: false },
    })).toBeNull();
  });
});
