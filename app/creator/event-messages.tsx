/**
 * Event messages hub (Build 35 Screen 06). The event-scoped landing point
 * Screen 06's own gap names: native had nothing here at all -- web already
 * has an attendee-message composer with no native equivalent. This hub is
 * the destination event-summary.tsx's messages row now points at instead of
 * showing a permanently disabled "coming soon" row.
 *
 * Delivery history and retry are missing on BOTH web and native today (the
 * delta matrix says so directly) -- there is nothing to port for that part,
 * since nothing sends yet (see lib/attendeeMessaging.ts's header: the real
 * send backend is still a draft, unapplied migration on the web repo). That
 * section here is an honest disabled state, the same "coming soon, stated
 * reason" pattern event-summary.tsx already uses for this exact screen,
 * rather than a fake empty list implying zero sends have happened.
 */

import React from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Bell, ChevronRight, History, SendHorizonal } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { EventSpacing } from '../../constants/EventDesign';
import { hapticLight } from '../../lib/haptics';
import { getOperatorEvent } from '../../lib/creatorEvents';
import { getEventAttendees } from '../../lib/ticketAttendees';
import { getEventRsvpGoingCount } from '../../lib/attendeeMessaging';

export default function EventMessagesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const { data: event, isLoading: eventLoading } = useQuery({
    queryKey: ['event-summary', id],
    queryFn: () => getOperatorEvent(id!),
    enabled: !!id,
    staleTime: 10_000,
  });
  const { data: seats = [] } = useQuery({
    queryKey: ['event-attendees', id],
    queryFn: () => getEventAttendees(id!),
    enabled: !!id,
    staleTime: 10_000,
  });
  const { data: rsvpGoing = 0 } = useQuery({
    queryKey: ['event-rsvp-going-count', id],
    queryFn: () => getEventRsvpGoingCount(id!),
    enabled: !!id,
    staleTime: 10_000,
  });

  const eligible = new Set(seats.map((s) => s.orderId)).size + rsvpGoing;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="back">
          <ArrowLeft size={22} color={Colors.asphalt} strokeWidth={2} />
        </TouchableOpacity>
        {/* copy to the taste gate */}
        <Text style={styles.headerTitle} numberOfLines={1}>messages</Text>
      </View>

      {eventLoading ? (
        <View style={styles.centered}><ActivityIndicator size="large" color={Colors.terracotta} /></View>
      ) : !event ? (
        <View style={styles.centered}><Text style={styles.empty}>couldn&apos;t find that event.</Text></View>
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.infoCard}>
            <Text style={styles.eventTitle} numberOfLines={1}>{event.title}</Text>
            <Text style={styles.eligibleLine}>
              {eligible} {eligible === 1 ? 'person is' : 'people are'} eligible for a message today
            </Text>
          </View>

          <TouchableOpacity
            style={styles.tabRow}
            onPress={() => { hapticLight(); router.push(`/creator/event-reminders?id=${id}` as never); }}
            accessibilityRole="button"
            accessibilityLabel="edit reminders"
          >
            <Bell size={20} color={Colors.terracotta} strokeWidth={2} />
            <View style={styles.tabTextGroup}>
              {/* copy to the taste gate */}
              <Text style={styles.tabLabel}>reminders</Text>
              <Text style={styles.tabSub}>automatic nudges before the event</Text>
            </View>
            <ChevronRight size={18} color={Colors.textLight} strokeWidth={2} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.tabRow}
            onPress={() => { hapticLight(); router.push(`/creator/attendee-message?id=${id}` as never); }}
            accessibilityRole="button"
            accessibilityLabel="new attendee message"
          >
            <SendHorizonal size={20} color={Colors.terracotta} strokeWidth={2} />
            <View style={styles.tabTextGroup}>
              {/* copy to the taste gate */}
              <Text style={styles.tabLabel}>new attendee message</Text>
              <Text style={styles.tabSub}>write once, reach everyone going</Text>
            </View>
            <ChevronRight size={18} color={Colors.textLight} strokeWidth={2} />
          </TouchableOpacity>

          <Text style={styles.sectionLabel}>delivery history</Text>
          <View style={[styles.tabRow, styles.tabRowDisabled]}>
            <History size={20} color={Colors.textLight} strokeWidth={2} />
            <View style={styles.tabTextGroup}>
              {/* copy to the taste gate -- honest, not a fake empty list */}
              <Text style={styles.tabLabelDisabled}>delivery history — coming soon</Text>
              <Text style={styles.tabSub}>sends, opens, and retries will show up here once sending is live</Text>
            </View>
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
  eventTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.asphalt },
  eligibleLine: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.textMedium },
  tabRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.white, borderRadius: 12, borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 14, minHeight: 56, paddingVertical: 10,
  },
  tabRowDisabled: { opacity: 0.6 },
  tabTextGroup: { flex: 1, gap: 2 },
  tabLabel: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.asphalt },
  tabLabelDisabled: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.textLight },
  tabSub: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.textMedium },
  sectionLabel: {
    fontFamily: Fonts.sansMedium, fontSize: FontSizes.caption, color: Colors.terracotta,
    textTransform: 'uppercase', letterSpacing: 1.5, marginTop: EventSpacing.sm,
  },
});
