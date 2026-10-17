const { withDangerousMod } = require("expo/config-plugins");
const { copyFileSync, existsSync, mkdirSync } = require("node:fs");
const { resolve } = require("node:path");

module.exports = function withOrderSound(config) {
  return withDangerousMod(config, ["android", config => {
    const projectRoot = config.modRequest.projectRoot;
    const source = resolve(projectRoot, "../../sound-native-android.mp3");
    const rawDir = resolve(projectRoot, "android/app/src/main/res/raw");
    if (!existsSync(source)) throw new Error("Approved admin order sound is missing from repository root.");
    mkdirSync(rawDir, { recursive: true });
    copyFileSync(source, resolve(rawDir, "new_order_alert.mp3"));
    return config;
  }]);
};
