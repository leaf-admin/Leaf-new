// The unit setup mocks express globally; this worker needs the real one.
jest.unmock('express');
jest.mock('../../../firebase-config', () => ({ initializeFirebase: jest.fn() }));
jest.mock('../../../routes/ocr-routes', () => {
  const express = require('express');
  const router = express.Router();
  router.get('/health', (req, res) => res.json({ ocrRouter: true, ip: req.ip }));
  return router;
});

const http = require('http');
const { createOcrApp } = require('../../../workers/ocr-http-worker');

function request(app, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      http.get({ host: '127.0.0.1', port, path, headers }, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          server.close();
          resolve({ status: res.statusCode, body: JSON.parse(body) });
        });
      }).on('error', (error) => { server.close(); reject(error); });
    });
  });
}

describe('ocr-http-worker', () => {
  it('answers its own health check', async () => {
    const res = await request(createOcrApp(), '/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'healthy', service: 'ocr-worker' });
  });

  it('mounts the OCR router under /api/ocr and trusts the proxy for client IPs', async () => {
    const res = await request(createOcrApp(), '/api/ocr/health', { 'X-Forwarded-For': '203.0.113.7' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ocrRouter: true, ip: '203.0.113.7' });
  });

  it('does not expose anything else', async () => {
    const res = await request(createOcrApp(), '/api/rides');
    expect(res.status).toBe(404);
  });
});
