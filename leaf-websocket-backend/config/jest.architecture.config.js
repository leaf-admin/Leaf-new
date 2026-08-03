const unitConfig = require('./jest.unit.config');

module.exports = {
  ...unitConfig,
  testMatch: [
    '<rootDir>/tests/unit/routes/account-routes.unit.test.js',
    '<rootDir>/tests/unit/scripts/start-server-runtime-isolation.unit.test.js',
    '<rootDir>/tests/unit/scripts/validate-runtime-config.unit.test.js',
    '<rootDir>/tests/unit/services/kyc-legacy-boundary.unit.test.js',
    '<rootDir>/tests/unit/services/redis-critical-authority-service.unit.test.js',
    '<rootDir>/tests/unit/services/socket-io-adapter.redis-sentinel.unit.test.js',
    '<rootDir>/tests/unit/services/subscription-online-gate-service.unit.test.js',
    '<rootDir>/tests/unit/services/trip-location-persistence-service.unit.test.js',
    '<rootDir>/tests/unit/utils/docker-detector.redis-sentinel.unit.test.js'
  ],
  collectCoverage: false
};
