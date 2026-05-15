import * as Device from 'expo-device';
import Constants from 'expo-constants';

const TRUTHY_VALUES = new Set(['1', 'true', 'yes', 'on']);

const normalizeFlag = (value) => TRUTHY_VALUES.has(String(value ?? '').trim().toLowerCase());

const expoExtra = () => Constants?.expoConfig?.extra || {};
const normalizeExtraFlag = (key) => normalizeFlag(expoExtra()?.[key]);

export const isDevelopmentBuild = () => __DEV__ === true;
export const isSimulatorBuild = () => Device.isDevice === false;

export const isReviewBuild = () =>
    expoExtra().isReview === true || normalizeFlag(process.env.APP_REVIEW);

export const isE2ETestBuild = () =>
    normalizeFlag(process.env.EXPO_PUBLIC_E2E_TEST) ||
    normalizeExtraFlag('e2eTest');

export const allowReviewAccess = () => isReviewBuild();

export const hasExplicitCustomOtpFallbackFlag = () =>
    normalizeFlag(process.env.EXPO_PUBLIC_ENABLE_CUSTOM_OTP_FALLBACK);

export const hasExplicitQaOtpForceFlag = () =>
    normalizeFlag(process.env.EXPO_PUBLIC_ENABLE_QA_OTP_FORCE_FLOW);

export const hasExplicitTestUserToolsFlag = () =>
    normalizeFlag(process.env.EXPO_PUBLIC_ENABLE_TEST_USER_TOOLS) ||
    normalizeExtraFlag('enableTestUserTools');

export const allowCustomOtpFallback = () =>
    isReviewBuild() ||
    expoExtra().enableCustomOtpFallback === true ||
    (
        hasExplicitCustomOtpFallbackFlag() &&
        (isDevelopmentBuild() || isE2ETestBuild() || isSimulatorBuild())
    );

export const allowQaOtpForceFlow = () =>
    hasExplicitQaOtpForceFlag() &&
    (isDevelopmentBuild() || isE2ETestBuild() || isSimulatorBuild());

export const allowTestUserTools = () =>
    hasExplicitTestUserToolsFlag() &&
    (isDevelopmentBuild() || isE2ETestBuild() || isSimulatorBuild());

export const hasExplicitPaymentBypassFlag = () =>
    normalizeFlag(process.env.EXPO_PUBLIC_FORCE_PAYMENT_BYPASS) ||
    normalizeFlag(process.env.EXPO_PUBLIC_BYPASS_PAYMENTS) ||
    normalizeExtraFlag('forcePaymentBypass') ||
    normalizeExtraFlag('bypassPayments');

export const allowPaymentBypass = () => allowTestUserTools() && hasExplicitPaymentBypassFlag();

export const allowForcedPaymentBypass = () =>
    hasExplicitPaymentBypassFlag() &&
    (isE2ETestBuild() || isSimulatorBuild() || isDevelopmentBuild());

export const allowClientDirectGoogleFallback = () =>
    isDevelopmentBuild() ||
    isE2ETestBuild() ||
    isSimulatorBuild();

export const canUseProfileBypass = (profile) => {
    const uid = String(profile?.uid || '').trim();
    const isReviewIdentity = profile?.isReviewAccount === true || uid.startsWith('review-');
    const isTestIdentity =
        profile?.isTestUser === true ||
        uid.includes('test-user-dev') ||
        uid.includes('test-customer-dev');

    if (isReviewIdentity) {
        return allowReviewAccess();
    }

    if (isTestIdentity) {
        return allowTestUserTools();
    }

    return false;
};

export const getRuntimeAccessPolicySnapshot = () => ({
    isDevelopmentBuild: isDevelopmentBuild(),
    isSimulatorBuild: isSimulatorBuild(),
    isReviewBuild: isReviewBuild(),
    isE2ETestBuild: isE2ETestBuild(),
    allowReviewAccess: allowReviewAccess(),
    allowCustomOtpFallback: allowCustomOtpFallback(),
    allowQaOtpForceFlow: allowQaOtpForceFlow(),
    allowTestUserTools: allowTestUserTools(),
    allowPaymentBypass: allowPaymentBypass(),
    allowForcedPaymentBypass: allowForcedPaymentBypass(),
    hasExplicitCustomOtpFallbackFlag: hasExplicitCustomOtpFallbackFlag(),
    hasExplicitQaOtpForceFlag: hasExplicitQaOtpForceFlag(),
    hasExplicitTestUserToolsFlag: hasExplicitTestUserToolsFlag(),
    hasExplicitPaymentBypassFlag: hasExplicitPaymentBypassFlag(),
    allowClientDirectGoogleFallback: allowClientDirectGoogleFallback()
});
