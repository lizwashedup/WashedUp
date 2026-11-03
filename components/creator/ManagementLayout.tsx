import React, { useEffect } from 'react';
import { Redirect, Stack, router, useSegments } from 'expo-router';
import { ActivityIndicator, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { useIsFocused } from '@react-navigation/native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import { hasCreatorAccess } from '../../lib/creatorMode';
import { hydrateSelectedCommunity, useLedCommunity } from '../../lib/selectedCommunity';
import { hydrateWorkspace, useWorkspace } from '../../lib/workspaceContext';
import { setViewAsEventHost, useViewAsEventHost } from '../../lib/viewAs';
import { useCreatorAccessRead } from '../../hooks/useCreatorAccessRead';
import { CreatorScreenHeader } from './CreatorScreenHeader';
import { MANAGEMENT_HOME, managementAccess, type ManagementScreen } from '../../lib/managementNavigation';

/** Existing tools, nested inside Yours rather than a second bottom-tab mode. */
export default function ManagementLayout() {
  const queryClient = useQueryClient();
  const focused = useIsFocused();
  const viewingAsEventHost = useViewAsEventHost();
  const { data: access, isLoading, isError, refetch, isFetching } = useCreatorAccessRead();
  const workspace = useWorkspace(access);
  const community = useLedCommunity(access);
  const segments = useSegments();
  const screen = segments[segments.length - 1] as ManagementScreen;
  useEffect(() => { void hydrateSelectedCommunity(); void hydrateWorkspace(); }, []);

  if (isLoading) return <View style={styles.loading}><ActivityIndicator accessibilityLabel="Checking management access" color={Colors.terracotta} /></View>;
  if (isError) return <CreatorAccessErrorScreen retry={() => void refetch()} retrying={isFetching} />;
  if (!hasCreatorAccess(access) && access?.isRevoked) return <RevokedScreen />;
  if (!hasCreatorAccess(access)) return focused ? <Redirect href={MANAGEMENT_HOME} /> : null;
  const permitted = managementAccess(access!, workspace, community);
  // The main tabs keep this stack mounted. A global route change to Plans or
  // a focused editor must never pull the person back into management.
  if (focused && !permitted.screens.includes(screen)) return <Redirect href={permitted.home} />;
  const home = permitted.home.endsWith('/' + screen);
  const identity = workspace === 'community' ? community?.name ?? 'Your community' : 'Your organization';
  const homeTitle = workspace === 'organization' ? 'Manage organization' : community ? `Manage ${community.name}` : 'Manage community';
  return <SafeAreaView style={styles.shell} edges={['top']}>
    {screen !== 'organizer-broadcast' && <CreatorScreenHeader title={home ? homeTitle : identity}
      backLabel={home ? 'Back to everything you manage' : 'Back to managing ' + identity}
      onBack={() => router.navigate((home ? MANAGEMENT_HOME : permitted.home) as never)} />}
    <Stack screenOptions={{ headerShown: false, freezeOnBlur: false }} />
    {viewingAsEventHost && <View style={styles.viewAs}>
      <Text style={styles.viewAsText}>Previewing event creator tools</Text>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="End creator preview" onPress={() => {
        setViewAsEventHost(false); void queryClient.invalidateQueries({ queryKey: ['creator-access'] });
      }}><Text style={styles.done}>Done</Text></TouchableOpacity>
    </View>}
  </SafeAreaView>;
}

function CreatorAccessErrorScreen({ retry, retrying }: { retry: () => void; retrying: boolean }) {
  return (
    <SafeAreaView style={revokedStyles.container} edges={['top', 'bottom']}>
      <View style={revokedStyles.content}>
        <Text style={revokedStyles.title}>Management didn’t load</Text>
        <Text style={revokedStyles.body}>We couldn’t check your access. Check your connection and try again.</Text>
        <TouchableOpacity
          style={revokedStyles.supportBtn}
          onPress={retry}
          disabled={retrying}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Retry creator access"
        >
          {retrying ? (
            <ActivityIndicator color={Colors.white} />
          ) : (
            <Text style={revokedStyles.supportBtnText}>try again</Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// inventory C-01: shown in place of the silent bounce when getCreatorAccess
// reports isRevoked. Functionally minimal, matches decision 15a.
function RevokedScreen() {
  return (
    <SafeAreaView style={revokedStyles.container} edges={['top', 'bottom']}>
      <View style={revokedStyles.content}>
        {/* LIZ COPY */}
        <Text style={revokedStyles.title}>this access was closed</Text>
        <Text style={revokedStyles.body}>
          your creator access on washedup was revoked. if that seems wrong, reach out and a
          real person will look into it.
        </Text>
        <TouchableOpacity
          style={revokedStyles.supportBtn}
          onPress={() => Linking.openURL('mailto:hello@washedup.app').catch(() => {})}
          activeOpacity={0.85}
        >
          {/* LIZ COPY */}
          <Text style={revokedStyles.supportBtnText}>contact support</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.replace('/(tabs)/plans')} hitSlop={10}>
          {/* LIZ COPY */}
          <Text style={revokedStyles.backLink}>back to plans</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const revokedStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 14 },
  title: {
    fontFamily: Fonts.display,
    fontSize: FontSizes.displayLG,
    color: Colors.darkWarm,
    textAlign: 'center',
  },
  body: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    lineHeight: LineHeights.bodyMD,
    color: Colors.secondary,
    textAlign: 'center',
    marginBottom: 6,
  },
  supportBtn: {
    backgroundColor: Colors.terracotta,
    borderRadius: 999,
    paddingVertical: 13,
    paddingHorizontal: 28,
    alignItems: 'center',
  },
  supportBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.white },
  backLink: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.tertiary, marginTop: 4 },
});


const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: Colors.parchment },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.parchment },
  viewAs: { padding: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.cardBg },
  viewAsText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.secondary },
  done: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Colors.terracotta, padding: 12 },
});
