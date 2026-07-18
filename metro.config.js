// Metro config — extends Expo's defaults so the MoveNet pose-detection model
// (assets/movenet.tflite) can be require()'d as a bundled asset by
// PoseCameraLive.jsx. Without this, any bundle that touches the model fails.
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push("tflite");

module.exports = config;
