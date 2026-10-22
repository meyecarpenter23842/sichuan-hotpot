const { withDangerousMod } = require("expo/config-plugins");
const { copyFileSync, existsSync, mkdirSync } = require("node:fs");
const { resolve } = require("node:path");

module.exports = function withRetailQrSound(config) {
  return withDangerousMod(config, ["android", config => {
    const appRoot = config.modRequest.projectRoot;
    const audio = resolve(appRoot, "../../sound-native-android.mp3");
    const target = resolve(appRoot, "android/app/src/main/res/raw");
    if (!existsSync(audio)) throw new Error("Approved Retail QR sound is missing.");
    mkdirSync(target, { recursive: true });
    copyFileSync(audio, resolve(target, "new_order_alert.mp3"));
    return config;
  }]);
};
