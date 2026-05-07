import { Linking } from 'react-native';

export async function openDeepLinkWithFallback(
  nativeUrl: string,
  webUrl: string,
): Promise<void> {
  try {
    await Linking.openURL(nativeUrl);
  } catch {
    try {
      await Linking.openURL(webUrl);
    } catch {
      // both failed; swallow so the caller doesn't crash
    }
  }
}
