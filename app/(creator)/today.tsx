/**
 * Creator mode: today. Triage, not settings (doc 08). Functionally minimal
 * per decision 15a.
 */

import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Redirect, router } from 'expo-router';
import { Image } from 'expo-image';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Calendar, Megaphone, Plus } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import {
  getCreatorAccess,
  getCommunityMembers,
  getBroadcasts,
  getCreatorEvents,
  isLeaderAccess,
  creatorLandingRoute,
} from '../../lib/creatorMode';
import { getCommunityRooms } from '../../lib/communityChat';
import { formatEventDateLA } from '../../lib/laDate';
import { useLedCommunity } from '../../lib/selectedCommunity';
import { CommunitySwitcher } from '../../components/creator/CommunitySwitcher';
import { supabase } from '../../lib/supabase';
import { getEventAttendees, countAttendees } from '../../lib/ticketAttendees';
import { getRsvpCount } from '../../lib/eventRsvp';
import { OfflineBanner } from '../../components/state/StateViews';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';

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
  // inventory C-02: a real link into the persistent room, not a fabricated
  // "pulse" metric -- room count is genuinely available (community.tsx
  // already fetches this the same way), so the home card can be honest.
  const { data: rooms = [] } = useQuery({
    queryKey: ['creator-rooms', community?.id],
    queryFn: () => getCommunityRooms(community!.id),
    enabled: !!community,
  });

  const pending = members.filter((m) => m.status === 'pending');
  const activeCount = members.filter((m) => m.status === 'active').length;
  const nextEvent = events[0] ?? null;
  const latestBroadcast = broadcasts[0] ?? null;

  const { online } = useNetworkStatus();

  // C-02: ticket sales take precedence over a free RSVP count when both
  // exist -- same precedence lib/creatorMode.ts's getMemberEventHistory
  // already uses per-member.
  const { data: attendees = [] } = useQuery({
    queryKey: ['creator-today-attendees', nextEvent?.id],
    queryFn: () => getEventAttendees(nextEvent!.id),
    enabled: !!nextEvent,
  });
  const counts = countAttendees(attendees);
  const { data: rsvpCount = null } = useQuery({
    queryKey: ['creator-today-rsvp-count', nextEvent?.id],
    queryFn: () => getRsvpCount(nextEvent!.id),
    enabled: !!nextEvent,
  });
  const attendanceLabel = !nextEvent
    ? null
    : counts.sold > 0 || !rsvpCount
      ? `${counts.sold} sold · ${counts.checkedIn} checked in`
      : `${rsvpCount} going`;

  // today is a leader screen: an event-host-only grant never sees it
  // (doc 34 §1.2). The layout already hides the tab; this covers the
  // landing route, stale pushes, and deep links.
  if (access && !isLeaderAccess(access)) return <Redirect href={creatorLandingRoute(access)} />;

  // stage 2 entry state: an approved leader who has not started their
  // community yet gets the one door (setup-community -> create_community),
  // never the empty triage cards.
  if (access && access.hasLeaderGrant && access.ledCommunities.length === 0) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScrollView contentContainerStyle={styles.content}>
          {/* LIZ COPY */}
          <Text style={styles.kicker}>creator mode</Text>
          {/* LIZ COPY */}
          <Text style={styles.title}>you're in.</Text>
          {/* LIZ COPY */}
          <Text style={styles.entryText}>
            your application was approved. first thing: give your community its name and
            its page. it stays a draft only you can see until you open it.
          </Text>
          <TouchableOpacity
            style={styles.entryBtn}
            onPress={() => router.push('/creator/setup-community' as never)}
            activeOpacity={0.85}
          >
            {/* LIZ COPY: the locked vocabulary */}
            <Text style={styles.entryBtnText}>start your community</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Screen 11 gap: persistent active-community name. Outside the
          ScrollView on purpose so it survives scrolling, unlike the big
          title below which is the first-paint moment, not the ongoing
          reminder of which community you're in. */}
      {community && (
        <View style={styles.stickyHeader}>
          <Text style={styles.stickyHeaderText} numberOfLines={1}>{community.name.toLowerCase()}</Text>
        </View>
      )}
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetchMembers} tintColor={Colors.terracotta} />}
      >
        <Text style={styles.kicker}>creator mode</Text>
        <Text style={styles.title}>{community ? community.name.toLowerCase() : 'today'}</Text>
        <CommunitySwitcher access={access} />
        {!online && <OfflineBanner />}

        {/* Screen 11 gap: fixed Create event / Broadcast / Invite quick-action
            order. Invite (Screen 56) has no destination yet -- Master Plan v3
            §4.2 -- so it's left out here rather than linking to nothing; add
            it in this same order once that screen exists. */}
        <View style={styles.quickActions}>
          <TouchableOpacity
            style={styles.quickAction}
            onPress={() => router.push('/creator/event-form')}
            accessibilityRole="button"
            accessibilityLabel="Create event"
            activeOpacity={0.85}
          >
            <Plus size={16} color={Colors.white} strokeWidth={2.5} />
            <Text style={styles.quickActionText}>create event</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.quickAction, styles.quickActionSecondary]}
            onPress={() => router.push('/(creator)/community')}
            accessibilityRole="button"
            accessibilityLabel="Broadcast"
            activeOpacity={0.85}
          >
            <Megaphone size={16} color={Colors.terracotta} strokeWidth={2.5} />
            <Text style={[styles.quickActionText, styles.quickActionTextSecondary]}>broadcast</Text>
          </TouchableOpacity>
        </View>

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
          {/* the next event's cover, so the home reads finished not skeletal */}
          {nextEvent?.image_url ? (
            <Image source={{ uri: nextEvent.image_url }} style={styles.cardThumb} contentFit="cover" />
          ) : (
            <View style={[styles.cardThumb, styles.cardThumbFallback]}>
              <Calendar size={18} color={Colors.warmGray} strokeWidth={2} />
            </View>
          )}
          <View style={{ flex: 1 }}>
            {/* copy to the taste gate: the card's own eyebrow gives hierarchy */}
            <Text style={styles.cardEyebrow}>{nextEvent ? 'your next event' : 'events'}</Text>
            <Text style={styles.cardTitle} numberOfLines={1}>{nextEvent ? nextEvent.title : 'no events on the calendar'}</Text>
            <Text style={styles.cardMeta} numberOfLines={1}>
              {nextEvent
                ? [nextEvent.event_date ? formatEventDateLA(nextEvent.event_date) : null, nextEvent.venue]
                    .filter(Boolean)
                    .join(' · ')
                : 'event posting lands with discovery'}
            </Text>
            {attendanceLabel && (
              <Text style={styles.cardCounts} numberOfLines={1}>{attendanceLabel}</Text>
            )}
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

        {community && rooms.length > 0 && (
          <TouchableOpacity
            style={styles.card}
            onPress={() => router.push(`/community-topic/${rooms[0].id}` as never)}
            activeOpacity={0.8}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>
                {rooms.length === 1 ? rooms[0].name : `${rooms.length} chat spaces open`}
              </Text>
              <Text style={styles.cardMeta} numberOfLines={1}>
                the chat spaces members join. tap to open{rooms.length > 1 ? ' the first one' : ''}.
              </Text>
            </View>
            <ChevronRight size={18} color={Colors.warmGray} strokeWidth={2} />
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  stickyHeader: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.parchment,
  },
  stickyHeaderText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodySM,
    color: Colors.darkWarm,
  },
  content: { padding: 20, gap: 12 },
  quickActions: { flexDirection: 'row', gap: 10 },
  quickAction: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.terracotta,
    borderRadius: 999,
    paddingVertical: 12,
  },
  quickActionSecondary: {
    backgroundColor: Colors.cardBg,
    borderWidth: 1,
    borderColor: Colors.terracotta,
  },
  quickActionText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Colors.white },
  quickActionTextSecondary: { color: Colors.terracotta },
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
  entryText: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    lineHeight: 21,
    color: Colors.secondary,
    marginBottom: 16,
  },
  entryBtn: {
    backgroundColor: Colors.terracotta,
    borderRadius: 999,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  entryBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.white },
  cardEyebrow: { fontFamily: Fonts.sansBold, fontSize: FontSizes.micro, color: Colors.terracotta, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 2 },
  cardTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.darkWarm, marginBottom: 3 },
  cardMeta: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.secondary },
  cardCounts: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.darkWarm, marginTop: 2 },
  cardThumb: { width: 48, height: 48, borderRadius: 10, backgroundColor: Colors.inputBg },
  cardThumbFallback: { alignItems: 'center', justifyContent: 'center' },
});
