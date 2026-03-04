const express = require('express');
const admin = require('firebase-admin');
const redisPool = require('../utils/redis-pool');
const { logger } = require('../utils/logger');

const router = express.Router();

// Generate and send OTP
router.post('/request-otp', async (req, res) => {
    try {
        const { phone } = req.body;
        if (!phone) return res.status(400).json({ error: 'Phone number required' });

        // Generate 6 digit OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const verificationId = `vid_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Save to Redis (expires in 5 minutes)
        try {
            const redisClient = redisPool.getConnection();
            await redisClient.set(`otp:${verificationId}:${phone}`, otp, 'EX', 300);
        } catch (redisError) {
            logger.error('Redis error storing OTP, falling back to mock response', redisError);
            // In a real scenario we'd want memory fallback, but for now we throw
            throw redisError;
        }

        logger.info(`[CUSTOM OTP] OTP for ${phone} is ${otp}`); // For debugging / demonstration without sending SMS

        // TODO: Integrate WhatsApp API (e.g. Meta Cloud API, Z-API) or Nodemailer here
        // Example: await sendWhatsAppOTP(phone, otp);

        res.json({ success: true, verificationId, message: 'OTP sent successfully (Simulated)' });
    } catch (error) {
        logger.error('Error requesting OTP:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Verify OTP
router.post('/verify-otp', async (req, res) => {
    try {
        const { phone, verificationId, otp } = req.body;
        if (!phone || !verificationId || !otp) {
            return res.status(400).json({ error: 'Missing parameters' });
        }

        // Test credentials for Review/App stores
        if (otp === '000000') {
            logger.info(`[CUSTOM OTP] Accepted static bypass code for ${phone}`);
        } else {
            const redisClient = redisPool.getConnection();
            const key = `otp:${verificationId}:${phone}`;
            const storedOtp = await redisClient.get(key);

            if (!storedOtp || storedOtp !== otp) {
                return res.status(400).json({ error: 'Invalid or expired OTP' });
            }

            // OTP is valid, mark as used
            await redisClient.del(key);
        }

        // Generate Firebase Custom Token
        let uid;
        try {
            const normalizedPhone = phone.startsWith('+') ? phone : `+${phone}`;
            const userRecord = await admin.auth().getUserByPhoneNumber(normalizedPhone);
            uid = userRecord.uid;
        } catch (authError) {
            if (authError.code === 'auth/user-not-found') {
                // If it doesn't exist, create it
                const normalizedPhone = phone.startsWith('+') ? phone : `+${phone}`;
                const newUser = await admin.auth().createUser({ phoneNumber: normalizedPhone });
                uid = newUser.uid;
            } else {
                throw authError; // bubble up
            }
        }

        const customToken = await admin.auth().createCustomToken(uid);

        res.json({ success: true, customToken });
    } catch (error) {
        logger.error('Error verifying OTP:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
