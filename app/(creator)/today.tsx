/**
 * Creator mode: today. Triage, not settings (doc 08). Functionally minimal
 * per decision 15a.
 */

import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Redirect, router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import {
  getCreatorAccess,
  getCommunityMembers,
  getBroadcasts,
  getCreatorEvents,
  isLeaderAccess,
} from '../../lib/creatorMode';
import { formatEventDateLA } from '../../lib/laDate';
import { useLedCommunity } from '../../lib/selectedCommunity';
import { CommunitySwitcher } from '../../components/creator/CommunitySwitcher';
import { supabase } from '../../lib/supabase';

export default function CreatorTodayScreen() {
  const { data: access } = useQuery({ queryKey: ['creator-access'], queryFn: getCreatorAccess });
  const community = useLedCommunity(access);

  const { data: members = [], refetch: refetchMembers, isRefetching } = useQuery({
    queryKey: ['creator-members', community?.id],
    queryFn: () => getCommunityMembers(community!.id),
    enabled: !!community,
  });
  const { data: broadcasts = [] } = useQuery({
    queryKey: ['creator-broadcasts', community?.id],
    queryFn: () => getBroadcasts(community!.id),
    enabled: !!community,
  });
  const { data: events = [] } = useQuery({
    queryKey: ['creator-events', community?.id],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      return getCreatorEvents(community ? [community.id] : [], user.id);
    },
    enabled: access != null,
  });

  const pending = members.filter((m) => m.status === 'pending');
  const activeCount = members.filter((m) => m.status === 'active').length;
  const nextEvent = events[0] ?? null;
  const latestBroadcast = broadcasts[0] ?? null;

  // today is a leader screen: an event-host-only grant never sees it
  // (doc 34 §1.2). The layout already hides the tab; this covers the
  // landing route, stale pushes, and deep links.
  if (access && !isLeaderAccess(access)) return <Redirect href="/(creator)/events" />;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetchMembers} tintColor={Colors.terracotta} />}
      >
        <Text style={styles.kicker}>creator mode</Text>
        <Text style={styles.title}>{community ? community.name.toLowerCase() : 'today'}</Text>
        <CommunitySwitcher access={access} />

        {/* the one thing that needs attention first */}
        <TouchableOpacity
          style={[styles.card, pending.length > 0 && styles.cardAttention]}
          onPress={() => router.push('/(creator)/members')}
          activeOpacity={0.8}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>
              {pending.length > 0
                ? `${pending.length} ${pending.length === 1 ? 'person wants' : 'people want'} in`
                : 'no join requests waiting'}
            </Text>
            <Text style={styles.cardMeta}>
              {pending.length > 0 ? 'review them in members' : `${activeCount} ${activeCount === 1 ? 'member' : 'members'} so far`}
            </Text>
          </View>
          <ChevronRight size={18} color={Colors.warmGray} strokeWidth={2} />
        </TouchableOpacity>

        <TouchableOpacity style={styles.card} onPress={() => router.push('/(creator)/events')} activeOpacity={0.8}>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>{nextEvent ? nextEvent.title : 'no events on the calendar'}</Text>
            <Text style={styles.cardMeta}>
              {nextEvent
                ? [nextEvent.event_date ? formatEventDateLA(nextEvent.event_date) : null, nextEvent.venue]
                    .filter(Boolean)
                    .join(' · ')
                : 'event posting lands with discovery'}
            </Text>
          </View>
          <ChevronRight size={18} color={Colors.warmGray} strokeWidth={2} />
        </TouchableOpacity>

        <TouchableOpacity style={styles.card} onPress={() => router.push('/(creator)/community')} activeOpacity={0.8}>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>
              {latestBroadcast ? 'last broadcast' : 'say something to your people'}
            </Text>
            <Text style={styles.cardMeta} numberOfLines={2}>
              {latestBroadcast ? latestBroadcast.body : 'your first broadcast pins to the top of every member’s chats'}
            </Text>
          </View>
          <ChevronRight size={18} color={Colors.warmGray} strokeWidth={2} />
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  content: { padding: 20, gap: 12 },
  kicker: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
    letterSpacing: 1.5,
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: FontSizes.displayLG,
    lineHeight: LineHeights.displayLG,
    color: Colors.darkWarm,
    marginBottom: 8,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
  },
  cardAttention: { borderColor: Colors.gold, borderWidth: 1.5 },
  cardTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.darkWarm, marginBottom: 3 },
  cardMeta: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.secondary },
});
