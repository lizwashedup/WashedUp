import React, { useEffect, useMemo, useState } from 'react';
import { AppState, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { showAddToCalendar } from '../../../lib/addToCalendar';
import { openUrl } from '../../../lib/url';
import { getPlanChatExpiry } from '../../../lib/planChatExpiry';
import { capDisplayCount } from '../../../constants/GroupLimits';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';
import ChatThread, { ChatThreadMember } from '../../../components/chat/ChatThread';
import { COMMUNITY_CHAT_GROUPING_ENABLED } from '../../../constants/FeatureFlags';

import { ChatEntryState } from '../../../components/chat/ChatEntryState';
import { requestWithDeadline, RequestDeadlineError } from '../../../lib/requestWithDeadline';
import { useObservedUser } from '../../../hooks/useObservedUser';
const ThreadComponent = ChatThread;

async function currentChatRead<T>(read: () => PromiseLike<T>, isCurrent: () => boolean): Promise<T> {
  if (!isCurrent()) throw new Error('This chat visit changed.');
  const result = await requestWithDeadline(Promise.resolve(read()), 12_000);
  if (!isCurrent()) throw new Error('This chat visit changed.');
  return result;
}

// ─── Event header data ──────────────────────────────────────────────────────
// The plan-chat screen is a thin wrapper around the shared <ChatThread>: it
// resolves the event metadata + plan-specific chrome (ticket banner, pinned
// plan card, read-only/countdown copy) and hands the rest to the shared body.

interface EventInfo {
  id: string;
  title: string;
  start_time: string;
  end_time: string | null;
  location_text: string | null;
  status: string;
  tickets_url: string | null;
  member_count: number;
  explore_event_id: string | null;
}

async function fetchEventInfo(eventId: string): Promise<EventInfo> {
  const { data: event, error } = await supabase
    .from('events')
    .select('id, title, start_time, end_time, location_text, status, tickets_url, member_count, explore_event_id')
    .eq('id', eventId)
    .maybeSingle();
  if (error) throw error;
  if (!event) throw new Error('Event not found');

  return {
    id: event.id,
    title: event.title,
    start_time: event.start_time,
    end_time: (event as any).end_time ?? null,
    location_text: (event as any).location_text ?? null,
    status: (event as any).status ?? 'forming',
    tickets_url: (event as any).tickets_url ?? null,
    member_count: (event as any).member_count ?? 0,
    explore_event_id: (event as any).explore_event_id ?? null,
  };
}

// Header avatars are optional enrichment: they must not delay message loading.
// Keep the joined-member read and public-profile projection, separately owned
// by the same account generation as the essential Plan metadata.
async function fetchEventHeaderMembers(eventId: string, isCurrent: () => boolean): Promise<ChatThreadMember[]> {
  const { data: rows, error } = await currentChatRead(() => supabase
    .from('event_members').select('user_id').eq('event_id', eventId).eq('status', 'joined').limit(6), isCurrent);
  if (error) throw error;
  const ids = (rows ?? []).map((row: any) => row.user_id).filter(Boolean);
  if (ids.length === 0) return [];
  const { data: profiles, error: profileError } = await currentChatRead(() => supabase
    .from('profiles_public').select('id, first_name_display, profile_photo_url').in('id', ids), isCurrent);
  if (profileError) throw profileError;
  return (profiles ?? []).map((profile: any) => ({
    id: profile.id, first_name: profile.first_name_display ?? null, avatar_url: profile.profile_photo_url ?? null,
  }));
}

// All joined members (no avatar-row cap) for the report sheet, self excluded.
async function fetchEventReportMembers(eventId: string, viewerId: string, isCurrent: () => boolean): Promise<{ id: string; name: string }[]> {
  const { data: memberRows, error: memberError } = await currentChatRead(() => supabase
    .from('event_members')
    .select('user_id')
    .eq('event_id', eventId)
    .eq('status', 'joined'), isCurrent);
  if (memberError) throw memberError;

  const userIds = (memberRows ?? []).map((m: any) => m.user_id as string).filter(Boolean);
  const otherIds = userIds.filter((uid) => uid !== viewerId);
  if (otherIds.length === 0) return [];

  const { data: profiles, error: profileError } = await currentChatRead(() => supabase
    .from('profiles_public')
    .select('id, first_name_display')
    .in('id', otherIds), isCurrent);
  if (profileError) throw profileError;

  return (profiles ?? []).map((p: any) => ({
    id: p.id as string,
    name: (p.first_name_display as string | null) ?? 'Unknown',
  }));
}

function formatEventDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

export default function PlanChatScreen() {
  const { id, reactionMessageId, reactionMessageSource } = useLocalSearchParams<{ id: string; reactionMessageId?: string; reactionMessageSource?: string }>();
  const router = useRouter();
  const viewer = useObservedUser();
  const readOwner = useMemo(() => ({ userId: viewer.viewerId, epoch: viewer.epoch, isCurrent: viewer.isCurrent }), [viewer.viewerId, viewer.epoch, viewer.isCurrent]);
  const [clockNow, setClockNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setClockNow(Date.now()), 30_000);
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') setClockNow(Date.now());
    });
    return () => { clearInterval(timer); subscription.remove(); };
  }, []);

  const { data: event, isError: eventError, isLoading: eventLoading, isFetching: eventFetching, refetch: refetchEvent } = useQuery({
    queryKey: ['event-info', id, readOwner.userId, readOwner.epoch],
    queryFn: () => currentChatRead(() => fetchEventInfo(id), readOwner.isCurrent),
    enabled: !!id && !!readOwner.userId && !viewer.isLoading && !viewer.error,
    staleTime: 60_000,
    retry: (failures, error) => !(error instanceof RequestDeadlineError) && failures < 2,
  });

  const { data: members, isError: memberError, isFetching: membersFetching, refetch: refetchMembers } = useQuery({
    queryKey: ['event-header-members', id, readOwner.userId, readOwner.epoch],
    queryFn: () => currentChatRead(() => fetchEventHeaderMembers(id, readOwner.isCurrent), readOwner.isCurrent),
    enabled: !!id && !!readOwner.userId && !viewer.isLoading && !viewer.error,
    staleTime: 60_000,
    retry: (failures, error) => !(error instanceof RequestDeadlineError) && failures < 2,
  });

  const { data: parentEvent, isError: parentError, isFetching: parentFetching, refetch: refetchParent } = useQuery({
    queryKey: ['chat-parent-event', event?.explore_event_id, readOwner.userId, readOwner.epoch],
    queryFn: async () => {
      const { data, error } = await currentChatRead(() => supabase
        .from('explore_events')
        .select('id, title')
        .eq('id', event!.explore_event_id!)
        .maybeSingle(), readOwner.isCurrent);
      if (error) throw error;
      return data;
    },
    enabled: !!event?.explore_event_id && !!readOwner.userId && !viewer.isLoading && !viewer.error,
    staleTime: 60_000,
    retry: (failures, error) => !(error instanceof RequestDeadlineError) && failures < 1,
  });

  const expiry = event ? getPlanChatExpiry(event.start_time, event.end_time) : null;
  const isPast = event ? event.status === 'cancelled' || (!!expiry && clockNow >= expiry.getTime()) : false;
  const hoursLeft = expiry ? Math.ceil((expiry.getTime() - clockNow) / (1000 * 60 * 60)) : 0;
  const showCountdown = !isPast && !!event && new Date(event.start_time).getTime() < clockNow && hoursLeft > 0;

  // Error / not-found gate lives here (not inside ChatThread) so the shared
  // component never conditionally skips its hook list.
  if (!id || viewer.isLoading || viewer.error || !readOwner.userId || !event) {
    const failed = !!viewer.error || eventError;
    return <ChatEntryState state={!id ? 'unavailable' : viewer.isLoading ? 'loading' : failed ? 'error' : eventLoading ? 'loading' : 'unavailable'}
      retrying={viewer.isLoading || eventFetching} onRetry={id && failed ? () => { if (viewer.error) void viewer.retry(); else void refetchEvent(); } : undefined} onBack={() => router.back()} />;
  }

  return (
    <ThreadComponent
      reactionMessageId={reactionMessageId} reactionMessageSource={reactionMessageSource}
      kind="event"
      id={id}
      title={event?.title ?? '...'}
      subtitle={event ? formatEventDate(event.start_time) : null}
      members={members ?? []}
      contextTitle={event?.title}
      viewContextLabel="View Plan"
      onViewContext={() => router.push(`/plan/${id}` as any)}
      locationLabel={event?.location_text}
      calendarAction={event ? { label: 'Add Plan to calendar', onPress: () => showAddToCalendar(event.title, event.start_time, event.end_time, event.location_text ?? undefined) } : undefined}
      headerMenu={{ type: 'report' }}
      readOnly={isPast ? { text: `This chat is read-only. ${event?.title ?? 'the plan'} has ended.` } : null}
      countdownText={showCountdown ? `chat stays active for ${hoursLeft} more hours` : null}
      fetchReportMembers={() => fetchEventReportMembers(id, readOwner.userId!, readOwner.isCurrent)}
      reportEventId={id}
      enablePresence
      renderHeaderBanner={event ? () => (
        <View>
          {eventError && <View style={styles.readRecovery}><Text style={styles.readRecoveryText}>Plan details couldn’t refresh. Your chat is still here.</Text><TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry Plan details" disabled={eventFetching} onPress={() => { void refetchEvent(); }} style={styles.readRecoveryAction}><Text style={styles.readRecoveryLink}>{eventFetching ? 'Checking…' : 'Try again'}</Text></TouchableOpacity></View>}
          {memberError && <View style={styles.readRecovery}><Text style={styles.readRecoveryText}>Member photos couldn’t load. Your chat is still here.</Text><TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry member photos" disabled={membersFetching} onPress={() => { void refetchMembers(); }} style={styles.readRecoveryAction}><Text style={styles.readRecoveryLink}>{membersFetching ? 'Checking…' : 'Try again'}</Text></TouchableOpacity></View>}
          {parentError && !parentEvent && <View style={styles.readRecovery}><Text style={styles.readRecoveryText}>Event details couldn’t load.</Text><TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry linked event" disabled={parentFetching} onPress={() => { void refetchParent(); }} style={styles.readRecoveryAction}><Text style={styles.readRecoveryLink}>{parentFetching ? 'Checking…' : 'Try again'}</Text></TouchableOpacity></View>}
          {!COMMUNITY_CHAT_GROUPING_ENABLED && <View style={styles.planContextBanner}>
            <View style={styles.planContextCopy}>
              <Text style={styles.planContextDate} numberOfLines={1}>{formatEventDate(event.start_time)}</Text>
              {!!event.location_text && <Text style={styles.planContextPlace} numberOfLines={1}>{event.location_text}</Text>}
            </View>
            <TouchableOpacity
              onPress={() => showAddToCalendar(event.title, event.start_time, event.end_time, event.location_text ?? undefined)}
              accessibilityRole="button"
              accessibilityLabel="Add Plan to calendar"
              style={styles.planContextCalendar}
            >
              <Ionicons name="calendar-outline" size={16} color={Colors.terracotta} />
              <Text style={styles.planContextCalendarText}>Add to calendar</Text>
            </TouchableOpacity>
          </View>}
          {parentEvent && (
            <TouchableOpacity
              style={styles.parentEventBanner}
              onPress={() => router.push(`/event/${parentEvent.id}` as never)}
              accessibilityRole="button"
              accessibilityLabel={`View event ${parentEvent.title}`}
            >
              <View style={styles.parentEventCopy}>
                <Text style={styles.parentEventLabel}>GOING TOGETHER</Text>
                <Text style={styles.parentEventTitle} numberOfLines={1}>{parentEvent.title}</Text>
              </View>
              <Text style={styles.parentEventAction}>View event</Text>
            </TouchableOpacity>
          )}
          {event?.tickets_url && (
            <TouchableOpacity style={styles.ticketBanner} onPress={() => openUrl(event.tickets_url!)}>
              <View style={styles.ticketLeft}>
                <Ionicons name="ticket-outline" size={16} color={Colors.terracotta} />
                <Text style={styles.ticketText}>Tickets available</Text>
              </View>
              <Text style={styles.ticketCta}>Get Tickets</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : undefined}
      renderPinnedFooter={!COMMUNITY_CHAT_GROUPING_ENABLED && event ? () => (
        <TouchableOpacity
          style={styles.pinnedCard}
          onPress={() => router.push(`/plan/${id}` as any)}
          activeOpacity={0.8}
        >
          <Text style={styles.pinnedTitle} numberOfLines={1}>{event.title}</Text>
          <View style={styles.pinnedRow}>
            <View style={styles.pinnedDetail}>
              <Ionicons name="calendar-outline" size={12} color={Colors.terracotta} />
              <Text style={styles.pinnedDetailText}>{formatEventDate(event.start_time)}</Text>
            </View>
          </View>
          <View style={styles.pinnedRow}>
            <Text style={styles.pinnedSpots}>
              {capDisplayCount(event.member_count)} going
            </Text>
          </View>
          {!isPast && (() => {
            const diff = new Date(event.start_time).getTime() - Date.now();
            const hours = Math.floor(diff / 3600000);
            const days = Math.floor(diff / 86400000);
            if (diff < 0) return null;
            const label = hours < 1 ? 'Starting soon!'
              : hours < 24 ? `Starts at ${new Date(event.start_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`
              : days === 1 ? 'Tomorrow!'
              : `Happening in ${days} days`;
            return <Text style={styles.pinnedCountdown}>{label}</Text>;
          })()}
        </TouchableOpacity>
      ) : undefined}
    />
  );
}

const styles = StyleSheet.create({
  readRecovery: { paddingHorizontal: 16, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.inputBg },
  readRecoveryText: { flex: 1, fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.textMedium },
  readRecoveryAction: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  readRecoveryLink: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Colors.terracotta },
  planContextBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingVertical: 9,
    backgroundColor: Colors.cardBg,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  planContextCopy: { flex: 1, gap: 2 },
  planContextDate: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.darkWarm },
  planContextPlace: { fontFamily: Fonts.sans, fontSize: FontSizes.caption, color: Colors.secondary },
  planContextCalendar: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 4 },
  planContextCalendarText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Colors.terracotta },
  parentEventBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: Colors.cardBg,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  parentEventCopy: { flex: 1, gap: 2 },
  parentEventLabel: { fontFamily: Fonts.sansBold, fontSize: FontSizes.caption, color: Colors.terracotta, letterSpacing: 1 },
  parentEventTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.darkWarm },
  parentEventAction: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Colors.terracotta },
  ticketBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: Colors.parchment,
    borderLeftWidth: 3,
    borderLeftColor: Colors.terracotta,
    borderBottomWidth: 1,
    borderBottomColor: Colors.inputBg,
  },
  ticketLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  ticketText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.asphalt },
  ticketCta: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Colors.terracotta },

  pinnedCard: {
    backgroundColor: Colors.cream,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 10,
    marginHorizontal: 16,
    marginBottom: 8,
    marginTop: 4,
  },
  pinnedTitle: {
    fontWeight: '700',
    fontSize: 14,
    color: Colors.darkWarm,
    marginBottom: 6,
  },
  pinnedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pinnedDetail: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  pinnedDetailText: {
    fontSize: 11,
    color: Colors.secondary,
  },
  pinnedSpots: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.secondary,
  },
  pinnedCountdown: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.terracotta,
    marginTop: 6,
  },
});
