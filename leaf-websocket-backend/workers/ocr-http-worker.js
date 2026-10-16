/**
 * Dedicated OCR HTTP worker.
 *
 * Serves the same /api/ocr routes as the gateway (same router, same Firebase
 * user auth and rate limits), so Tesseract and PDF rendering run outside the
 * process that holds the ride sockets. nginx routes /api/ocr/ here; the
 * gateway keeps the routes as a fallback.
 */
const express = require('express');
const firebaseConfig = require('../firebase-config');
const { logStructured, logError } = require('../utils/logger');

const PORT = Number.parseInt(process.env.OCR_WORKER_PORT || process.env.PORT || '3110', 10);
const HOST = process.env.HOST || '0.0.0.0';

function createOcrApp() {
    const app = express();
    app.disable('x-powered-by');
    // One proxy hop (nginx on the realtime host), same as the gateway: client
    // IPs for rate limiting come from X-Forwarded-For.
    app.set('trust proxy', 1);

    app.get('/health', (req, res) => {
        res.json({ status: 'healthy', service: 'ocr-worker', uptimeSeconds: Math.round(process.uptime()) });
    });

    app.use('/api/ocr', require('../routes/ocr-routes'));

    app.use((req, res) => res.status(404).json({ success: false, error: 'Not found' }));
    return app;
}

function start() {
    try {
        firebaseConfig.initializeFirebase();
    } catch (error) {
        // requireFirebaseUser retries initialization on demand.
        logError(error, 'OCR worker: Firebase init failed at boot', { service: 'ocr-worker' });
    }

    const server = createOcrApp().listen(PORT, HOST, () => {
        logStructured('info', 'OCR worker listening', { service: 'ocr-worker', port: PORT, host: HOST });
    });
    // PDFs and Tesseract runs can take a while; nginx enforces the client-facing timeout.
    server.requestTimeout = 180000;
    server.headersTimeout = 65000;

    const shutdown = (signal) => {
        logStructured('info', 'OCR worker stopping', { service: 'ocr-worker', signal });
        server.close(() => process.exit(0));
        setTimeout(() => process.exit(0), 10000).unref();
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}

if (require.main === module) {
    start();
}

module.exports = { createOcrApp };
