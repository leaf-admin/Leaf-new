const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);
const { resolve } = config.resolver;
const axiosBrowserEntry = path.resolve(__dirname, 'node_modules/axios/dist/browser/axios.cjs');

// Usar extensões padrão do Expo + algumas extras necessárias
config.resolver.sourceExts.push('cjs');
config.resolver.assetExts.push('lottie');

// Configurar aliases para facilitar imports
config.resolver.alias = {
  '@': __dirname + '/src',
  '@components': __dirname + '/src/components',
  '@screens': __dirname + '/src/screens',
  '@services': __dirname + '/src/services',
  '@utils': __dirname + '/src/utils',
  '@config': __dirname + '/src/config',
  '@common': __dirname + '/common',
  '@common-local': __dirname + '/src/common-local',
  '@json': path.join(__dirname, '..', 'json'),
  '@common-packages': path.join(__dirname, '..', 'common-packages'),
};

// Configurar resolução de módulos adicionais
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, 'node_modules'),
  path.resolve(__dirname, '..', 'node_modules'),
];

// Resolver apenas os problemas essenciais do Firebase
config.resolver.alias = {
  ...config.resolver.alias,
  // Force browser bundle for React Native runtime (avoid Node-only axios entry)
  'axios': axiosBrowserEntry,
  'idb': false,
  'fs': false,
  'net': false,
  'tls': false,
  'child_process': false,
  'http': false,
  'https': false,
  'zlib': false,
  'domain': false,
  'punycode': false,
  'tty': false,
  'vm': false,
  'worker_threads': false,
  'use-sync-external-store/shim': 'use-sync-external-store/shim/with-selector',
};

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'axios' || moduleName === 'axios/dist/node/axios.cjs') {
    return {
      type: 'sourceFile',
      filePath: axiosBrowserEntry,
    };
  }

  if (resolve) {
    return resolve(context, moduleName, platform);
  }

  return context.resolveRequest(context, moduleName, platform);
};

// Configuração específica para H3
config.resolver.platforms = ['ios', 'android', 'native', 'web'];
config.resolver.sourceExts.push('js', 'jsx', 'ts', 'tsx', 'json');

// Configurar transformações para bibliotecas específicas
config.transformer.minifierConfig = {
  keep_fnames: true,
  mangle: {
    keep_fnames: true,
  },
};

module.exports = config;
