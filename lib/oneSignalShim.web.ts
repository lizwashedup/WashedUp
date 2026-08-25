// Web placeholder for lib/oneSignalShim.ts. Every real call site in
// hooks/usePushNotifications.ts and app/_layout.tsx already gates on
// Platform.OS === 'web' / ensureOneSignalReady() before touching these, so
// these stubs never actually run — they exist only so Metro's web bundle
// never has to resolve the real native package.
export const OneSignal = {
  initialize: () => {},
  login: () => {},
  User: {
    pushSubscription: {
      getIdAsync: async () => null,
      addEventListener: () => {},
      removeEventListener: () => {},
    },
  },
  Notifications: {
    permissionNative: async () => null,
    hasPermission: () => false,
    requestPermission: async () => false,
    addEventListener: () => {},
    removeEventListener: () => {},
  },
};

export const OSNotificationPermission = {
  Authorized: 'authorized',
  Provisional: 'provisional',
  Ephemeral: 'ephemeral',
  Denied: 'denied',
};
