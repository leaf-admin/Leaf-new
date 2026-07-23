const fs = require('fs');
const path = require('path');

const navigatorSource = fs.readFileSync(
  path.resolve(__dirname, '../src/navigation/AppNavigator.js'),
  'utf8',
);

describe('AppNavigator onboarding and identity guard', () => {
  it('blocks private map and realtime surfaces until profile, consents and Firebase identity are valid', () => {
    expect(navigatorSource).toContain(
      'isPersistedProfileOnboardingComplete(auth.profile)'
    );
    expect(navigatorSource).toContain(
      'isProfileIdentityConsistent({'
    );
    expect(navigatorSource).toContain(
      'const sessionKey = profileAuthorized && userId && role'
    );
    expect(navigatorSource).toContain(
      '!profileOnboardingComplete || !profileIdentityAuthorized'
    );
  });
});
