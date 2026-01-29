const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Exclude node_modules from TypeScript processing
config.resolver.blockList = [
  ...config.resolver.blockList || [],
  /node_modules\/expo-modules-core\/src\/.*/,
];

module.exports = config;
