const { isRideFlowValidationLaunch } = require('../utils/pilot-launch-flags');

function allowOutsideValidationProfile() {
  return { allowed: true, code: 'RIDE_FLOW_VALIDATION_NOT_ACTIVE' };
}

function evaluateRideFlowValidationPaymentProfile(profile = {}) {
  if (!isRideFlowValidationLaunch()) return allowOutsideValidationProfile();

  const environment = String(profile.environment || '').trim().toLowerCase();
  const scope = String(profile.scope || '').trim().toLowerCase();
  const profileId = String(profile.profileId || '').trim();
  const isDurableTestUserProfile = profile.testUserSandbox === true;

  if (
    environment !== 'sandbox' ||
    scope !== 'users' ||
    !profileId ||
    profileId === 'env-default' ||
    !isDurableTestUserProfile
  ) {
    return {
      allowed: false,
      code: 'RIDE_FLOW_VALIDATION_SANDBOX_PROFILE_REQUIRED',
      message: 'A validação de corrida exige um perfil sandbox exclusivo para usuários de teste.'
    };
  }

  return {
    allowed: true,
    code: 'RIDE_FLOW_VALIDATION_SANDBOX_PROFILE_ALLOWED'
  };
}

function evaluateRideFlowValidationPaymentBinding(binding = {}) {
  if (!isRideFlowValidationLaunch()) return allowOutsideValidationProfile();

  const environment = String(
    binding.providerEnvironment || binding.paymentProviderEnvironment || ''
  ).trim().toLowerCase();
  const profileId = String(binding.paymentProfileId || '').trim();

  if (environment !== 'sandbox' || !profileId || profileId === 'env-default') {
    return {
      allowed: false,
      code: 'RIDE_FLOW_VALIDATION_SANDBOX_PAYMENT_REQUIRED',
      message: 'A corrida de validação exige pagamento confirmado no sandbox.'
    };
  }

  return {
    allowed: true,
    code: 'RIDE_FLOW_VALIDATION_SANDBOX_PAYMENT_ALLOWED'
  };
}

module.exports = {
  evaluateRideFlowValidationPaymentBinding,
  evaluateRideFlowValidationPaymentProfile
};
