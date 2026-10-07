import { ScaledText as Text } from '../../components/ScaledText';
import { CreatorScreenHeader } from '../../components/creator/CreatorScreenHeader';
import { useCreatorAccessRead } from '../../hooks/useCreatorAccessRead';
import { useAfterglowFonts } from '../../hooks/useAfterglowFonts';
import { EventMediaImage } from '../../components/events/EventMediaImage';
/**
 * Creator mode: today. Triage, not settings (doc 08). Functionally minimal
 * per decision 15a.
 */

import React, { useMemo } from 'react';
import { ActivityIndicator, View, ScrollView, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Redirect, router } from 'expo-router';
import { CreatorActionFill } from '../../components/creator/CreatorActionFill';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Calendar, Megaphone, Plus, UserPlus } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { type AfterglowFontFamilies, FontSizes, LineHeights } from '../../constants/Typography';
import {
  getCommunityMembers,
  getBroadcasts,
  getCreatorEvents,
  isLeaderAccess,
  creatorLandingRoute,
} from '../../lib/creatorMode';
import { getCommunityRooms } from '../../lib/communityChat';
import { pickNextUpcomingEvent } from '../../lib/organizerHome';
import { formatEventDateLA } from '../../lib/laDate';
import { useLedCommunity } from '../../lib/selectedCommunity';
import { CommunitySwitcher } from '../../components/creator/CommunitySwitcher';
import { supabase } from '../../lib/supabase';
import { getEventAttendees, countAttendees } from '../../lib/ticketAttendees';
import { getRsvpCount } from '../../lib/eventRsvp';
import { OfflineBanner } from '../../components/state/StateViews';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { WorkspaceSwitcher } from '../../components/creator/WorkspaceSwitcher';
import { eventBelongsToWorkspace } from '../../lib/workspaceContext';

export default function CreatorTodayScreen() {
  const { fonts } = useAfterglowFonts(true, 'creator');
  const styles = useMemo(() => createStyles(fonts), [fonts]);
  const { data: access } = useCreatorAccessRead();
  const community = useLedCommunity(access);

  const membersQuery = useQuery({
    queryKey: ['creator-members', community?.id],
    queryFn: () => getCommunityMembers(community!.id),
    enabled: !!community,
  });
  const broadcastsQuery = useQuery({
    queryKey: ['creator-broadcasts', community?.id],
    queryFn: () => getBroadcasts(community!.id),
    enabled: !!community,
  });
  const eventsQuery = useQuery({
    queryKey: ['creator-events', community?.id],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      return getCreatorEvents(community ? [community.id] : [], user.id);
    },
    enabled: access != null,
  });
  const { data: members = [], refetch: refetchMembers, isRefetching } = membersQuery;
  const { data: broadcasts = [] } = broadcastsQuery;
  const { data: allEvents = [] } = eventsQuery;
  const events = allEvents.filter((event) =>
    eventBelongsToWorkspace(event, 'community', community?.id ?? null),
  );
  // inventory C-02: a real link into the persistent room, not a fabricated
  // "pulse" metric -- room count is genuinely available (community.tsx
  // already fetches this the same way), so the home card can be honest.
  const roomsQuery = useQuery({
    queryKey: ['creator-rooms', community?.id],
    queryFn: () => getCommunityRooms(community!.id),
    enabled: !!community,
  });

  const { data: rooms = [] } = roomsQuery;
  const pending = members.filter((m) => m.status === 'pending');
  const activeCount = members.filter((m) => m.status === 'active').length;
  const nextEvent = pickNextUpcomingEvent(events);
  const latestBroadcast = broadcasts[0] ?? null;

  const { online } = useNetworkStatus();

  // C-02: ticket sales take precedence over a free RSVP count when both
  // exist -- same precedence lib/creatorMode.ts's getMemberEventHistory
  // already uses per-member.
  const attendeesQuery = useQuery({
    queryKey: ['creator-today-attendees', nextEvent?.id],
    queryFn: () => getEventAttendees(nextEvent!.id),
    enabled: !!nextEvent,
  });
  const counts = countAttendees(attendeesQuery.data ?? []);
  const rsvpQuery = useQuery({
    queryKey: ['creator-today-rsvp-count', nextEvent?.id],
    queryFn: () => getRsvpCount(nextEvent!.id),
    enabled: !!nextEvent,
  });
  const rsvpCount = rsvpQuery.data ?? null;
  const attendanceLabel = !nextEvent
    ? null
    : attendeesQuery.isError || rsvpQuery.isError ? 'Attendance unavailable'
    : attendeesQuery.isLoading || rsvpQuery.isLoading ? 'Loading attendance…'
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
        <CreatorScreenHeader title="Community overview" />
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
            accessibilityRole="button"
            onPress={() => router.push('/creator/setup-community' as never)}
            activeOpacity={0.85}
          >
            {/* LIZ COPY: the locked vocabulary */}
            <CreatorActionFill />
            <Text style={styles.entryBtnText} numberOfLines={1}>start your community</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
        <CreatorScreenHeader title="Community overview" />
      {/* Screen 11 gap: persistent active-community name. Outside the
          ScrollView on purpose so it survives scrolling, unlike the big
          title below which is the first-paint moment, not the ongoing
          reminder of which community you're in. */}
      {community && (
        <View style={styles.stickyHeader}>
          <Text style={styles.stickyHeaderText} numberOfLines={1}>{community.name}</Text>
        </View>
      )}
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetchMembers} tintColor={Colors.terracotta} />}
      >
        <Text style={styles.kicker}>creator mode</Text>
        <Text style={styles.title}>{community ? community.name : 'today'}</Text>
        <WorkspaceSwitcher access={access} />
        <CommunitySwitcher access={access} />
        {!online && <OfflineBanner />}

        {/* Screen 11 gap closed 2026-09-06: Invite (Screen 56) now has a real
            destination -- app/creator/member-invites.tsx, backend live since
            2026-09-05 -- so it's wired in here in the spec's fixed order. */}
        <View style={styles.quickActions}>
          <TouchableOpacity
            style={[styles.quickAction, styles.quickActionPrimary]}
            onPress={() => router.push('/creator/event-form')}
            accessibilityRole="button"
            accessibilityLabel="Create event"
            activeOpacity={0.85}
          >
            <CreatorActionFill />
            <View style={styles.quickActionContent}>
              <Plus size={16} color={Colors.white} strokeWidth={2.5} />
              <Text style={styles.quickActionText} numberOfLines={1}>create event</Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.quickAction, styles.quickActionSecondary]}
            onPress={() => router.push('/(creator)/community')}
            accessibilityRole="button"
            accessibilityLabel="Broadcast"
            activeOpacity={0.85}
          >
            <Megaphone size={16} color={Colors.terracotta} strokeWidth={2.5} />
            <Text style={[styles.quickActionText, styles.quickActionTextSecondary]} numberOfLines={1}>broadcast</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.quickAction, styles.quickActionSecondary]}
            onPress={() => router.push('/creator/member-invites' as never)}
            accessibilityRole="button"
            accessibilityLabel="Invite"
            activeOpacity={0.85}
          >
            <UserPlus size={16} color={Colors.terracotta} strokeWidth={2.5} />
            <Text style={[styles.quickActionText, styles.quickActionTextSecondary]} numberOfLines={1}>invite</Text>
          </TouchableOpacity>
        </View>

        {/* Unknown reads must not appear as a zero or empty community. */}
        {membersQuery.isError || membersQuery.isLoading ? (
          <OverviewReadState label="Members" query={membersQuery} />
        ) : (
        <TouchableOpacity
          accessibilityRole="button"
          style={[styles.card, pending.length > 0 && styles.cardAttention]}
          onPress={() => router.push('/(creator)/members')}
          activeOpacity={0.8}
        >
          <View style={{ flex: 1, minWidth: 0 }}>
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

        )}
        {eventsQuery.isError || eventsQuery.isLoading ? (
          <OverviewReadState label="Events" query={eventsQuery} />
        ) : (
        <TouchableOpacity accessibilityRole="button" style={styles.card} onPress={() => router.push('/(creator)/events')} activeOpacity={0.8}>
          {/* the next event's cover, so the home reads finished not skeletal */}
          {nextEvent?.image_url ? (
            <EventMediaImage eventId={nextEvent.id} reference={nextEvent.image_url} style={styles.cardThumb} contentFit="cover" />
          ) : (
            <View style={[styles.cardThumb, styles.cardThumbFallback]}>
              <Calendar size={18} color={Colors.warmGray} strokeWidth={2} />
            </View>
          )}
          <View style={{ flex: 1, minWidth: 0 }}>
            {/* copy to the taste gate: the card's own eyebrow gives hierarchy */}
            <Text style={styles.cardEyebrow}>{nextEvent ? 'your next event' : 'events'}</Text>
            <Text style={styles.cardTitle} >{nextEvent ? nextEvent.title : 'Plan your next gathering'}</Text>
            <Text style={styles.cardMeta}>
              {nextEvent
                ? [nextEvent.event_date ? formatEventDateLA(nextEvent.event_date) : null, nextEvent.venue]
                    .filter(Boolean)
                    .join(' · ')
                : 'Bring your community together. Start with an event.'}
            </Text>
            {attendanceLabel && (
              <Text style={styles.cardCounts} numberOfLines={1}>{attendanceLabel}</Text>
            )}
          </View>
          <ChevronRight size={18} color={Colors.warmGray} strokeWidth={2} />
        </TouchableOpacity>

        )}
        {nextEvent && (attendeesQuery.isError || rsvpQuery.isError) && <OverviewReadState label="Attendance" query={{
          isError: true, isFetching: attendeesQuery.isFetching || rsvpQuery.isFetching,
          refetch: () => Promise.all([attendeesQuery.refetch(), rsvpQuery.refetch()]),
        }} />}
        {broadcastsQuery.isError || broadcastsQuery.isLoading ? (
          <OverviewReadState label="Updates" query={broadcastsQuery} />
        ) : (
        <TouchableOpacity accessibilityRole="button" style={styles.card} onPress={() => router.push('/(creator)/community')} activeOpacity={0.8}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.cardTitle}>
              {latestBroadcast ? 'last broadcast' : 'say something to your people'}
            </Text>
            <Text style={styles.cardMeta} numberOfLines={2}>
              {latestBroadcast ? latestBroadcast.body : 'your first broadcast pins to the top of every member’s chats'}
            </Text>
          </View>
          <ChevronRight size={18} color={Colors.warmGray} strokeWidth={2} />
        </TouchableOpacity>

        )}
        {community && (roomsQuery.isError || roomsQuery.isLoading) && <OverviewReadState label="Chat spaces" query={roomsQuery} />}
        {community && !roomsQuery.isError && !roomsQuery.isLoading && rooms.length > 0 && (
          <TouchableOpacity
            accessibilityRole="button"
            style={styles.card}
            onPress={() => router.push(`/community-topic/${rooms[0].id}` as never)}
            activeOpacity={0.8}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.cardTitle}>
                {rooms.length === 1 ? rooms[0].name : `${rooms.length} chat spaces open`}
              </Text>
              <Text style={styles.cardMeta}>
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

function OverviewReadState({ label, query }: {
  label: string;
  query: { isError: boolean; isFetching: boolean; refetch: () => Promise<unknown> };
}) {
  const { fonts } = useAfterglowFonts(true, 'creator');
  const styles = useMemo(() => createStyles(fonts), [fonts]);
  return <View style={styles.card} accessibilityLiveRegion="polite">
    <View style={{ flex: 1 }}>
      <Text style={styles.cardTitle}>{query.isError ? `${label} unavailable` : `Loading ${label.toLowerCase()}…`}</Text>
      {query.isError && <Text style={styles.cardMeta}>Your information couldn’t be loaded. Try again.</Text>}
    </View>
    {query.isError ? <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Retry ${label.toLowerCase()}`}
      style={styles.retry} disabled={query.isFetching} onPress={() => void query.refetch()}>
      <Text style={styles.retryText}>{query.isFetching ? 'Checking…' : 'Retry'}</Text>
    </TouchableOpacity> : <ActivityIndicator color={Colors.terracotta} />}
  </View>;
}

function createStyles(fonts: AfterglowFontFamilies) { return StyleSheet.create({
  retry: { minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  retryText: { fontFamily: fonts.medium, fontSize: FontSizes.bodySM, color: Colors.terracotta },
  container: { flex: 1, backgroundColor: Colors.parchment },
  stickyHeader: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.parchment,
  },
  stickyHeaderText: {
    fontFamily: fonts.semibold,
    fontSize: FontSizes.bodySM,
    color: Colors.darkWarm,
  },
  content: { padding: 20, gap: 12 },
  quickActions: { marginBottom: 8, flexWrap: 'wrap', flexDirection: 'row', gap: 10 },
  quickAction: {
    flexGrow: 1,
    flexBasis: 92,
    minHeight: 44,
    paddingHorizontal: 10,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.terracotta,
    borderRadius: 999,
    paddingVertical: 12,
  },
  quickActionContent: { flexDirection: 'row', alignItems: 'center', gap: 6, zIndex: 1 },
  quickActionPrimary: { flexBasis: '100%' },
  quickActionSecondary: {
    backgroundColor: Colors.cardBg,
    borderWidth: 1,
    borderColor: Colors.terracotta,
  },
  quickActionText: { fontFamily: fonts.semibold, fontSize: FontSizes.bodySM, color: Colors.white },
  quickActionTextSecondary: { color: Colors.terracotta },
  kicker: {
    fontFamily: fonts.semibold,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
    letterSpacing: 1.5,
  },
  title: {
    fontFamily: fonts.display,
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
    fontFamily: fonts.regular,
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
  entryBtnText: { fontFamily: fonts.semibold, fontSize: FontSizes.bodyMD, color: Colors.white },
  cardEyebrow: { fontFamily: fonts.semibold, fontSize: FontSizes.micro, color: Colors.terracotta, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 2 },
  cardTitle: { fontFamily: fonts.semibold, fontSize: FontSizes.bodyLG, lineHeight: 23, color: Colors.darkWarm, marginBottom: 3 },
  cardMeta: { fontFamily: fonts.regular, fontSize: FontSizes.bodySM, lineHeight: 19, color: Colors.secondary },
  cardCounts: { fontFamily: fonts.medium, fontSize: FontSizes.bodySM, color: Colors.darkWarm, marginTop: 2 },
  cardThumb: { width: 64, height: 80, borderRadius: 10, backgroundColor: Colors.inputBg },
  cardThumbFallback: { alignItems: 'center', justifyContent: 'center' },
});
}
