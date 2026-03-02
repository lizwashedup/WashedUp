/**
 * Expo app config. Reads GOOGLE_MAPS_API_KEY from environment.
 * For local dev: set in .env.local (gitignored).
 * For EAS builds: set GOOGLE_MAPS_API_KEY in EAS Secrets before production build.
 */
const appJson = require('./app.json');

const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY || '';

module.exports = {
  ...appJson,
  expo: {
    ...appJson.expo,
    ios: {
      ...appJson.expo.ios,
      config: {
        ...appJson.expo.ios?.config,
        googleMapsApiKey,
      },
    },
    android: {
      ...appJson.expo.android,
      config: {
        ...appJson.expo.android?.config,
        googleMaps: {
          ...appJson.expo.android?.config?.googleMaps,
          apiKey: googleMapsApiKey,
        },
      },
    },
  },
};
