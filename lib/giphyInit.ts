import { GiphySDK } from '@giphy/react-native-sdk';

// Configure the Giphy SDK once at app boot so the chat MediaPanel's first open
// isn't paying for SDK init (which made the smile button feel laggy on Android).
// Idempotent; no-op when the key is absent — MediaPanel shows fallback copy.
// Split out of app/_layout.tsx with a .web.ts stub sibling so Metro's web
// bundle never has to resolve @giphy/react-native-sdk (native-only, imports
// react-native's codegenNativeComponent internals — cannot bundle for web).
export function initGiphySDK() {
  if (process.env.EXPO_PUBLIC_GIPHY_SDK_KEY) {
    try { GiphySDK.configure({ apiKey: process.env.EXPO_PUBLIC_GIPHY_SDK_KEY }); }
    catch { /* leave unconfigured; MediaPanel falls back gracefully */ }
  }
}
