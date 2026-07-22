/**
 * Creator mode: the swapped tab shell (doc 08). A separate route group so
 * personal tabs and creator tabs never mix. Entered from the profile
 * switch; exits via menu -> switch back.
 *
 * Community Leaders (or anyone actively leading a community) get all five
 * tabs. Event Host grant alone gets the smaller shell: events + menu only,
 * enforced here AND by RLS server-side.
 *
 * Screens are functionally minimal per decision 15a: logic before design.
 */

import { Redirect, Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ActivityIndicator, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Sun, CalendarDays, Megaphone, UsersRound, Menu } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { COMMUNITIES_ENABLED } from '../../constants/FeatureFlags';
import { getCreatorAccess, hasCreatorAccess, isLeaderAccess } from '../../lib/creatorMode';
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

  if (!COMMUNITIES_ENABLED) return <Redirect href="/(tabs)/plans" />;

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.parchment }}>
        <ActivityIndicator size="large" color={Colors.terracotta} />
      </View>
    );
  }

  if (!hasCreatorAccess(access)) return <Redirect href="/(tabs)/profile" />;

  const leader = isLeaderAccess(access);
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
          href: leader ? undefined : null,
          tabBarIcon: ({ color }) => <Sun size={22} color={color} strokeWidth={2} />,
        }}
      />
      <Tabs.Screen
        name="events"
        options={{
          title: 'Events',
          tabBarIcon: ({ color }) => <CalendarDays size={22} color={color} strokeWidth={2} />,
        }}
      />
      <Tabs.Screen
        name="community"
        options={{
          title: 'Community',
          href: leader ? undefined : null,
          tabBarIcon: ({ color }) => <Megaphone size={22} color={color} strokeWidth={2} />,
        }}
      />
      <Tabs.Screen
        name="members"
        options={{
          title: 'Members',
          href: leader ? undefined : null,
          tabBarIcon: ({ color }) => <UsersRound size={22} color={color} strokeWidth={2} />,
        }}
      />
      <Tabs.Screen
        name="menu"
        options={{
          title: 'Menu',
          tabBarIcon: ({ color }) => <Menu size={22} color={color} strokeWidth={2} />,
        }}
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
