const path = require('node:path');
const { getSentryExpoConfig } = require('@sentry/react-native/metro');
const { withNativeWind } = require('nativewind/metro');
const config = getSentryExpoConfig(__dirname);
const reviewConfig = withNativeWind(config, { input: './global.css' });
// Metro must include the real target when this private source uses shared,
// already-installed dependencies outside its source directory.
const dependencyPath = path.join(__dirname, 'node_modules');
const dependencyRealPath = require('node:fs').realpathSync(dependencyPath);
reviewConfig.watchFolders = [...new Set([...(reviewConfig.watchFolders || []), dependencyRealPath])];
reviewConfig.resolver.nodeModulesPaths = [...new Set([dependencyPath, ...(reviewConfig.resolver.nodeModulesPaths || [])])];
// Isolate review transforms from earlier compilation-only exports and held harnesses.
// Environment substitutions must invalidate even when the source file is unchanged.
const crypto = require('node:crypto');
const { FileStore } = require('metro-cache');
const fingerprint = crypto.createHash('sha256').update(__dirname).update(JSON.stringify(
  Object.entries(process.env).filter(([key]) => key.startsWith('EXPO_PUBLIC_')).sort()
)).digest('hex');
reviewConfig.cacheVersion = `private-iphone-review-v2-${fingerprint}`;
reviewConfig.cacheStores = [new FileStore({ root: path.join(require('node:os').tmpdir(), `washedup-private-review-metro-v2-${fingerprint}`) })];
module.exports = reviewConfig;
