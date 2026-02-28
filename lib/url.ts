import { Linking } from 'react-native';

/**
 * Ensures URL has a protocol before opening.
 * Linking.openURL fails when given "www.example.com" without https://
 */
export function openUrl(url: string): void {
  const trimmed = url.trim();
  if (!trimmed) return;
  const withProtocol =
    trimmed.startsWith('http://') || trimmed.startsWith('https://')
      ? trimmed
      : `https://${trimmed}`;
  Linking.openURL(withProtocol).catch(() => {});
}
