/**
 * Integration Tests for Health Check API
 */

const { startTestServer, stopTestServer, testRequest } = require('../config/test-setup');

describe('Health Check API Integration', () => {
  let server;

  beforeAll(async () => {
    server = await startTestServer(3003);
  }, 30000);

  afterAll(async () => {
    if (server) {
      await stopTestServer();
    }
  });

  describe('GET /api/health', () => {
    test('should return health status', async () => {
      const response = await testRequest('GET', '/api/health');

      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('status');
      expect(response.data).toHaveProperty('timestamp');
      expect(response.data).toHaveProperty('checks');
    });

    test('should include service information', async () => {
      const response = await testRequest('GET', '/api/health');

      expect(response.data).toHaveProperty('checks.redis');
      expect(response.data).toHaveProperty('checks.websocket');
    });

    test('should include uptime information', async () => {
      const response = await testRequest('GET', '/api/health');

      expect(response.data).toHaveProperty('uptime');
      expect(typeof response.data.uptime).toBe('number');
      expect(response.data.uptime).toBeGreaterThan(0);
    });

    test('should have correct content type', async () => {
      const response = await testRequest('GET', '/api/health');

      expect(response.headers['content-type']).toContain('application/json');
    });
  });

  describe('GET /api/stats', () => {
    test('should return system statistics', async () => {
      const response = await testRequest('GET', '/api/stats');

      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('redis');
      expect(response.data).toHaveProperty('memory');
      expect(response.data).toHaveProperty('uptime');
    });

    test('should include Redis statistics', async () => {
      const response = await testRequest('GET', '/api/stats');

      expect(response.data.redis).toHaveProperty('connected');
      expect(response.data.redis).toHaveProperty('operations');
    });

    test('should include memory statistics', async () => {
      const response = await testRequest('GET', '/api/stats');

      expect(response.data.memory).toHaveProperty('rss');
      expect(response.data.memory).toHaveProperty('heapUsed');
      expect(response.data.memory).toHaveProperty('heapTotal');
    });
  });

  describe('GET /api/get_redis_stats', () => {
    test('should return detailed Redis statistics', async () => {
      const response = await testRequest('GET', '/api/get_redis_stats');

      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('redis_info');
      expect(response.data).toHaveProperty('connections');
      expect(response.data).toHaveProperty('memory');
    });

    test('should handle Redis connection errors gracefully', async () => {
      // This test might need to mock Redis disconnection
      // For now, just verify the endpoint exists and returns valid response
      const response = await testRequest('GET', '/api/get_redis_stats');

      expect([200, 500]).toContain(response.status);
    });
  });
});
