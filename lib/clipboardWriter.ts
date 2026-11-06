import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

export function getClipboardWriter(): typeof import('expo-clipboard').setStringAsync | null {
  // Check the native capability before importing its JS wrapper. Metro can
  // report a fatal module initialization error even inside a require try/catch.
  if (Platform.OS !== 'web' && !requireOptionalNativeModule<{ setStringAsync?: unknown }>('ExpoClipboard')?.setStringAsync) {
    return null;
  }
  return (require('expo-clipboard') as typeof import('expo-clipboard')).setStringAsync;
}
