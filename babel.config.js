module.exports = function(api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // Worklets must come before Reanimated
      'react-native-worklets-core/plugin',
      'react-native-reanimated/plugin',
    ],
  };
};
