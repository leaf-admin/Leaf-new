const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Configurar resolução automática de extensões
config.resolver.platforms = ['ios', 'android', 'native', 'web'];
config.resolver.sourceExts = ['js', 'jsx', 'ts', 'tsx', 'json'];
config.resolver.assetExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ttf', 'woff', 'woff2'];

// Configurar resolução de módulos
config.resolver.resolverMainFields = ['react-native', 'browser', 'main'];

// Configurar aliases para facilitar imports
config.resolver.alias = {
  '@': __dirname + '/src',
  '@components': __dirname + '/src/components',
  '@screens': __dirname + '/src/screens',
  '@services': __dirname + '/src/services',
  '@utils': __dirname + '/src/utils',
  '@config': __dirname + '/src/config',
  '@common': __dirname + '/common',
  '@json': path.join(__dirname, '..', 'json'),
};

// Configurar resolução de módulos adicionais
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, 'node_modules'),
  path.resolve(__dirname, '..', 'node_modules'),
];

// Resolver apenas os problemas essenciais do Firebase
config.resolver.alias = {
  ...config.resolver.alias,
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

module.exports = config;