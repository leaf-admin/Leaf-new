import * as Device from 'expo-device';
import Constants from 'expo-constants';

const TRUTHY_VALUES = new Set(['1', 'true', 'yes', 'on']);

const normalizeFlag = (value) => TRUTHY_VALUES.has(String(value ?? '').trim().toLowerCase());

const expoExtra = () => Constants?.expoConfig?.extra || {};

export const isDevelopmentBuild = () => __DEV__ === true;
export const isSimulatorBuild = () => Device.isDevice === false;

export const isReviewBuild = () =>
    expoExtra().isReview === true || normalizeFlag(process.env.APP_REVIEW);

export const isE2ETestBuild = () => normalizeFlag(process.env.EXPO_PUBLIC_E2E_TEST);

export const allowReviewAccess = () => isReviewBuild();

export const allowCustomOtpFallback = () =>
    isDevelopmentBuild() ||
    isReviewBuild() ||
    isE2ETestBuild() ||
    expoExtra().enableCustomOtpFallback === true;

export const allowQaOtpForceFlow = () => isDevelopmentBuild() || isE2ETestBuild();

export const allowTestUserTools = () => isDevelopmentBuild() || isE2ETestBuild();

export const hasExplicitPaymentBypassFlag = () =>
    normalizeFlag(process.env.EXPO_PUBLIC_FORCE_PAYMENT_BYPASS) ||
    normalizeFlag(process.env.EXPO_PUBLIC_BYPASS_PAYMENTS);

export const allowPaymentBypass = () => allowTestUserTools();

export const allowForcedPaymentBypass = () =>
    isE2ETestBuild() ||
    isSimulatorBuild() ||
    (isDevelopmentBuild() && hasExplicitPaymentBypassFlag());

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
    hasExplicitPaymentBypassFlag: hasExplicitPaymentBypassFlag()
});
