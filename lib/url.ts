import { Alert, Linking } from 'react-native';
import { router } from 'expo-router';

/**
 * A link to our OWN domain must be routed in app, never handed to the OS.
 *
 * app.json claims washedup.app on both platforms (iOS associatedDomains
 * "applinks:washedup.app", Android intentFilters with autoVerify on /e/,
 * /plans/ and /r/). So when a link like https://washedup.app/e/<id> is tapped
 * INSIDE the app and we call Linking.openURL, the OS looks up the verified
 * handler for that URL, finds this very app, and hands the URL straight back
 * to the app that is already open. Nothing navigates and the tap reads as
 * dead, which is what a plan link pasted into a chat did (report 8-02).
 *
 * Routing here takes the OS out of the path, so the tap behaves the same on
 * both platforms and the person stays in the app instead of bouncing out to a
 * browser to read a page the app already renders.
 */
const OWN_LINK = /^https?:\/\/(?:www\.)?washedup\.app(\/[^?#\s]*)?(?:\?([^#\s]*))?/i;

/**
 * Only paths with a real native route may be routed in app: app/e/[id].tsx
 * (the short link landing, which itself disambiguates plan from event),
 * app/plans/[slug].tsx, app/r/[code].tsx (referral landing, S-05 fix
 * 2026-08-25 -- handing /r/ to the OS was a DEAD TAP on iOS, because the OS
 * looks up the verified handler for washedup.app and hands the URL straight
 * back to this already-open app), and app/t/[code].tsx (ticket-transfer
 * claim landing, item 15, 2026-09-04 -- same dead-tap risk as /r/ for any
 * transfer link opened from inside the app, e.g. pasted into a chat).
 * Anything else on the domain still goes to the browser because there is no
 * screen to land on.
 */
const OWN_ROUTE = /^\/(e|plans|r|t)\/([^/?#]+)\/?$/;

/**
 * An id or slug never legitimately ends in sentence punctuation, but the chat
 * linkifier captures every non space character, so a link written mid sentence
 * ("it is here: https://washedup.app/e/<id>.") arrives with the period stuck
 * to it and would otherwise resolve to nothing.
 */
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/;

/**
 * The in app route for one of our own links, or null when it is not ours.
 * The query string rides along (S-05 deep-link contract: params like task /
 * return_route / filter must survive the handoff; they used to be silently
 * dropped here, fixed 2026-08-25). The #fragment stays dropped: it is a web
 * scroll anchor with no native meaning.
 */
export function internalRouteFor(url: string): string | null {
  const own = url.match(OWN_LINK);
  if (!own) return null;
  const route = (own[1] ?? '').match(OWN_ROUTE);
  if (!route) return null;
  // Sentence punctuation clings to whatever the link ends with: the query
  // when one is present, the id/slug otherwise.
  let search = own[2] ?? '';
  let raw = route[2];
  if (search) search = search.replace(TRAILING_PUNCTUATION, '');
  else raw = raw.replace(TRAILING_PUNCTUATION, '');
  if (!raw) return null;
  let segment = raw;
  try {
    segment = decodeURIComponent(raw);
  } catch {
    // A malformed percent escape stays as written: the landing screen says
    // "this one is gone" for itself rather than us throwing on the way there.
  }
  return `/${route[1]}/${segment}${search ? `?${search}` : ''}`;
}

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

  const internal = internalRouteFor(withProtocol);
  if (internal) {
    router.push(internal as never);
    return;
  }

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

/**
 * The ONE link in a piece of text, or null when it holds none or several.
 *
 * A chat bubble renders its link as a `<Text onPress>` nested inside the
 * bubble's long press `Pressable`. A nested text press is the fragile kind of
 * touch target: on Android an ancestor holding the responder can swallow it,
 * which is the shape of the 8-02 report that a shared plan link did nothing
 * when tapped. When a message carries exactly one link, the bubble itself can
 * therefore act as the tap target too, which no ancestor can intercept.
 * Restricted to exactly one link so a bubble is never ambiguous about which
 * one it would open.
 */
export function soleUrlIn(text: string | null | undefined): string | null {
  if (!text) return null;
  const urls = splitOnUrls(text).filter((part) => part.isUrl);
  return urls.length === 1 ? urls[0].text : null;
}

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
