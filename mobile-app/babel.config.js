module.exports = function(api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // Removido react-native-reanimated/plugin para evitar conflitos
    ],
  };
};
