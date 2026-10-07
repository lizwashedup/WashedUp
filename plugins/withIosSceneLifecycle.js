const fs = require('fs');
const path = require('path');
const { withAppDelegate, withInfoPlist } = require('expo/config-plugins');

const marker = '// @generated WashedUp single-scene lifecycle';
const legacyStartup = `#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif`;

function migrateAppDelegate(source) {
  const scene = fs.readFileSync(path.join(__dirname, 'ios/WashedUpSceneDelegate.swift'), 'utf8');
  if (source.includes(marker)) {
    if (source.split(marker).length !== 2 || !source.endsWith(marker + '\n' + scene)
        || source.includes(legacyStartup)
        || source.split('    sceneLaunchOptions = launchOptions').length !== 2
        || source.split('  var sceneLaunchOptions: [UIApplication.LaunchOptionsKey: Any]?').length !== 2) {
      throw new Error('Previously generated scene lifecycle has drifted');
    }
    return source;
  }
  for (const anchor of [legacyStartup, '  var window: UIWindow?', '    bindReactNativeFactory(factory)']) {
    if (source.split(anchor).length !== 2) throw new Error('Unsupported AppDelegate shape for scene migration');
  }
  return source
    .replace('  var window: UIWindow?', '  var window: UIWindow?\n  var sceneLaunchOptions: [UIApplication.LaunchOptionsKey: Any]?')
    .replace(legacyStartup, '    sceneLaunchOptions = launchOptions')
    + '\n' + marker + '\n' + scene;
}

function sceneManifest(existing) {
  const intended = {
    UIApplicationSupportsMultipleScenes: false,
    UISceneConfigurations: {
      UIWindowSceneSessionRoleApplication: [{
        UISceneConfigurationName: 'Default Configuration',
        UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).WashedUpSceneDelegate',
      }],
    },
  };
  if (existing && JSON.stringify(existing) !== JSON.stringify(intended)) {
    throw new Error('Refusing to replace an unexpected existing scene configuration');
  }
  return intended;
}

function withIosSceneLifecycle(config) {
  config = withInfoPlist(config, mod => {
    mod.modResults.UIApplicationSceneManifest = sceneManifest(mod.modResults.UIApplicationSceneManifest);
    return mod;
  });
  return withAppDelegate(config, mod => {
    if (mod.modResults.language !== 'swift') throw new Error('Scene lifecycle requires the Swift Expo AppDelegate');
    mod.modResults.contents = migrateAppDelegate(mod.modResults.contents);
    return mod;
  });
}
module.exports = withIosSceneLifecycle;
module.exports.migrateAppDelegate = migrateAppDelegate;
module.exports.sceneManifest = sceneManifest;
