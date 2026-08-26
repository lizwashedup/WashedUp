/**
 * Landing for washedup.app URLs the app claims but has no screen for
 * (S-05 fix, 2026-08-25 -- see app/+native-intent.tsx). Opens the original
 * URL in an in-app browser: universal links do NOT re-trigger inside
 * SFSafariViewController / a Chrome Custom Tab, so the web page actually
 * renders instead of bouncing back into the app forever.
 *
 * Only our own domain is ever opened -- the url param is attacker-reachable
 * via a crafted washedupapp://web-fallback?url=... deep link, so anything
 * off-domain is ignored and the person just lands on Plans.
 */

import { useEffect, useRef } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import Colors from '../constants/Colors';

const OWN_URL = /^https:\/\/(www\.)?washedup\.app([/?#]|$)/i;

export default function WebFallback() {
  const { url } = useLocalSearchParams<{ url: string }>();
  const opened = useRef(false);

  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    (async () => {
      let target = typeof url === 'string' ? url : '';
      // expo-router decodes params once; tolerate a still-encoded value.
      if (target && !OWN_URL.test(target)) {
        try { target = decodeURIComponent(target); } catch { /* keep as-is */ }
      }
      if (target && OWN_URL.test(target)) {
        try {
          await WebBrowser.openBrowserAsync(target);
        } catch {
          /* browser unavailable: just land on Plans below */
        }
      }
      router.replace('/(tabs)/plans' as never);
    })();
  }, [url]);

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.parchment }}>
      <ActivityIndicator size="large" color={Colors.terracotta} />
    </View>
  );
}
