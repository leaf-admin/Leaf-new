const express = require('express');
const admin = require('firebase-admin');
const redisPool = require('../utils/redis-pool');
const { logger } = require('../utils/logger');
const firebaseConfig = require('../firebase-config');
const { getBypassOtpCode, isOtpBypassPhone, isReviewOtpBypassEnabled } = require('../utils/test-auth-bypass');

const router = express.Router();
const OTP_TTL_SECONDS = 300;

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
        const otp = otpBypassEnabled
            ? getBypassOtpCode(normalizedPhone)
            : Math.floor(100000 + Math.random() * 900000).toString();
        const verificationId = `vid_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        let customToken = null;
        const otpRedisKeys = buildOtpRedisKeys({
            verificationId,
            originalPhone: rawPhone,
            normalizedPhone
        });

        if (!otpBypassEnabled) {
            // Save to Redis (expires in 5 minutes)
            try {
                const redisClient = redisPool.getConnection();
                await Promise.all(
                    otpRedisKeys.map((key) => redisClient.set(key, otp, 'EX', OTP_TTL_SECONDS))
                );
            } catch (redisError) {
                logger.error('Redis error storing OTP, falling back to mock response', redisError);
                // In a real scenario we'd want memory fallback, but for now we throw
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
        } else if (process.env.NODE_ENV !== 'production' || process.env.DEBUG_OTP === 'true') {
            logger.info(`[CUSTOM OTP] OTP generated for ${normalizedPhone}`); // Do not print OTP value in production logs.
        }

        // TODO: Integrate WhatsApp API (e.g. Meta Cloud API, Z-API) or Nodemailer here
        // Example: await sendWhatsAppOTP(phone, otp);

        res.json({
            success: true,
            verificationId,
            otpBypassEnabled,
            ...(customToken ? { customToken } : {}),
            message: otpBypassEnabled
                ? 'OTP bypass enabled for test account'
                : 'OTP sent successfully (Simulated)'
        });
    } catch (error) {
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

        if (bypassAttempt && testOtpBypassEnabled) {
            logger.info(`[CUSTOM OTP] Accepted static test bypass code for ${phone}`);
        } else if (bypassAttempt && appReviewOtpBypassEnabled) {
            logger.info(`[CUSTOM OTP] Accepted static review bypass code for ${phone}`);
        } else if (bypassAttempt) {
            return res.status(400).json({ error: 'Invalid or expired OTP' });
        } else {
            const redisClient = redisPool.getConnection();
            const otpRedisKeys = buildOtpRedisKeys({
                verificationId,
                originalPhone: rawPhone,
                normalizedPhone
            });
            let hasValidOtp = false;

            for (const key of otpRedisKeys) {
                const storedOtp = await redisClient.get(key);
                if (storedOtp && String(storedOtp) === String(otp)) {
                    hasValidOtp = true;
                    break;
                }
            }

            if (!hasValidOtp) {
                return res.status(400).json({ error: 'Invalid or expired OTP' });
            }

            // OTP is valid, mark as used
            if (otpRedisKeys.length > 0) {
                await redisClient.del(...otpRedisKeys);
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
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
