// Thin re-export so app/_layout.tsx and hooks/usePushNotifications.ts never
// import react-native-onesignal directly — the .web.ts stub sibling keeps
// Metro's web bundle from having to resolve it (native-only; throws at
// import time on web with "Cannot read properties of undefined (reading
// 'getEnforcing')" since there's no native module to bind to).
export { OneSignal, OSNotificationPermission } from 'react-native-onesignal';
