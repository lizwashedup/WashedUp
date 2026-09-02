/**
 * Event summary hub (Build 35 Screen 04, behind EVENT_SUMMARY_ENABLED).
 * The per-event landing point the delta matrix calls the structural
 * keystone: title/date/venue/status plus attendee and money snapshots, with
 * navigation into the existing Attendees and Money screens. Read-only here;
 * every mutation still happens on the screen that already owns it.
 *
 * Money is a separate parallel workstream's screen (07) -- this hub only
 * links to it, it does not render Money's own content. Messages (06) has
 * no send backend anywhere in this codebase yet (native or web -- web's
 * own composer header says so directly), so it shows as coming soon with a
 * stated reason instead of a button that would go nowhere.
 *
 * Built against today's host_user_id/community_id ownership pair. The
 * drafted owner_type/owner_id columns (migration 20260901010000) are not
 * applied to prod; this hub does not need them to be useful today, but
 * should get a follow-up pass once that migration lands.
 */

import React from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Users, DollarSign, MessageCircle, ChevronRight } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { EventSpacing } from '../../constants/EventDesign';
import { hapticLight } from '../../lib/haptics';
import { getOperatorEvent } from '../../lib/creatorEvents';
import { countAttendees, getEventAttendees, getEventMoneySummary } from '../../lib/ticketAttendees';
import { formatCents } from '../../lib/ticketing';

/** Simple, honest status line: the real stored status plus whether the date
 *  has passed. Not the richer on_sale/sold_out vocabulary in
 *  deriveEventState (lib/organizerHome.ts) -- that needs tier availability
 *  data this hub does not fetch. Wire that in later if this hub earns a
 *  richer status pill; showing a fake distinction today would be worse than
 *  showing less. */
export function summaryStatusLine(status: string, eventDate: string, nowISO: string = new Date().toISOString()): string {
  if (status === 'Cancelled') return 'cancelled';
  if (status === 'Archived') return 'archived';
  if (status === 'Completed') return 'completed';
  if (status === 'Draft') return 'draft';
  if (!eventDate) return 'scheduled';
  return eventDate < nowISO.slice(0, 10) ? 'ended' : 'scheduled';
}

export default function EventSummaryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const { data: event, isLoading: eventLoading } = useQuery({
    queryKey: ['event-summary', id],
    queryFn: () => getOperatorEvent(id!),
    enabled: !!id,
    staleTime: 10_000,
  });
  const { data: attendees = [] } = useQuery({
    queryKey: ['event-attendees', id],
    queryFn: () => getEventAttendees(id!),
    enabled: !!id,
    staleTime: 10_000,
  });
  const { data: money } = useQuery({
    queryKey: ['event-money-summary', id],
    queryFn: () => getEventMoneySummary(id!),
    enabled: !!id,
    staleTime: 10_000,
  });

  const counts = countAttendees(attendees);
  const statusLine = event ? summaryStatusLine(event.status, event.event_date) : '';

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="back">
          <ArrowLeft size={22} color={Colors.asphalt} strokeWidth={2} />
        </TouchableOpacity>
        {/* copy to the taste gate */}
        <Text style={styles.headerTitle} numberOfLines={1}>{event?.title || 'event summary'}</Text>
      </View>

      {eventLoading ? (
        <View style={styles.centered}><ActivityIndicator size="large" color={Colors.terracotta} /></View>
      ) : !event ? (
        <View style={styles.centered}><Text style={styles.empty}>couldn&apos;t find that event.</Text></View>
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.infoCard}>
            <Text style={styles.statusPill}>{statusLine}</Text>
            {!!event.event_date && <Text style={styles.infoLine}>{event.event_date}</Text>}
            {!!event.venue && <Text style={styles.infoLine} numberOfLines={1}>{event.venue}</Text>}
          </View>

          <View style={styles.countsRow}>
            <View style={styles.countCell}>
              <Text style={styles.countN}>{counts.sold}</Text>
              <Text style={styles.countL}>sold</Text>
            </View>
            <View style={styles.countCell}>
              <Text style={styles.countN}>{counts.checkedIn}</Text>
              <Text style={styles.countL}>checked in</Text>
            </View>
            <View style={styles.countCell}>
              <Text style={styles.countN}>{money ? formatCents(money.grossFaceCents) : '—'}</Text>
              <Text style={styles.countL}>gross</Text>
            </View>
          </View>

          <TouchableOpacity
            style={styles.tabRow}
            onPress={() => { hapticLight(); router.push(`/creator/attendees?id=${id}` as never); }}
            accessibilityRole="button"
            accessibilityLabel="open attendees"
          >
            <Users size={20} color={Colors.terracotta} strokeWidth={2} />
            {/* copy to the taste gate */}
            <Text style={styles.tabLabel}>attendees</Text>
            <ChevronRight size={18} color={Colors.textLight} strokeWidth={2} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.tabRow}
            onPress={() => { hapticLight(); router.push(`/creator/event-money?id=${id}` as never); }}
            accessibilityRole="button"
            accessibilityLabel="open money"
          >
            <DollarSign size={20} color={Colors.terracotta} strokeWidth={2} />
            {/* copy to the taste gate */}
            <Text style={styles.tabLabel}>money</Text>
            <ChevronRight size={18} color={Colors.textLight} strokeWidth={2} />
          </TouchableOpacity>

          <View style={[styles.tabRow, styles.tabRowDisabled]}>
            <MessageCircle size={20} color={Colors.textLight} strokeWidth={2} />
            {/* copy to the taste gate -- honest, not a fake working button */}
            <Text style={styles.tabLabelDisabled}>messages — coming soon</Text>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, gap: 12 },
  headerTitle: { flex: 1, fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.asphalt },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.textMedium, textAlign: 'center' },
  body: { paddingHorizontal: 20, paddingBottom: 40, gap: EventSpacing.md },
  infoCard: {
    backgroundColor: Colors.white, borderRadius: 12, borderWidth: 1, borderColor: Colors.border,
    padding: 14, gap: 4,
  },
  statusPill: {
    alignSelf: 'flex-start', fontFamily: Fonts.sansMedium, fontSize: FontSizes.caption,
    color: Colors.terracotta, textTransform: 'uppercase', letterSpacing: 0.5,
  },
  infoLine: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.textMedium },
  countsRow: { flexDirection: 'row', gap: EventSpacing.md },
  countCell: { flex: 1, backgroundColor: Colors.white, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, paddingVertical: 10, alignItems: 'center' },
  countN: { fontFamily: Fonts.displayBold, fontSize: FontSizes.displayMD, color: Colors.asphalt },
  countL: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.caption, color: Colors.textMedium, textTransform: 'uppercase', letterSpacing: 0.5 },
  tabRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.white, borderRadius: 12, borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 14, minHeight: 52,
  },
  tabRowDisabled: { opacity: 0.6 },
  tabLabel: { flex: 1, fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.asphalt },
  tabLabelDisabled: { flex: 1, fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.textLight },
});
