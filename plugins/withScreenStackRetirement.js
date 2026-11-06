const { withDangerousMod } = require('expo/config-plugins');
const { applyScreenStackRetirement } = require('../scripts/native/screen-stack-retirement.cjs');

// Native prebuild only. Loading Expo config for an OTA never mutates dependencies.
module.exports = function withScreenStackRetirement(config) {
  return withDangerousMod(config, ['ios', async mod => {
    applyScreenStackRetirement(mod.modRequest.projectRoot);
    return mod;
  }]);
};
