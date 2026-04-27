const {
  parseEnvList,
  resolveRuntimeCorsHosts,
  buildRuntimeSslipOrigins,
  buildRuntimeDirectOrigins,
  buildRuntimeOriginRegexes
} = require('./runtime-cors-origins');

function getDefaultOfficialOrigins() {
  return [
    'https://leaf.app.br',
    'https://www.leaf.app.br',
    'https://dashboard.leaf.app.br',
    'https://api.leaf.app.br',
    'https://socket.leaf.app.br'
  ];
}

function getDefaultLocalDevOrigins() {
  return [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:3002',
    'http://localhost:3020',
    'http://localhost:8081',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
    'http://127.0.0.1:3020',
    'http://127.0.0.1:8081',
    'http://192.168.0.33:8081',
    'http://192.168.0.33:3000',
    'http://192.168.0.33:3001',
    'capacitor://localhost',
    'ionic://localhost',
    'react-native://',
    'file://'
  ];
}

function buildRuntimeCorsConfig(options = {}) {
  const {
    env = process.env,
    productionOrigins = getDefaultOfficialOrigins(),
    localDevOrigins = getDefaultLocalDevOrigins(),
    logger = null,
    serviceName = 'server'
  } = options;

  const isProductionRuntime = env.NODE_ENV === 'production';
  const allowLocalCors = String(
    env.ALLOW_LOCAL_CORS || (!isProductionRuntime)
  ).toLowerCase() === 'true';
  const allowPrivateCors = String(
    env.ALLOW_PRIVATE_CORS || (!isProductionRuntime)
  ).toLowerCase() === 'true';
  const allowNgrokCors = String(
    env.ALLOW_NGROK_CORS || (!isProductionRuntime)
  ).toLowerCase() === 'true';

  const runtimeCorsHosts = resolveRuntimeCorsHosts({
    env,
    defaultHosts: ['62.169.31.231'],
    allowLegacyFlagName: 'ALLOW_LEGACY_VULTR_CORS',
    legacyHost: '147.182.204.181'
  });

  const {
    runtimeDirectOriginRegex,
    runtimeSslipOriginRegex
  } = buildRuntimeOriginRegexes(runtimeCorsHosts);

  const normalizedProductionOrigins = [
    ...productionOrigins,
    ...buildRuntimeSslipOrigins(runtimeCorsHosts),
    ...buildRuntimeDirectOrigins(runtimeCorsHosts, { port: 3001 })
  ];

  const baseAllowedOrigins = allowLocalCors
    ? [...normalizedProductionOrigins, ...localDevOrigins]
    : normalizedProductionOrigins;
  const envAllowedOrigins = parseEnvList(env.CORS_ORIGIN);
  const allowedOrigins = Array.from(new Set([...baseAllowedOrigins, ...envAllowedOrigins]));

  const corsOptions = {
    origin: (origin, callback) => {
      const isVpcDirectOrigin = Boolean(runtimeDirectOriginRegex && runtimeDirectOriginRegex.test(origin || ''));
      const isSslipOrigin = Boolean(runtimeSslipOriginRegex && runtimeSslipOriginRegex.test(origin || ''));
      const isLoopbackOrigin = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin || '');
      const isPrivateNetworkOrigin = /^http:\/\/(192\.168\.|10\.)/.test(origin || '');
      const isNgrokOrigin = /ngrok-free\.app$/i.test(origin || '');
      const isExpoOrigin = (origin || '').startsWith('exp://') || (origin || '').includes('.expo.dev');
      const isNativeAppOrigin = origin === 'file://' || origin === 'react-native://';

      if (
        !origin ||
        isNativeAppOrigin ||
        allowedOrigins.includes(origin) ||
        isVpcDirectOrigin ||
        isSslipOrigin ||
        (allowLocalCors && isLoopbackOrigin) ||
        (allowNgrokCors && isNgrokOrigin) ||
        (allowPrivateCors && isPrivateNetworkOrigin) ||
        (allowLocalCors && isExpoOrigin)
      ) {
        callback(null, true);
      } else {
        if (logger && typeof logger === 'function') {
          logger('warn', `CORS bloqueado: ${origin}`, { service: serviceName, origin });
        }
        callback(new Error('Não permitido pelo CORS'));
      }
    },
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
  };

  return {
    corsOptions,
    allowedOrigins,
    runtimeCorsHosts,
    flags: {
      isProductionRuntime,
      allowLocalCors,
      allowPrivateCors,
      allowNgrokCors
    }
  };
}

module.exports = {
  getDefaultOfficialOrigins,
  getDefaultLocalDevOrigins,
  buildRuntimeCorsConfig
};
