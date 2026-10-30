const express = require('express');
const admin = require('firebase-admin');
const redisPool = require('../utils/redis-pool');
const { logger } = require('../utils/logger');
const userStore = require('../services/user-store');
const { getBypassOtpCode, isOtpBypassPhone, isReviewOtpBypassEnabled } = require('../utils/test-auth-bypass');
const whatsappOtpService = require('../services/whatsapp-otp-service');
const { createOtpChallengeService, resolveHmacKey } = require('../services/otp-challenge-service');

const router = express.Router();

function getChallengeService() {
    return createOtpChallengeService({ redis: redisPool.getConnection() });
}

// WhatsApp is the only real delivery provider for this route. Firebase Phone
// Auth/SMS is exchanged directly by the app and never reaches it.
function isWhatsAppOtpReady() {
    return whatsappOtpService.getWhatsAppOtpConfig().configured
        && Boolean(resolveHmacKey());
}

function respondOtpError(res, error) {
    return res.status(error.status).json({
        success: false,
        code: error.code,
        error: error.message,
        ...(error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {}),
        ...(error.attemptsRemaining != null ? { attemptsRemaining: error.attemptsRemaining } : {})
    });
}

async function initializeNewReadModels(userRecord) {
    try {
        const result = await require('../services/new-user-read-models').initialize(userRecord);
        if (result.failed) logger.warn('[READ_MODELS] New account initialization incomplete; conservative readers remain available');
    } catch (_) {
        logger.warn('[READ_MODELS] New account initialization deferred; no historical readiness assumed');
    }
}

function isProductionRuntime() {
    return String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
}

function respondOtpProviderNotConfigured(res) {
    return res.status(503).json({
        success: false,
        code: 'OTP_PROVIDER_NOT_CONFIGURED',
        error: 'OTP provider not configured for production'
    });
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
        const firestore = userStore.resolveFirestore();
        if (!firestore) return;

        // users/{uid} is created here only for a brand-new account; an
        // existing record is left as it is.
        await userStore.createUserIfMissing(firestore, uid, buildDefaultRealtimeProfile({ uid, normalizedPhone }));
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
        const whatsappReady = isWhatsAppOtpReady();
        if (isProductionRuntime() && !otpBypassEnabled && !whatsappReady) {
            logger.error('[CUSTOM OTP] Production request blocked: no real OTP delivery provider is configured');
            return respondOtpProviderNotConfigured(res);
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
                    await initializeNewReadModels(newUser);
                    uid = newUser.uid;
                } else {
                    throw authError;
                }
            }

            await ensureRealtimeProfileForOtpUser({ uid, normalizedPhone });
            const customToken = await admin.auth().createCustomToken(uid);
            return res.json({
                success: true,
                verificationId: `vid_bypass_${Date.now()}`,
                otpBypassEnabled,
                customToken,
                message: 'OTP bypass enabled for test account'
            });
        }

        const challenges = getChallengeService();
        await challenges.reserveSend({ phone: normalizedPhone, ip: req.ip });
        const { verificationId, otp, expiresIn } = await challenges.create({ phone: normalizedPhone });

        if (whatsappReady) {
            try {
                await whatsappOtpService.sendOtp({ phoneNumber: normalizedPhone, otp, verificationId });
            } catch (deliveryError) {
                await challenges.discard(verificationId);
                await challenges.releaseCooldown(normalizedPhone);
                return res.status(502).json({
                    success: false,
                    code: 'WHATSAPP_OTP_DELIVERY_FAILED',
                    error: 'Não foi possível enviar o código pelo WhatsApp.'
                });
            }
        } else {
            // Non-production simulation only; the code is never logged.
            logger.info(`[CUSTOM OTP] Simulated OTP generated for ${normalizedPhone}`);
        }

        return res.json({
            success: true,
            verificationId,
            otpBypassEnabled: false,
            channel: whatsappReady ? 'whatsapp' : 'simulation',
            expiresIn,
            message: whatsappReady ? 'OTP sent via WhatsApp' : 'OTP sent successfully (Simulated)'
        });
    } catch (error) {
        if (error?.status && error?.code) return respondOtpError(res, error);
        logger.error('Error requesting OTP:', error);
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

        if (isProductionRuntime() && !bypassAllowedForRequest && !isWhatsAppOtpReady()) {
            logger.error('[CUSTOM OTP] Production verification blocked: no real OTP delivery provider is configured');
            return respondOtpProviderNotConfigured(res);
        }

        if (bypassAttempt && testOtpBypassEnabled) {
            logger.info(`[CUSTOM OTP] Accepted static test bypass code for ${phone}`);
        } else if (bypassAttempt && appReviewOtpBypassEnabled) {
            logger.info(`[CUSTOM OTP] Accepted static review bypass code for ${phone}`);
        } else {
            // A disallowed bypass code is just a wrong code: it counts as an attempt.
            await getChallengeService().verify({ verificationId, phone: normalizedPhone, otp });
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
                await initializeNewReadModels(newUser);
                uid = newUser.uid;
            } else {
                throw authError; // bubble up
            }
        }

        await ensureRealtimeProfileForOtpUser({ uid, normalizedPhone });
        const customToken = await admin.auth().createCustomToken(uid);

        res.json({ success: true, customToken });
    } catch (error) {
        if (error?.status && error?.code) return respondOtpError(res, error);
        logger.error('Error verifying OTP:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
