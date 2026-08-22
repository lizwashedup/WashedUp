/**
 * Creator mode: the swapped tab shell (doc 08). A separate route group so
 * personal tabs and creator tabs never mix. Entered from the profile
 * switch; exits via menu -> switch back.
 *
 * Community Leaders (or anyone actively leading a community) get all five
 * community tabs. An event-host-only grant gets its own purpose-built
 * organizer shell instead (CTO scope item 06; design spec item 04
 * "distinct... workspace shells"; inventory O-01): organizer-home + events +
 * menu, never the leader's cut-down five-tab set. Enforced here AND by RLS
 * server-side.
 *
 * Screens are functionally minimal per decision 15a: logic before design.
 */

import { Redirect, Tabs, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ActivityIndicator, Linking, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Sun, CalendarDays, Megaphone, UsersRound, Menu, Ticket } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import { COMMUNITIES_ENABLED } from '../../constants/FeatureFlags';
import { getCreatorAccess, hasCreatorAccess, creatorShellKind } from '../../lib/creatorMode';
import { setViewAsEventHost, useViewAsEventHost } from '../../lib/viewAs';

export default function CreatorLayout() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const viewingAsEventHost = useViewAsEventHost();
  const { data: access, isLoading } = useQuery({
    queryKey: ['creator-access'],
    queryFn: getCreatorAccess,
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.parchment }}>
        <ActivityIndicator size="large" color={Colors.terracotta} />
      </View>
    );
  }

  // inventory C-01: a revoked creator gets a real Support screen, not a
  // silent bounce to Plans/Profile as if they never had access at all.
  if (!hasCreatorAccess(access) && access?.isRevoked) {
    return <RevokedScreen />;
  }

  // Grant-gated public-dark (mirrors the profile switch row, 7-21, and web's
  // /c fix): a real grant admits its holder even while the flag is off, and
  // RLS enforces the same grants server-side. Everyone else bounces exactly
  // as before: plans while the flag is off, profile once it is on, so the
  // area stays dark to the public either way.
  if (!hasCreatorAccess(access)) {
    return <Redirect href={COMMUNITIES_ENABLED ? '/(tabs)/profile' : '/(tabs)/plans'} />;
  }

  const shellKind = creatorShellKind(access);
  const showToday = shellKind === 'full';
  const showOrganizerHome = shellKind === 'organizer' || shellKind === 'events';
  const showEvents = shellKind === 'full' || shellKind === 'organizer' || shellKind === 'events';
  const showAttendees = shellKind === 'organizer' || shellKind === 'events';
  const showCommunity = shellKind === 'full';
  const showMembers = shellKind === 'full' || shellKind === 'member_care';
  const tabBarHeight = Platform.OS === 'ios' ? 52 + insets.bottom : 60;

  return (
    <View style={styles.shell}>
    <Tabs
      screenOptions={{
        headerShown: false,
        lazy: true,
        freezeOnBlur: true,
        tabBarActiveTintColor: '#2C1810',
        tabBarInactiveTintColor: '#A09385',
        tabBarStyle: {
          backgroundColor: Colors.parchment,
          borderTopWidth: 0.5,
          borderTopColor: '#E5DDD1',
          height: tabBarHeight,
          paddingBottom: Platform.OS === 'ios' ? insets.bottom : 8,
          paddingTop: 8,
        },
        tabBarLabelStyle: {
          fontFamily: Fonts.sansMedium,
          fontSize: FontSizes.caption,
        },
      }}
    >
      <Tabs.Screen
        name="today"
        options={{
          title: 'Today',
          href: showToday ? undefined : null,
          tabBarIcon: ({ color }) => <Sun size={22} color={color} strokeWidth={2} />,
        }}
      />
      <Tabs.Screen
        name="organizer-home"
        options={{
          // O-01's own nav naming ("Today / Events / Attendees / More"); the
          // leader's "Today" and this are mutually exclusive, never both shown
          title: 'Today',
          href: showOrganizerHome ? undefined : null,
          tabBarIcon: ({ color }) => <Sun size={22} color={color} strokeWidth={2} />,
        }}
      />
      <Tabs.Screen
        name="events"
        options={{
          title: 'Events',
          href: showEvents ? undefined : null,
          tabBarIcon: ({ color }) => <CalendarDays size={22} color={color} strokeWidth={2} />,
        }}
      />
      <Tabs.Screen
        name="attendees"
        options={{
          // O-01's own nav naming ("Today / Events / Attendees / More") --
          // the event-host-only shell's tab. Leaders keep their own
          // per-event attendee view reached from events/members instead,
          // so this tab stays hidden for them, same pattern as organizer-home.
          title: 'Attendees',
          href: showAttendees ? undefined : null,
          tabBarIcon: ({ color }) => <Ticket size={22} color={color} strokeWidth={2} />,
        }}
      />
      <Tabs.Screen
        name="community"
        options={{
          title: 'Community',
          href: showCommunity ? undefined : null,
          tabBarIcon: ({ color }) => <Megaphone size={22} color={color} strokeWidth={2} />,
        }}
      />
      <Tabs.Screen
        name="members"
        options={{
          title: 'Members',
          href: showMembers ? undefined : null,
          tabBarIcon: ({ color }) => <UsersRound size={22} color={color} strokeWidth={2} />,
        }}
      />
      <Tabs.Screen
        name="menu"
        options={{
          // O-01's own nav naming wants "More" for the event-host shell
          // (Today / Events / Attendees / More); the leader's five-tab
          // shell keeps the existing "Menu" label, its own naming is
          // unrelated to O-01.
          title: shellKind === 'full' ? 'Menu' : 'More',
          tabBarIcon: ({ color }) => <Menu size={22} color={color} strokeWidth={2} />,
        }}
      />
      <Tabs.Screen
        name="organizer-broadcast"
        // O-03: reachable via router.push from organizer-home's "message
        // your followers" row, not a tab. Undeclared screens in a Tabs
        // navigator auto-register into the tab bar, which is how this one
        // was showing up as a phantom sixth tab.
        options={{ href: null }}
      />
    </Tabs>
      {/* admin view-as (doc 00 7-13): a quiet floating pill names the mode
          with a one-tap exit; the override itself lives in getCreatorAccess */}
      {viewingAsEventHost && (
        <View style={[styles.viewAsPill, { bottom: tabBarHeight + 12 }]}>
          {/* LIZ COPY */}
          <Text style={styles.viewAsText}>viewing as an event host</Text>
          <TouchableOpacity
            onPress={() => {
              setViewAsEventHost(false);
              queryClient.invalidateQueries({ queryKey: ['creator-access'] });
            }}
            hitSlop={10}
          >
            {/* LIZ COPY */}
            <Text style={styles.viewAsDone}>done</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
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
  shell: { flex: 1 },
  viewAsPill: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.cardBg,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 16,
    paddingVertical: 9,
    shadowColor: Colors.shadowBlack,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 4,
  },
  viewAsText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.secondary },
  viewAsDone: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Colors.terracotta },
});
