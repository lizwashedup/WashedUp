// Older installed apps can receive JS updates without the native clipboard module.
export function getClipboardWriter(): typeof import('expo-clipboard').setStringAsync | null {
  try {
    return (require('expo-clipboard') as typeof import('expo-clipboard')).setStringAsync ?? null;
  } catch {
    return null;
  }
}
