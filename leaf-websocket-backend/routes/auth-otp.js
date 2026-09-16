const express = require('express');
const admin = require('firebase-admin');
const {
    deleteChallenge,
    consumeChallenge,
    generateOtp,
    generateVerificationId,
    storeChallenge
} = require('../services/otp-challenge-service');
const whatsappOtpService = require('../services/whatsapp-otp-service');
const { logger } = require('../utils/logger');
const firebaseConfig = require('../firebase-config');
const { getBypassOtpCode, isOtpBypassPhone, isReviewOtpBypassEnabled } = require('../utils/test-auth-bypass');

const router = express.Router();
const OTP_TTL_SECONDS = 300;

function isProductionRuntime() {
    return String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
}

function respondOtpProviderNotConfigured(res) {
    return res.status(503).json({
        success: false,
        code: 'OTP_PROVIDER_NOT_CONFIGURED',
        error: 'OTP provider not configured'
    });
}

function respondOtpDeliveryFailed(res) {
    return res.status(502).json({
        success: false,
        code: 'OTP_DELIVERY_FAILED',
        error: 'Não foi possível enviar o código agora. Tente novamente.'
    });
}

function respondOtpSecurityNotConfigured(res) {
    return res.status(503).json({
        success: false,
        code: 'OTP_SECURITY_NOT_CONFIGURED',
        error: 'Não foi possível processar o código agora.'
    });
}

function isSimulationAllowed() {
    if (isProductionRuntime()) return false;
    const raw = process.env.AUTH_OTP_SIMULATION_ENABLED;
    if (raw == null || raw === '') return true;
    return ['true', '1', 'yes', 'on', 'sim'].includes(String(raw).trim().toLowerCase());
}

function normalizePhoneDigits(phone) {
    return String(phone || '').replace(/\D/g, '');
}

function normalizePhoneE164(phone) {
    const raw = String(phone || '').trim();
    const digits = normalizePhoneDigits(raw);
    if (!digits) return '';

    if (raw.startsWith('+')) {
        return `+${digits}`;
    }

    if (digits.startsWith('55') && digits.length >= 12) {
        return `+${digits}`;
    }

    if (digits.length === 10 || digits.length === 11) {
        return `+55${digits}`;
    }

    return `+${digits}`;
}

function buildOtpRedisKeys({ verificationId, originalPhone, normalizedPhone }) {
    const safeVerificationId = String(verificationId || '').trim();
    if (!safeVerificationId) return [];

    const keys = new Set();
    const addKey = (phoneValue) => {
        const safePhone = String(phoneValue || '').trim();
        if (!safePhone) return;
        keys.add(`otp:${safeVerificationId}:${safePhone}`);
    };

    addKey(originalPhone);
    addKey(normalizedPhone);

    const digits = normalizePhoneDigits(originalPhone);
    if (digits) {
        addKey(digits);
        addKey(digits.startsWith('55') ? `+${digits}` : `+55${digits}`);
    }

    return Array.from(keys);
}

function buildDefaultRealtimeProfile({ uid, normalizedPhone }) {
    const nowIso = new Date().toISOString();
    const digits = normalizePhoneDigits(normalizedPhone);
    const last4 = digits.slice(-4);
    const displayName = last4 ? `Usuário ${last4}` : 'Usuário Leaf';

    return {
        uid,
        name: displayName,
        firstName: 'Usuário',
        lastName: last4 || 'Leaf',
        mobile: normalizedPhone,
        phone: normalizedPhone,
        phoneNumber: normalizedPhone,
        usertype: 'customer',
        userType: 'customer',
        approved: true,
        isApproved: true,
        status: 'active',
        phoneValidated: true,
        profileComplete: false,
        onboardingCompleted: false,
        hasPassword: false,
        createdVia: 'otp_verify',
        createdAt: nowIso,
        updatedAt: nowIso,
        lastLogin: nowIso
    };
}

async function ensureRealtimeProfileForOtpUser({ uid, normalizedPhone }) {
    try {
        if (!uid) return;
        const realtimeDB =
            typeof firebaseConfig.getRealtimeDB === 'function'
                ? firebaseConfig.getRealtimeDB()
                : null;
        if (!realtimeDB) return;

        const userRef = realtimeDB.ref(`users/${uid}`);
        const snapshot = await userRef.once('value');
        if (snapshot.exists()) {
            return;
        }

        await userRef.set(buildDefaultRealtimeProfile({ uid, normalizedPhone }));
    } catch (error) {
        logger.warn(
            `[CUSTOM OTP] Failed to ensure realtime profile for uid=${uid}: ${error?.message || error}`
        );
    }
}

// Generate and send OTP
router.post('/request-otp', async (req, res) => {
    try {
        const { phone } = req.body;
        if (!phone) return res.status(400).json({ error: 'Phone number required' });
        const rawPhone = String(phone).trim();
        const normalizedPhone = normalizePhoneE164(rawPhone);
        if (!normalizedPhone) {
            return res.status(400).json({ error: 'Invalid phone number' });
        }

        const otpBypassEnabled = isOtpBypassPhone(normalizedPhone);
        const providerConfig = whatsappOtpService.getWhatsAppOtpConfig();
        const providerUnavailable =
            (providerConfig.enabled && !providerConfig.configured) ||
            (isProductionRuntime() && !providerConfig.enabled);
        if (!otpBypassEnabled && providerUnavailable) {
            logger.error('[CUSTOM OTP] OTP request blocked: WhatsApp provider is not configured', {
                service: 'auth-otp-routes',
                provider: providerConfig.provider,
                missing: providerConfig.missing
            });
            return respondOtpProviderNotConfigured(res);
        }
        if (!otpBypassEnabled && !providerConfig.enabled && !isSimulationAllowed()) {
            return respondOtpProviderNotConfigured(res);
        }

        const otp = otpBypassEnabled
            ? getBypassOtpCode(normalizedPhone)
            : generateOtp();
        const verificationId = generateVerificationId('vid');
        let customToken = null;
        const otpRedisKeys = buildOtpRedisKeys({
            verificationId,
            originalPhone: rawPhone,
            normalizedPhone
        });

        if (!otpBypassEnabled) {
            // Save only a keyed HMAC digest; the plaintext OTP never enters Redis.
            try {
                await storeChallenge({
                    namespace: 'login',
                    verificationId,
                    phone: normalizedPhone,
                    otp,
                    keys: otpRedisKeys,
                    ttlSeconds: OTP_TTL_SECONDS
                });
            } catch (redisError) {
                logger.error('Redis error storing OTP challenge', {
                    service: 'auth-otp-routes',
                    error: redisError?.message || String(redisError)
                });
                throw redisError;
            }
        }

        if (otpBypassEnabled) {
            logger.info(`[CUSTOM OTP] Test bypass enabled for ${normalizedPhone} (redis storage skipped)`);

            // Compatibilidade com clientes que já conseguem autenticar direto no passo de request OTP.
            let uid;
            try {
                const userRecord = await admin.auth().getUserByPhoneNumber(normalizedPhone);
                uid = userRecord.uid;
            } catch (authError) {
                if (authError.code === 'auth/user-not-found') {
                    const newUser = await admin.auth().createUser({ phoneNumber: normalizedPhone });
                    uid = newUser.uid;
                } else {
                    throw authError;
                }
            }

            await ensureRealtimeProfileForOtpUser({ uid, normalizedPhone });
            customToken = await admin.auth().createCustomToken(uid);
        } else {
            try {
                if (providerConfig.enabled) {
                    await whatsappOtpService.sendOtp({
                        phoneNumber: normalizedPhone,
                        otp,
                        verificationId
                    });
                }
            } catch (deliveryError) {
                await deleteChallenge(otpRedisKeys).catch(() => undefined);
                if (deliveryError?.code === 'WHATSAPP_OTP_NOT_CONFIGURED') {
                    return respondOtpProviderNotConfigured(res);
                }
                logger.error('[CUSTOM OTP] WhatsApp delivery failed', {
                    service: 'auth-otp-routes',
                    verificationId,
                    error: deliveryError?.message || String(deliveryError)
                });
                return respondOtpDeliveryFailed(res);
            }
        }

        res.json({
            success: true,
            verificationId,
            otpBypassEnabled,
            channel: otpBypassEnabled
                ? 'test_bypass'
                : providerConfig.enabled
                    ? 'whatsapp'
                    : 'simulation',
            expiresIn: OTP_TTL_SECONDS,
            ...(customToken ? { customToken } : {}),
            message: otpBypassEnabled
                ? 'OTP bypass enabled for test account'
                : providerConfig.enabled
                    ? 'Código enviado via WhatsApp'
                    : 'OTP enviado (simulação local)'
        });
    } catch (error) {
        logger.error('Error requesting OTP:', error);
        if (error?.code === 'AUTH_OTP_HMAC_KEY_NOT_CONFIGURED') {
            return respondOtpSecurityNotConfigured(res);
        }
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Verify OTP
router.post('/verify-otp', async (req, res) => {
    try {
        const { phone, verificationId, otp } = req.body;
        if (!phone || !otp) {
            return res.status(400).json({ error: 'Missing parameters' });
        }
        const rawPhone = String(phone).trim();
        const normalizedPhone = normalizePhoneE164(rawPhone);
        if (!normalizedPhone) {
            return res.status(400).json({ error: 'Invalid phone number' });
        }

        const bypassOtpCode = getBypassOtpCode(normalizedPhone);
        const testOtpBypassEnabled = isOtpBypassPhone(normalizedPhone);

        // Test credentials only for Review/App stores.
        const appReviewOtpBypassEnabled = isReviewOtpBypassEnabled();
        const bypassAttempt = otp === bypassOtpCode;
        const bypassAllowedForRequest = bypassAttempt && (testOtpBypassEnabled || appReviewOtpBypassEnabled);

        if (!verificationId && !bypassAllowedForRequest) {
            return res.status(400).json({ error: 'Missing parameters' });
        }

        const providerConfig = whatsappOtpService.getWhatsAppOtpConfig();
        const providerUnavailable =
            (providerConfig.enabled && !providerConfig.configured) ||
            (isProductionRuntime() && !providerConfig.enabled) ||
            (!providerConfig.enabled && !isSimulationAllowed());
        if (!bypassAllowedForRequest && providerUnavailable) {
            logger.error('[CUSTOM OTP] OTP verification blocked: WhatsApp provider is not configured', {
                service: 'auth-otp-routes',
                provider: providerConfig.provider,
                missing: providerConfig.missing
            });
            return respondOtpProviderNotConfigured(res);
        }

        if (bypassAttempt && testOtpBypassEnabled) {
            logger.info(`[CUSTOM OTP] Accepted static test bypass code for ${phone}`);
        } else if (bypassAttempt && appReviewOtpBypassEnabled) {
            logger.info(`[CUSTOM OTP] Accepted static review bypass code for ${phone}`);
        } else if (bypassAttempt) {
            return res.status(400).json({ error: 'Invalid or expired OTP' });
        } else {
            const otpRedisKeys = buildOtpRedisKeys({
                verificationId,
                originalPhone: rawPhone,
                normalizedPhone
            });
            const hasValidOtp = await consumeChallenge({
                namespace: 'login',
                verificationId,
                phone: normalizedPhone,
                otp,
                keys: otpRedisKeys
            });

            if (!hasValidOtp) {
                return res.status(400).json({ error: 'Invalid or expired OTP' });
            }
        }

        // Generate Firebase Custom Token
        let uid;
        try {
            const userRecord = await admin.auth().getUserByPhoneNumber(normalizedPhone);
            uid = userRecord.uid;
        } catch (authError) {
            if (authError.code === 'auth/user-not-found') {
                // If it doesn't exist, create it
                const newUser = await admin.auth().createUser({ phoneNumber: normalizedPhone });
                uid = newUser.uid;
            } else {
                throw authError; // bubble up
            }
        }

        await ensureRealtimeProfileForOtpUser({ uid, normalizedPhone });
        const customToken = await admin.auth().createCustomToken(uid);

        res.json({ success: true, customToken });
    } catch (error) {
        logger.error('Error verifying OTP:', error);
        if (error?.code === 'AUTH_OTP_HMAC_KEY_NOT_CONFIGURED') {
            return respondOtpSecurityNotConfigured(res);
        }
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
