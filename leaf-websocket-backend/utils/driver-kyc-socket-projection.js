const DEFAULT_KYC_SOCKET_MESSAGE = 'Validação facial necessária para ficar online.';

function optionalPublicString(value) {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    return normalized || null;
}

function buildPublicDriverKycSocketPayload(gateResult = {}, {
    message = DEFAULT_KYC_SOCKET_MESSAGE,
    fallbackCode = 'KYC_REQUIRED'
} = {}) {
    const source = gateResult && typeof gateResult === 'object' ? gateResult : {};
    const challenge = source.challenge && typeof source.challenge === 'object'
        ? source.challenge
        : {};
    const safeMessage = optionalPublicString(message) || DEFAULT_KYC_SOCKET_MESSAGE;
    const reviewAvailable = source.reviewAvailable === true;
    const reviewCaseId = optionalPublicString(source.reviewCaseId);
    const evidenceId = optionalPublicString(source.evidenceId);

    return {
        error: safeMessage,
        reason: safeMessage,
        code: optionalPublicString(source.code) || fallbackCode,
        kycRequired: true,
        requirement: optionalPublicString(source.requirement)
            || optionalPublicString(challenge.requirement)
            || 'LIVENESS_REQUIRED',
        challengeId: optionalPublicString(source.challengeId)
            || optionalPublicString(challenge.challengeId),
        reviewAvailable,
        ...(reviewAvailable && reviewCaseId ? { reviewCaseId } : {}),
        ...(reviewAvailable && evidenceId ? { evidenceId } : {})
    };
}

module.exports = {
    buildPublicDriverKycSocketPayload
};
