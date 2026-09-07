/**
 * Reminder settings (Build 35 Screen 60). Appendix C.4.13: "the creator sees
 * each reminder as audience + timing + channels ... requires SMS consent,
 * and keeps delivery history." Delivery primitives already exist (the
 * OneSignal push pipeline follower broadcasts use), but there was no
 * creator-facing scheduling surface for event reminders anywhere in this
 * codebase before this screen -- confirmed by a real search, not assumed:
 * no reminder-scheduling table or RPC exists in supabase/migrations, and no
 * SMS feature flag exists in constants/FeatureFlags.ts.
 *
 * Building a real, live, scheduled-send pipeline for this (a new pg_cron
 * job, a new worker) is real backend infrastructure work outside a
 * creator-UI screen's safe scope, especially in a codebase where the
 * existing, more mature delivery pipeline (the free-RSVP confirmation
 * outbox) is still deliberately gated behind Josh's own multi-stage
 * G0-G8 rollout and sits "quarantined" as of the last recorded gate
 * (2026-08-31). So this screen is the real, honest settings surface: exact
 * copy previews from Appendix C.8.4/C.8.5, a live audience count, and a
 * local draft -- with a stated reason instead of a toggle that would quietly
 * do nothing, matching the same "the button never lies" rule already used
 * on this screen's own hub (event-messages.tsx) and its sibling composer.
 *
 * SMS ships visibly disabled with a reason, never as a working toggle, per
 * this screen's own named gap and the Master Plan's PBC/EIN law.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, History } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { EventSpacing } from '../../constants/EventDesign';
import { hapticLight } from '../../lib/haptics';
import { getOperatorEvent } from '../../lib/creatorEvents';
import { getEventAttendees } from '../../lib/ticketAttendees';
import { getEventRsvpGoingCount, loadDraft, saveDraft } from '../../lib/attendeeMessaging';

interface ReminderDraft {
  dayBeforeOn: boolean;
  dayOfOn: boolean;
}

const EMPTY_DRAFT: ReminderDraft = { dayBeforeOn: true, dayOfOn: true };

export default function EventRemindersScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const draftKey = `event-reminders-draft:${id ?? ''}`;
  const [loaded, setLoaded] = useState(false);
  const [d, setD] = useState<ReminderDraft>(EMPTY_DRAFT);
  const [justSaved, setJustSaved] = useState(false);

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
  const eligible = useMemo(() => new Set(seats.map((s) => s.orderId)).size + rsvpGoing, [seats, rsvpGoing]);

  useEffect(() => {
    if (!id) return;
    (async () => {
      const saved = await loadDraft<ReminderDraft>(draftKey);
      if (saved) setD({ ...EMPTY_DRAFT, ...saved });
      setLoaded(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handleSave = async () => {
    hapticLight();
    await saveDraft(draftKey, d);
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 2500);
  };

  if (eventLoading || !loaded) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.centered}><ActivityIndicator size="large" color={Colors.terracotta} /></View>
      </SafeAreaView>
    );
  }
  if (!event) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.centered}><Text style={styles.empty}>couldn&apos;t find that event.</Text></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="back">
          <ArrowLeft size={22} color={Colors.asphalt} strokeWidth={2} />
        </TouchableOpacity>
        {/* copy to the taste gate */}
        <Text style={styles.headerTitle} numberOfLines={1}>reminders</Text>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.infoCard}>
          <Text style={styles.eventTitle} numberOfLines={1}>{event.title}</Text>
          <Text style={styles.eligibleLine}>{eligible} {eligible === 1 ? 'person' : 'people'} eligible for reminders</Text>
        </View>

        <View style={styles.reminderCard}>
          <View style={styles.reminderHeaderRow}>
            {/* copy to the taste gate */}
            <Text style={styles.reminderTitle}>the day-before reminder</Text>
            <Switch
              value={d.dayBeforeOn}
              onValueChange={(v) => { hapticLight(); setD((prev) => ({ ...prev, dayBeforeOn: v })); }}
              trackColor={{ false: Colors.borderWarm, true: Colors.brand }}
              thumbColor={Colors.white}
            />
          </View>
          <Text style={styles.reminderTiming}>about 24 hours before the event starts</Text>
          <View style={styles.previewBox}>
            <Text style={styles.previewLabel}>preview</Text>
            <Text style={styles.previewBody}>
              &quot;We&apos;ll see you tomorrow. Doors open at [doors time]; the event begins at [start time]. [your note, if any]&quot;
            </Text>
          </View>
          <ChannelRow />
        </View>

        <View style={styles.reminderCard}>
          <View style={styles.reminderHeaderRow}>
            {/* copy to the taste gate */}
            <Text style={styles.reminderTitle}>the day-of reminder</Text>
            <Switch
              value={d.dayOfOn}
              onValueChange={(v) => { hapticLight(); setD((prev) => ({ ...prev, dayOfOn: v })); }}
              trackColor={{ false: Colors.borderWarm, true: Colors.brand }}
              thumbColor={Colors.white}
            />
          </View>
          <Text style={styles.reminderTiming}>about 2 hours before the event starts</Text>
          <View style={styles.previewBox}>
            <Text style={styles.previewLabel}>preview</Text>
            <Text style={styles.previewBody}>
              &quot;[event name] starts at [start time]. Open your ticket and directions.&quot;
            </Text>
          </View>
          <ChannelRow />
        </View>

        <Text style={styles.sectionLabel}>consent coverage</Text>
        <View style={styles.infoCard}>
          <Text style={styles.consentLine}>email and push are transactional -- covered for everyone eligible, never blocked by a marketing opt-out.</Text>
          <Text style={styles.consentLine}>texting isn&apos;t available yet, so no one is SMS-eligible today.</Text>
        </View>

        <Text style={styles.sectionLabel}>delivery history</Text>
        <View style={[styles.tabRow, styles.tabRowDisabled]}>
          <History size={20} color={Colors.textLight} strokeWidth={2} />
          <View style={styles.tabTextGroup}>
            {/* copy to the taste gate -- honest, not a fake empty list */}
            <Text style={styles.tabLabelDisabled}>delivery history — coming soon</Text>
            <Text style={styles.tabSub}>send times and outcomes will show up here once scheduling is live</Text>
          </View>
        </View>

        <View style={styles.heldBanner}>
          {/* copy to the taste gate */}
          <Text style={styles.heldBannerTitle}>automatic sending isn&apos;t on yet</Text>
          <Text style={styles.heldBannerBody}>these preferences save on your device now, so nothing is lost -- we&apos;ll turn on real scheduled sending once that setup is done.</Text>
        </View>

        <TouchableOpacity style={styles.primaryButton} onPress={handleSave} accessibilityRole="button" accessibilityLabel="save reminder preferences">
          <Text style={styles.primaryButtonText}>{justSaved ? 'saved' : 'save'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function ChannelRow() {
  return (
    <View style={styles.channelRow}>
      <Text style={styles.channelOn}>push: on</Text>
      <Text style={styles.channelOff}>SMS: not available yet</Text>
    </View>
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
  reminderCard: {
    backgroundColor: Colors.white, borderRadius: 12, borderWidth: 1, borderColor: Colors.border,
    padding: 14, gap: 8,
  },
  reminderHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  reminderTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.asphalt },
  reminderTiming: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.textMedium },
  previewBox: { backgroundColor: Colors.inputBg, borderRadius: 10, padding: 10, gap: 4 },
  previewLabel: {
    fontFamily: Fonts.sansMedium, fontSize: FontSizes.caption, color: Colors.terracotta,
    textTransform: 'uppercase', letterSpacing: 1,
  },
  previewBody: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.darkWarm, fontStyle: 'italic' },
  channelRow: { flexDirection: 'row', gap: 14 },
  channelOn: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.asphalt },
  channelOff: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.textLight },
  sectionLabel: {
    fontFamily: Fonts.sansMedium, fontSize: FontSizes.caption, color: Colors.terracotta,
    textTransform: 'uppercase', letterSpacing: 1.5,
  },
  consentLine: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.textMedium },
  tabRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.white, borderRadius: 12, borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 14, minHeight: 56, paddingVertical: 10,
  },
  tabRowDisabled: { opacity: 0.6 },
  tabTextGroup: { flex: 1, gap: 2 },
  tabLabelDisabled: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.textLight },
  tabSub: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.textMedium },
  heldBanner: {
    borderRadius: 12, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.inputBg,
    padding: 14, gap: 4,
  },
  heldBannerTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Colors.asphalt },
  heldBannerBody: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.textMedium },
  primaryButton: {
    backgroundColor: Colors.terracotta, borderRadius: 999, paddingVertical: 14,
    alignItems: 'center',
  },
  primaryButtonText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.white },
});
