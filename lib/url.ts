import { Alert, Linking } from 'react-native';

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
  Linking.openURL(withProtocol).catch(() => {
    Alert.alert('Could not open link', 'The link may be invalid or unsupported on this device.');
  });
}

/**
 * Source pattern for detecting links in free text: http(s):// URLs and bare
 * www. domains. Build fresh RegExp instances from this in functions so the
 * global `lastIndex` is never shared/stateful across calls.
 */
export const URL_REGEX = /(https?:\/\/[^\s]+|www\.[^\s]+)/;

/** First URL found in the text, or null. Used to lift a pasted link out of a description. */
export function extractFirstUrl(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = text.match(new RegExp(URL_REGEX.source, 'i'));
  return m ? m[0] : null;
}

/**
 * Split text into ordered segments, marking which are URLs, so a renderer can
 * make links tappable instead of showing a wall of raw URL.
 */
export function splitOnUrls(text: string): Array<{ text: string; isUrl: boolean }> {
  if (!text) return [];
  const re = new RegExp(URL_REGEX.source, 'gi');
  const parts: Array<{ text: string; isUrl: boolean }> = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push({ text: text.slice(lastIndex, match.index), isUrl: false });
    parts.push({ text: match[0], isUrl: true });
    lastIndex = match.index + match[0].length;
    if (re.lastIndex === match.index) re.lastIndex++; // guard against zero-width matches
  }
  if (lastIndex < text.length) parts.push({ text: text.slice(lastIndex), isUrl: false });
  return parts;
}
