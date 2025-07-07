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

module.exports = config;