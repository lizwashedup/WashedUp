import React, { useLayoutEffect, useMemo, useRef } from 'react';
import { ScrollView, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Colors, { AfterglowColors } from '../../../constants/Colors';
import { Fonts, FontSizes, AfterglowType } from '../../../constants/Typography';
import { YOURS_PAGE_ENABLED, COMMUNITY_CHAT_GROUPING_ENABLED } from '../../../constants/FeatureFlags';
import { useObservedUser } from '../../../hooks/useObservedUser';
import { useAfterglowFonts } from '../../../hooks/useAfterglowFonts';
import { ScaledText as Text } from '../../ScaledText';
import type { AfterglowFontFamilies } from '../../../constants/Typography';

/** Account gate shared by individual profiles and relationship history.
 * Completed identities are never read from a permanent query-cache entry. */
export default function PeopleRouteAccountGate({ id, children }: {
  id: unknown;
  children: (props: { userId: string; targetId: string; appearance?: { fonts: AfterglowFontFamilies } }) => React.ReactNode;
}) {
  const viewer = useObservedUser();
  const { fonts } = useAfterglowFonts(COMMUNITY_CHAT_GROUPING_ENABLED);
  const appearance = useMemo(() => COMMUNITY_CHAT_GROUPING_ENABLED ? { fonts } : undefined, [fonts]);
  const focused = useIsFocused();
  const entry = useMemo(() => ({ focused, retired: false }), [id, viewer.viewerId, viewer.epoch, focused]);
  const current = useRef(entry); current.current = entry;
  const mounted = useRef(false);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const ready = () => mounted.current && current.current === entry && entry.focused && !entry.retired;
  const retryLock = useRef<object | null>(null);
  const retry = async () => {
    if (!ready() || retryLock.current === entry) return;
    retryLock.current = entry;
    try { await viewer.retry(); } finally { if (retryLock.current === entry) retryLock.current = null; }
  };
  const styled = appearance ? {
    ...styles,
    container: { ...styles.container, backgroundColor: AfterglowColors.paper },
    text: { ...styles.text, ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.muted },
    actionText: { ...AfterglowType.body, fontFamily: fonts.semibold, color: AfterglowColors.clay },
  } : styles;

  if (!YOURS_PAGE_ENABLED) return <Redirect href="/(tabs)/friends" />;
  if (!viewer.isLoading && !viewer.error && viewer.viewerId && typeof id === 'string' && id.trim()) {
    return <>{children({ userId: viewer.viewerId, targetId: id, appearance })}</>;
  }
  return <SafeAreaView style={styled.container} edges={['top']}>
    <Pressable style={styled.back} accessibilityRole="button" accessibilityLabel="Back" onPress={() => { if (ready()) { entry.retired = true; if (router.canGoBack()) router.back(); else router.replace('/(tabs)/friends'); } }}><Text style={styled.actionText}>Back</Text></Pressable>
    <ScrollView contentContainerStyle={styles.center}>
      {viewer.isLoading ? <ActivityIndicator accessibilityLabel="Loading account" color={appearance ? AfterglowColors.clay : Colors.terracotta}/> : viewer.error ? <>
        <Text style={styled.text}>Couldn’t check your account.</Text>
        <Pressable style={styles.retry} accessibilityRole="button" accessibilityLabel="Try again to check account" onPress={() => { void retry(); }}><Text style={styled.actionText}>Try again</Text></Pressable>
      </> : <Text style={styled.text}>This profile isn’t available.</Text>}
    </ScrollView>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.cream, paddingTop: 16 },
  center: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  back: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start', paddingHorizontal: 20 },
  retry: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 20, marginTop: 12 },
  text: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.secondary, textAlign: 'center' },
  actionText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.terracotta },
});
