import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { showAddToCalendar } from '../../../lib/addToCalendar';
import { openUrl } from '../../../lib/url';
import { capDisplayCount } from '../../../constants/GroupLimits';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';
import ChatThread, { ChatThreadMember } from '../../../components/chat/ChatThread';

// ─── Event header data ──────────────────────────────────────────────────────
// The plan-chat screen is a thin wrapper around the shared <ChatThread>: it
// resolves the event metadata + plan-specific chrome (ticket banner, pinned
// plan card, read-only/countdown copy) and hands the rest to the shared body.

interface EventInfo {
  id: string;
  title: string;
  start_time: string;
  status: string;
  tickets_url: string | null;
  member_count: number;
  members: ChatThreadMember[];
}

async function fetchEventInfo(eventId: string): Promise<EventInfo> {
  // Run event + member list in parallel -- both only need eventId
  const [eventResult, memberResult] = await Promise.all([
    supabase
      .from('events')
      .select('id, title, start_time, status, tickets_url, member_count')
      .eq('id', eventId)
      .maybeSingle(),
    supabase
      .from('event_members')
      .select('user_id')
      .eq('event_id', eventId)
      .eq('status', 'joined')
      .limit(6),
  ]);

  if (eventResult.error) throw eventResult.error;
  if (!eventResult.data) throw new Error('Event not found');
  const event = eventResult.data;
  const memberRows = memberResult.data;

  const userIds = (memberRows ?? []).map((m: any) => m.user_id).filter(Boolean);

  let members: EventInfo['members'] = [];
  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles_public')
      .select('id, first_name_display, profile_photo_url')
      .in('id', userIds);

    members = (profiles ?? []).map((p: any) => ({
      id: p.id,
      first_name: p.first_name_display ?? null,
      avatar_url: p.profile_photo_url ?? null,
    }));
  }

  return {
    id: event.id,
    title: event.title,
    start_time: event.start_time,
    status: (event as any).status ?? 'forming',
    tickets_url: (event as any).tickets_url ?? null,
    member_count: (event as any).member_count ?? 0,
    members,
  };
}

// All joined members (no avatar-row cap) for the report sheet, self excluded.
async function fetchEventReportMembers(eventId: string): Promise<{ id: string; name: string }[]> {
  const { data: { user } } = await supabase.auth.getUser();
  const { data: memberRows } = await supabase
    .from('event_members')
    .select('user_id')
    .eq('event_id', eventId)
    .eq('status', 'joined');

  const userIds = (memberRows ?? []).map((m: any) => m.user_id as string).filter(Boolean);
  const otherIds = userIds.filter((uid) => uid !== user?.id);
  if (otherIds.length === 0) return [];

  const { data: profiles } = await supabase
    .from('profiles_public')
    .select('id, first_name_display')
    .in('id', otherIds);

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
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const { data: event, isError: eventError } = useQuery({
    queryKey: ['event-info', id],
    queryFn: () => fetchEventInfo(id),
    enabled: !!id,
    staleTime: 60_000,
    retry: 2,
  });

  const isPast = event
    ? event.status === 'cancelled' || new Date(event.start_time) < new Date(Date.now() - 48 * 60 * 60 * 1000)
    : false;

  const hoursLeft = event
    ? Math.round(48 - ((Date.now() - new Date(event.start_time).getTime()) / (1000 * 60 * 60)))
    : 0;
  const showCountdown = !isPast && !!event && new Date(event.start_time) < new Date() && hoursLeft > 0;

  // Error / not-found gate lives here (not inside ChatThread) so the shared
  // component never conditionally skips its hook list.
  if (!id || eventError) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: Colors.parchment }} edges={['top', 'bottom']}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.textMedium }}>
            {eventError ? 'Could not load this chat' : 'Chat not found'}
          </Text>
          <TouchableOpacity
            onPress={() => router.back()}
            style={{ marginTop: 16, paddingHorizontal: 24, paddingVertical: 12, backgroundColor: Colors.terracotta, borderRadius: 14 }}
          >
            <Text style={{ fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.white }}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <ChatThread
      kind="event"
      id={id}
      title={event?.title ?? '...'}
      subtitle={event ? formatEventDate(event.start_time) : null}
      members={event?.members ?? []}
      contextTitle={event?.title}
      viewContextLabel="View Plan"
      onViewContext={() => router.push(`/plan/${id}` as any)}
      headerMenu={{ type: 'report' }}
      readOnly={isPast ? { text: `This chat is read-only. ${event?.title ?? 'the plan'} has ended.` } : null}
      countdownText={showCountdown ? `chat stays active for ${hoursLeft} more hours` : null}
      fetchReportMembers={() => fetchEventReportMembers(id)}
      reportEventId={id}
      enablePresence
      renderHeaderBanner={event?.tickets_url ? () => (
        <TouchableOpacity
          style={styles.ticketBanner}
          onPress={() => openUrl(event.tickets_url!)}
        >
          <View style={styles.ticketLeft}>
            <Ionicons name="ticket-outline" size={16} color={Colors.terracotta} />
            <Text style={styles.ticketText}>Tickets available</Text>
          </View>
          <Text style={styles.ticketCta}>Get Tickets</Text>
        </TouchableOpacity>
      ) : undefined}
      renderPinnedFooter={event ? () => (
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
            <TouchableOpacity
              onPress={() => showAddToCalendar(event.title, event.start_time)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.pinnedCalLink}>Add to Calendar</Text>
            </TouchableOpacity>
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
              : hours < 24 ? `Tonight at ${new Date(event.start_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`
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
  pinnedCalLink: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.terracotta,
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
