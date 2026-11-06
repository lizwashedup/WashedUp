import { canCreateLegacyCommunityEvent, newCreatorEventRoute } from '../../lib/creatorEventRoute';
import { CommunityDailyActions } from '../../components/creator/CommunityDailyActions';
import { CommunitySetupNotice } from '../../components/creator/CommunitySetupNotice';
import { ScaledText as Text } from '../../components/ScaledText';
import { useCreatorAccessRead } from '../../hooks/useCreatorAccessRead';
import { useAfterglowFonts } from '../../hooks/useAfterglowFonts';
import { EventMediaImage } from '../../components/events/EventMediaImage';
/**
 * Creator mode: today. Triage, not settings (doc 08). Functionally minimal
 * per decision 15a.
 */

import React, { useCallback, useMemo } from 'react';
import { ActivityIndicator, View, ScrollView, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Redirect, router, useFocusEffect } from 'expo-router';
import { CreatorActionFill } from '../../components/creator/CreatorActionFill';
import { useCreatorDashboardRead } from '../../hooks/useCreatorDashboardRead';
import { ChevronRight, Calendar, Megaphone, Plus, UserPlus } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { type AfterglowFontFamilies, FontSizes, LineHeights } from '../../constants/Typography';
import {
  getCommunityMembers,
  getBroadcasts,
  getCreatorEvents,
  isLeaderAccess,
  isAdminTierRole,
  creatorLandingRoute,
} from '../../lib/creatorMode';
import { getCommunityRooms } from '../../lib/communityChat';
import { pickNextUpcomingEvent } from '../../lib/organizerHome';
import { formatEventDateLA } from '../../lib/laDate';
import { useLedCommunity } from '../../lib/selectedCommunity';
import { getEventAttendees, countAttendees } from '../../lib/ticketAttendees';
import { getRsvpCount } from '../../lib/eventRsvp';
import { OfflineBanner } from '../../components/state/StateViews';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { eventBelongsToWorkspace } from '../../lib/workspaceContext';

export default function CreatorTodayScreen() {
  const { fonts } = useAfterglowFonts(true, 'creator');
  const styles = useMemo(() => createStyles(fonts), [fonts]);
  const accessRead = useCreatorAccessRead();
  const { data: access } = accessRead;
  const community = useLedCommunity(access);
  const canStartEvent = canCreateLegacyCommunityEvent(access, community);

  const membersQuery = useCreatorDashboardRead(accessRead, ['creator-members', community?.id],
    () => getCommunityMembers(community!.id), !!community);
  const broadcastsQuery = useCreatorDashboardRead(accessRead, ['creator-broadcasts', community?.id],
    () => getBroadcasts(community!.id), !!community);
  const eventsQuery = useCreatorDashboardRead(accessRead, ['creator-events', community?.id],
    id => getCreatorEvents(community ? [community.id] : [], id), !!community);
  const { data: members = [], refetch: refetchMembers, isRefetching } = membersQuery;
  const canRefreshMembers = !!community && !!access && !accessRead.isLoading && !accessRead.isError;
  // A join or departure can happen while the creator is on another screen.
  // React Navigation keeps this screen mounted, so mount-only reads go stale.
  useFocusEffect(useCallback(() => {
    if (canRefreshMembers) void refetchMembers();
  }, [community?.id, canRefreshMembers, refetchMembers]));
  const { data: broadcasts = [] } = broadcastsQuery;
  const { data: allEvents = [] } = eventsQuery;
  const events = allEvents.filter((event) =>
    eventBelongsToWorkspace(event, 'community', community?.id ?? null),
  );
  // inventory C-02: a real link into the persistent room, not a fabricated
  // "pulse" metric -- room count is genuinely available (community.tsx
  // already fetches this the same way), so the home card can be honest.
  const roomsQuery = useCreatorDashboardRead(accessRead, ['creator-rooms', community?.id],
    () => getCommunityRooms(community!.id), !!community);

  const { data: rooms = [] } = roomsQuery;
  const pending = members.filter((m) => m.status === 'pending');
  const activeCount = members.filter((m) => m.status === 'active').length;
  const nextEvent = pickNextUpcomingEvent(events);
  const latestBroadcast = broadcasts[0] ?? null;

  const { online } = useNetworkStatus();

  // C-02: ticket sales take precedence over a free RSVP count when both
  // exist -- same precedence lib/creatorMode.ts's getMemberEventHistory
  // already uses per-member.
  const attendeesQuery = useCreatorDashboardRead(accessRead, ['creator-today-attendees', nextEvent?.id],
    () => getEventAttendees(nextEvent!.id), !!nextEvent);
  const counts = countAttendees(attendeesQuery.data ?? []);
  const rsvpQuery = useCreatorDashboardRead(accessRead, ['creator-today-rsvp-count', nextEvent?.id],
    () => getRsvpCount(nextEvent!.id), !!nextEvent);
  const rsvpCount = rsvpQuery.data ?? null;
  const attendanceLabel = !nextEvent
    ? null
    : attendeesQuery.isError || rsvpQuery.isError ? 'Attendance unavailable'
    : attendeesQuery.isLoading || rsvpQuery.isLoading ? 'Loading attendance…'
    : counts.sold > 0 || !rsvpCount
      ? `${counts.sold} sold · ${counts.checkedIn} checked in`
      : `${rsvpCount} going`;

  // Disabled community queries are not evidence of an empty community.
  if (accessRead.isLoading) return <View style={styles.accessState}><ActivityIndicator accessibilityLabel="Loading community management" color={Colors.terracotta} /></View>;
  if (accessRead.isError) return <View style={styles.accessState}>
    <Text accessibilityRole="alert" style={styles.cardMeta}>Couldn’t load your community management.</Text>
    <TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry community management" style={styles.retry}
      disabled={accessRead.isFetching} onPress={() => void accessRead.refetch()}><Text style={styles.retryText}>{accessRead.isFetching ? 'Checking…' : 'Try again'}</Text></TouchableOpacity>
  </View>;

  // today is a leader screen: an event-host-only grant never sees it
  // (doc 34 §1.2). The layout already hides the tab; this covers the
  // landing route, stale pushes, and deep links.
  if (access && community && !isAdminTierRole(community.role)) return <Redirect href={creatorLandingRoute({ ...access, ledCommunities: [community], hasLeaderGrant: false, hasEventHostGrant: false })} />;
  if (access && !isLeaderAccess(access)) return <Redirect href={creatorLandingRoute(access)} />;

  // stage 2 entry state: an approved leader who has not started their
  // community yet gets the one door (setup-community -> create_community),
  // never the empty triage cards.
  if (access && access.hasLeaderGrant && access.ledCommunities.length === 0) {
    return (
      <SafeAreaView style={styles.container} edges={[]}>

        <ScrollView contentContainerStyle={styles.content}>
          {/* LIZ COPY */}
          <Text style={styles.kicker}>Manage</Text>
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
    <SafeAreaView style={styles.container} edges={[]}>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetchMembers} tintColor={Colors.terracotta} />}
      >

        <Text style={styles.kicker}>Manage</Text>
        <Text style={styles.title}>{community ? community.name : 'Your community'}</Text>

        {!online && <OfflineBanner />}
        <CommunitySetupNotice community={community} onNavigate={route => router.push(route as never)} />

        {/* Screen 11 gap closed 2026-09-06: Invite (Screen 56) now has a real
            destination -- app/creator/member-invites.tsx, backend live since
            2026-09-05 -- so it's wired in here in the spec's fixed order. */}
        <View style={styles.quickActions}>
          {canStartEvent && community && <TouchableOpacity
            style={[styles.quickAction, styles.quickActionPrimary]}
            onPress={() => router.push(newCreatorEventRoute('community', community.id) as never)}
            accessibilityRole="button"
            accessibilityLabel="Create event"
            activeOpacity={0.85}
          >
            <CreatorActionFill />
            <View style={styles.quickActionContent}>
              <Plus size={16} color={Colors.white} strokeWidth={2.5} />
              <Text style={styles.quickActionText} numberOfLines={1}>create event</Text>
            </View>
          </TouchableOpacity>}
          <TouchableOpacity
            style={[styles.quickAction, styles.quickActionSecondary]}
            onPress={() => router.push('/(tabs)/friends/manage/(tools)/updates')}
            accessibilityRole="button"
            accessibilityLabel="Send update"
            activeOpacity={0.85}
          >
            <Megaphone size={16} color={Colors.terracotta} strokeWidth={2.5} />
            <Text style={[styles.quickActionText, styles.quickActionTextSecondary]} numberOfLines={1}>Send update</Text>
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

        {community && <CommunityDailyActions communityId={community.id} />}

        {/* Unknown reads must not appear as a zero or empty community. */}
        {membersQuery.isError || membersQuery.isLoading ? (
          <OverviewReadState label="Members" query={membersQuery} />
        ) : (
        <TouchableOpacity
          accessibilityRole="button"
          style={[styles.card, pending.length > 0 && styles.cardAttention]}
          onPress={() => router.push('/(tabs)/friends/manage/(tools)/members')}
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
        <TouchableOpacity accessibilityRole="button" style={styles.card} onPress={() => router.push('/(tabs)/friends/manage/(tools)/events')} activeOpacity={0.8}>
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
            <Text style={styles.cardTitle} >{nextEvent ? nextEvent.title : canStartEvent ? 'Create your next event' : 'Your events'}</Text>
            <Text style={styles.cardMeta}>
              {nextEvent
                ? [nextEvent.event_date ? formatEventDateLA(nextEvent.event_date) : null, nextEvent.venue]
                    .filter(Boolean)
                    .join(' · ')
                : canStartEvent ? 'Bring your community together. Start with an event.' : 'Find existing events and saved drafts here.'}
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
        <TouchableOpacity accessibilityRole="button" style={styles.card} onPress={() => router.push('/(tabs)/friends/manage/(tools)/updates')} activeOpacity={0.8}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.cardTitle}>
              {latestBroadcast ? 'Latest update' : 'Share an update'}
            </Text>
            <Text style={styles.cardMeta} numberOfLines={2}>
              {latestBroadcast ? latestBroadcast.body : 'Post news or a reminder in your community’s Main chat.'}
            </Text>
          </View>
          <ChevronRight size={18} color={Colors.warmGray} strokeWidth={2} />
        </TouchableOpacity>

        )}
        {community && (roomsQuery.isError || roomsQuery.isLoading) && <OverviewReadState label="Chat spaces" query={roomsQuery} />}
        {community && !roomsQuery.isError && !roomsQuery.isLoading && rooms.length > 0 && (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="All community chats"
            accessibilityHint="Browse Main chat and optional groups for this community."
            style={styles.card}
            onPress={() => router.push(`/community/${community.id}` as never)}
            activeOpacity={0.8}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.cardTitle}>
                All community chats
              </Text>
              <Text style={styles.cardMeta}>
                Browse your community’s conversations and optional groups.
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
  accessState: { flex: 1, padding: 24, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: Colors.parchment },
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
