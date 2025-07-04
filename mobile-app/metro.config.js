const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const workspaceRoot = path.resolve(__dirname, '../');
const projectRoot = __dirname;

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Resolver para módulos do Node.js que o Redis client precisa
config.resolver.alias = {
  ...config.resolver.alias,
  'node:crypto': 'react-native-crypto',
  'node:buffer': 'buffer',
  'node:stream': 'readable-stream',
  'node:util': 'util',
  'node:events': 'events',
  'node:path': 'path-browserify',
  'node:fs': 'react-native-fs',
  'node:os': 'os-browserify',
  'node:url': 'url',
  'node:querystring': 'querystring',
  'node:http': 'react-native-http',
  'node:https': 'react-native-https',
  'node:net': 'react-native-net',
  'node:tls': 'react-native-tls',
  'node:zlib': 'react-native-zlib',
  'node:assert': 'assert',
  'node:constants': 'constants-browserify',
  'node:domain': 'domain-browser',
  'node:punycode': 'punycode',
  'node:string_decoder': 'string_decoder',
  'node:timers': 'timers-browserify',
  'node:tty': 'tty-browserify',
  'node:vm': 'vm-browserify'
};

// Configurações adicionais para resolver problemas de compatibilidade
config.resolver.platforms = ['ios', 'android', 'native', 'web'];

// Ignorar alguns módulos que não são necessários no React Native
config.resolver.blockList = [
  /node_modules\/@redis\/client\/dist\/lib\/lua-script\.js$/,
  /node_modules\/@redis\/client\/dist\/lib\/commands\/.*\.js$/
];

module.exports = config;