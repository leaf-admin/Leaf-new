// WhatsApp OTP falls back to Firebase SMS only when the Leaf backend could
// not deliver (provider down or not configured) or the request never got an
// answer. Send limits (429) and invalid input keep the user on WhatsApp so the
// fallback cannot be used to get around them.
const SMS_FALLBACK_STATUSES = new Set([502, 503, 504]);
const NETWORK_ERROR_CODES = new Set(['ECONNABORTED', 'ERR_NETWORK', 'ETIMEDOUT', 'NETWORK_ERROR']);

// The http client rejects with a UserFriendlyError: status and code sit on the
// error itself and the axios fields only on originalError.
export const shouldFallbackToSmsAfterWhatsAppFailure = (error) => {
    const status = Number(error?.status ?? error?.response?.status) || null;
    if (status != null) return SMS_FALLBACK_STATUSES.has(status);
    if (NETWORK_ERROR_CODES.has(String(error?.code || '').toUpperCase())) return true;
    return Boolean(error?.request) && !error?.response;
};
