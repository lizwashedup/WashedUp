/**
 * Attendee-message composer (Build 35 Screen 61). Web already has this
 * (src/components/communities/creator/AttendeeMessageComposer.tsx); this is
 * "the entire native half" the delta matrix names as the gap, built to the
 * same audience rules and voice, plus the pre-send review PDF acceptance 25
 * asks for: "the pre-send review names the event, exact recipient count,
 * eligible channels, and excluded audiences."
 *
 * Recipient counting reuses the exact filter predicates
 * app/creator/attendees.tsx already ships (via lib/attendeeMessaging.ts),
 * so this screen's numbers always agree with the real attendee list. RSVPs
 * (going, no ticket) are folded in only when no filter narrows the
 * audience, mirroring web's own resolveRecipientUserIds rule.
 *
 * SEND IS NOT WIRED HERE ON PURPOSE. The real send backend
 * (attendee_message_sends, the daily cap, opt-out enforcement) is still a
 * DRAFT migration in the web repo, explicitly marked "DO NOT APPLY WITHOUT
 * JOSH'S WORD," and its own ATTENDEE_MESSAGE_SEND_ENABLED flag defaults off
 * even on web today. Duplicating that safety-critical logic into a second
 * codebase here is exactly what that file's own comments say it was built
 * to avoid. So the review screen is real (live counts, a genuine pre-send
 * summary), and "send" is honest that sending isn't open yet -- the same
 * "the button never lies" rule event-summary.tsx and web's composer both
 * already follow -- rather than a fake success message.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { MESSAGE_TEST_SEND_ENABLED } from '../../constants/FeatureFlags';
import { Fonts, FontSizes } from '../../constants/Typography';
import { EventSpacing } from '../../constants/EventDesign';
import { hapticLight } from '../../lib/haptics';
import { getOperatorEvent } from '../../lib/creatorEvents';
import { getEventAttendees } from '../../lib/ticketAttendees';
import {
  countMessageRecipients,
  EMPTY_FILTER,
  ESSENTIAL_REASONS,
  ESSENTIAL_REASON_LABEL,
  getEventRsvpGoingCount,
  loadDraft,
  MANUAL_MESSAGE_DAILY_CAP,
  MESSAGE_BODY_MAX,
  MESSAGE_SUBJECT_MAX,
  saveDraft,
  sendAttendeeMessageTestToSelf,
  type EssentialReason,
  type MessageKind,
  type SeatFilter,
} from '../../lib/attendeeMessaging';

interface DraftState {
  subject: string;
  body: string;
  replyTo: string;
  audience: SeatFilter;
  kind: MessageKind;
  essentialReason: EssentialReason | null;
}

const EMPTY_DRAFT: DraftState = {
  subject: '',
  body: '',
  replyTo: '',
  audience: EMPTY_FILTER,
  kind: 'promotional',
  essentialReason: null,
};

/** Human sentence for what the current filter leaves out, for the pre-send
 *  review's "excluded audiences" line (acceptance 25). Pure and testable. */
export function describeExclusions(filter: SeatFilter): string {
  const parts: string[] = [];
  if (filter.checkedIn === 'in') parts.push('not-yet-checked-in guests');
  if (filter.checkedIn === 'out') parts.push('already-checked-in guests');
  if (filter.refunded === 'no') parts.push('refunded guests');
  if (filter.refunded === 'yes') parts.push('non-refunded guests');
  if (filter.tier) parts.push(`everyone outside "${filter.tier}"`);
  return parts.length > 0 ? parts.join(', ') : 'no one -- everyone eligible is included';
}

export default function AttendeeMessageScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const draftKey = `attendee-message-draft:${id ?? ''}`;

  const [reviewing, setReviewing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [d, setD] = useState<DraftState>(EMPTY_DRAFT);
  const [testSending, setTestSending] = useState(false);
  const [testSent, setTestSent] = useState(false);

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

  useEffect(() => {
    if (!id) return;
    (async () => {
      const saved = await loadDraft<DraftState>(draftKey);
      if (saved) setD({ ...EMPTY_DRAFT, ...saved });
      setLoaded(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!loaded || !id) return;
    saveDraft(draftKey, d);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, loaded, id]);

  const set = (patch: Partial<DraftState>) => setD((prev) => ({ ...prev, ...patch }));
  const setAudience = (patch: Partial<SeatFilter>) => setD((prev) => ({ ...prev, audience: { ...prev.audience, ...patch } }));

  const tiers = useMemo(
    () => Array.from(new Set(seats.map((s) => s.tierName).filter((t): t is string => !!t))),
    [seats],
  );
  const recipientCount = useMemo(
    () => countMessageRecipients(seats, d.audience, rsvpGoing),
    [seats, d.audience, rsvpGoing],
  );

  const canReview =
    d.subject.trim() !== '' &&
    d.body.trim() !== '' &&
    (d.kind === 'promotional' || !!d.essentialReason);

  const goToReview = () => {
    if (!canReview) return;
    hapticLight();
    setReviewing(true);
  };

  const handleSend = () => {
    hapticLight();
    /* copy to the taste gate -- the button never lies about what it can do */
    Alert.alert(
      "sending isn't open yet",
      'your message is saved as a draft. we’ll turn on sending once the last setup is done, and nothing goes out before then.',
    );
  };

  const handleSendTest = async () => {
    if (testSending || !id) return;
    hapticLight();
    setTestSending(true);
    try {
      await sendAttendeeMessageTestToSelf(id, d.subject, d.body);
      setTestSent(true);
      setTimeout(() => setTestSent(false), 2500);
    } catch (e) {
      Alert.alert('could not send test', e instanceof Error ? e.message : 'try again.');
    } finally {
      setTestSending(false);
    }
  };

  if (eventLoading) {
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

  if (reviewing) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setReviewing(false)} hitSlop={12} accessibilityRole="button" accessibilityLabel="back to editing">
            <ArrowLeft size={22} color={Colors.asphalt} strokeWidth={2} />
          </TouchableOpacity>
          {/* copy to the taste gate */}
          <Text style={styles.headerTitle}>review before sending</Text>
        </View>
        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.reviewCard}>
            <Text style={styles.reviewRowLabel}>event</Text>
            <Text style={styles.reviewRowValue} numberOfLines={2}>{event.title}</Text>
          </View>
          <View style={styles.reviewCard}>
            <Text style={styles.reviewRowLabel}>sender</Text>
            <Text style={styles.reviewRowValue}>washedup, on your behalf -- replies land at {d.replyTo.trim() || 'your account email'}</Text>
          </View>
          <View style={styles.reviewCard}>
            <Text style={styles.reviewRowLabel}>recipients</Text>
            <Text style={styles.reviewRowValue}>{recipientCount} {recipientCount === 1 ? 'person' : 'people'} eligible today</Text>
            <Text style={styles.reviewRowSub}>excludes {describeExclusions(d.audience)}</Text>
            <Text style={styles.reviewRowSub}>anyone who opted out of messages for this event will be excluded automatically once sending opens</Text>
          </View>
          <View style={styles.reviewCard}>
            <Text style={styles.reviewRowLabel}>channels</Text>
            <Text style={styles.reviewRowValue}>push -- delivered today once sending opens</Text>
            <Text style={styles.reviewRowSub}>email: pending setup, not sent yet</Text>
            <Text style={styles.reviewRowSub}>SMS-eligible: 0 -- texting isn&apos;t available yet</Text>
          </View>
          <View style={styles.reviewCard}>
            <Text style={styles.reviewRowLabel}>timing</Text>
            <Text style={styles.reviewRowValue}>sends right away once sending opens</Text>
            <Text style={styles.reviewRowSub}>scheduled sending isn&apos;t available yet</Text>
          </View>
          <View style={styles.reviewCard}>
            <Text style={styles.reviewRowLabel}>{d.kind === 'essential' ? 'essential update' : 'regular update'}</Text>
            {d.kind === 'essential' && d.essentialReason && (
              <Text style={styles.reviewRowSub}>reason: {ESSENTIAL_REASON_LABEL[d.essentialReason]}</Text>
            )}
            <Text style={styles.reviewRowValue} numberOfLines={1}>{d.subject}</Text>
            <Text style={styles.reviewRowSub}>{d.body}</Text>
          </View>

          <View style={styles.heldBanner}>
            {/* copy to the taste gate */}
            <Text style={styles.heldBannerTitle}>sending isn&apos;t open yet</Text>
            <Text style={styles.heldBannerBody}>this draft saves on your device. we&apos;ll turn sending on once the last setup is done.</Text>
          </View>

          {MESSAGE_TEST_SEND_ENABLED && (
            <TouchableOpacity
              style={[styles.secondaryButton, testSending && styles.secondaryButtonDisabled]}
              onPress={handleSendTest}
              disabled={testSending}
              accessibilityRole="button"
              accessibilityLabel="send a test to yourself"
              accessibilityState={{ disabled: testSending, busy: testSending }}
            >
              {/* copy to the taste gate. Founder button-label rule: 1-3 words,
                  never wraps -- accessibilityLabel above stays fully descriptive
                  for screen readers since that rule is about rendered/visual
                  wrap, not spoken text. */}
              <Text style={styles.secondaryButtonText}>
                {testSent ? 'sent to you' : testSending ? 'sending…' : 'test to me'}
              </Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.primaryButton} onPress={handleSend} accessibilityRole="button" accessibilityLabel="send">
            <Text style={styles.primaryButtonText}>send</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.avoider}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="back">
            <ArrowLeft size={22} color={Colors.asphalt} strokeWidth={2} />
          </TouchableOpacity>
          {/* copy to the taste gate */}
          <Text style={styles.headerTitle} numberOfLines={1}>new attendee message</Text>
        </View>
        <Pressable style={styles.flexFill} onPress={Keyboard.dismiss}>
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <Text style={styles.eventNameLine} numberOfLines={1}>{event.title}</Text>

            <Text style={styles.label}>what kind of message is this</Text>
            <View style={styles.chipsRow}>
              <TouchableOpacity
                style={[styles.chip, d.kind === 'promotional' && styles.chipOn]}
                onPress={() => { hapticLight(); set({ kind: 'promotional', essentialReason: null }); }}
                accessibilityRole="button"
                accessibilityState={{ selected: d.kind === 'promotional' }}
              >
                <Text style={[styles.chipText, d.kind === 'promotional' && styles.chipTextOn]}>regular update</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.chip, d.kind === 'essential' && styles.chipOn]}
                onPress={() => { hapticLight(); set({ kind: 'essential', essentialReason: d.essentialReason ?? 'cancellation' }); }}
                accessibilityRole="button"
                accessibilityState={{ selected: d.kind === 'essential' }}
              >
                <Text style={[styles.chipText, d.kind === 'essential' && styles.chipTextOn]}>essential update</Text>
              </TouchableOpacity>
            </View>
            {d.kind === 'essential' ? (
              <>
                <View style={styles.chipsRow}>
                  {ESSENTIAL_REASONS.map((r) => (
                    <TouchableOpacity
                      key={r}
                      style={[styles.chip, d.essentialReason === r && styles.chipOn]}
                      onPress={() => { hapticLight(); set({ essentialReason: r }); }}
                      accessibilityRole="button"
                      accessibilityState={{ selected: d.essentialReason === r }}
                    >
                      <Text style={[styles.chipText, d.essentialReason === r && styles.chipTextOn]}>{ESSENTIAL_REASON_LABEL[r]}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={styles.hint}>essential updates reach everyone, even people who opted out, and won&apos;t count against your daily limit.</Text>
              </>
            ) : (
              <Text style={styles.hint}>up to {MANUAL_MESSAGE_DAILY_CAP} regular updates per event per day. people who opted out won&apos;t get this one.</Text>
            )}

            <Text style={styles.label}>who gets it</Text>
            {tiers.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
                <TouchableOpacity
                  style={[styles.chip, !d.audience.tier && styles.chipOn]}
                  onPress={() => { hapticLight(); setAudience({ tier: null }); }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: !d.audience.tier }}
                >
                  <Text style={[styles.chipText, !d.audience.tier && styles.chipTextOn]}>all tiers</Text>
                </TouchableOpacity>
                {tiers.map((t) => (
                  <TouchableOpacity
                    key={t}
                    style={[styles.chip, d.audience.tier === t && styles.chipOn]}
                    onPress={() => { hapticLight(); setAudience({ tier: d.audience.tier === t ? null : t }); }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: d.audience.tier === t }}
                  >
                    <Text style={[styles.chipText, d.audience.tier === t && styles.chipTextOn]}>{t}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
            <View style={styles.chipsRow}>
              {(['all', 'in', 'out'] as const).map((v) => (
                <TouchableOpacity
                  key={v}
                  style={[styles.chip, d.audience.checkedIn === v && styles.chipOn]}
                  onPress={() => { hapticLight(); setAudience({ checkedIn: v }); }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: d.audience.checkedIn === v }}
                >
                  <Text style={[styles.chipText, d.audience.checkedIn === v && styles.chipTextOn]}>
                    {v === 'all' ? 'everyone' : v === 'in' ? 'checked in' : 'not checked in'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.chipsRow}>
              {(['all', 'no', 'yes'] as const).map((v) => (
                <TouchableOpacity
                  key={v}
                  style={[styles.chip, d.audience.refunded === v && styles.chipOn]}
                  onPress={() => { hapticLight(); setAudience({ refunded: v }); }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: d.audience.refunded === v }}
                >
                  <Text style={[styles.chipText, d.audience.refunded === v && styles.chipTextOn]}>
                    {v === 'all' ? 'refunded or not' : v === 'no' ? 'not refunded' : 'refunded'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.recipientLine} accessibilityLiveRegion="polite">
              {recipientCount} {recipientCount === 1 ? 'person' : 'people'} will get this.
            </Text>

            <Text style={styles.label}>subject</Text>
            <TextInput
              style={styles.input}
              value={d.subject}
              onChangeText={(v) => set({ subject: v })}
              placeholder="a quick note about saturday"
              placeholderTextColor={Colors.textLight}
              maxLength={MESSAGE_SUBJECT_MAX}
            />

            <Text style={styles.label}>your note</Text>
            <TextInput
              style={[styles.input, styles.inputMultiline]}
              value={d.body}
              onChangeText={(v) => set({ body: v })}
              placeholder="what do they need to know?"
              placeholderTextColor={Colors.textLight}
              multiline
              maxLength={MESSAGE_BODY_MAX}
            />

            <Text style={styles.label}>where replies go (optional)</Text>
            <TextInput
              style={styles.input}
              value={d.replyTo}
              onChangeText={(v) => set({ replyTo: v })}
              placeholder="you@yourvenue.com"
              placeholderTextColor={Colors.textLight}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              maxLength={200}
            />
            <Text style={styles.hint}>washedup sends it; replies land here. attendees&apos; addresses stay private.</Text>

            <TouchableOpacity
              style={[styles.primaryButton, !canReview && styles.primaryButtonDisabled]}
              disabled={!canReview}
              onPress={goToReview}
              accessibilityRole="button"
              accessibilityLabel="review before sending"
            >
              <Text style={styles.primaryButtonText}>review & send</Text>
            </TouchableOpacity>
          </ScrollView>
        </Pressable>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  avoider: { flex: 1 },
  flexFill: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, gap: 12 },
  headerTitle: { flex: 1, fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.asphalt },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.textMedium, textAlign: 'center' },
  body: { paddingHorizontal: 20, paddingBottom: 40 },
  eventNameLine: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.textMedium, marginBottom: EventSpacing.sm },
  label: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.textMedium, marginTop: 14, marginBottom: 6 },
  hint: { fontFamily: Fonts.sans, fontSize: FontSizes.caption, color: Colors.textLight, marginTop: 6 },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingBottom: 4 },
  chip: { borderRadius: 999, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.white, paddingHorizontal: 14, paddingVertical: 8, minHeight: 36, justifyContent: 'center' },
  chipOn: { backgroundColor: Colors.terracotta, borderColor: Colors.terracotta },
  chipText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.darkWarm },
  chipTextOn: { color: Colors.white },
  recipientLine: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.asphalt, marginTop: 10 },
  input: {
    backgroundColor: Colors.inputBg,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
  },
  inputMultiline: { minHeight: 140, textAlignVertical: 'top' },
  primaryButton: {
    backgroundColor: Colors.terracotta, borderRadius: 999, paddingVertical: 14,
    alignItems: 'center', marginTop: EventSpacing.lg,
  },
  primaryButtonDisabled: { opacity: 0.5 },
  primaryButtonText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.white },
  secondaryButton: {
    backgroundColor: 'transparent', borderWidth: 1.5, borderColor: Colors.terracotta, borderRadius: 999,
    paddingVertical: 14, alignItems: 'center', marginTop: EventSpacing.sm,
  },
  secondaryButtonDisabled: { opacity: 0.5 },
  secondaryButtonText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.terracotta },
  reviewCard: {
    backgroundColor: Colors.white, borderRadius: 12, borderWidth: 1, borderColor: Colors.border,
    padding: 14, gap: 4, marginBottom: EventSpacing.sm,
  },
  reviewRowLabel: {
    fontFamily: Fonts.sansMedium, fontSize: FontSizes.caption, color: Colors.terracotta,
    textTransform: 'uppercase', letterSpacing: 1,
  },
  reviewRowValue: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.asphalt },
  reviewRowSub: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.textMedium },
  heldBanner: {
    borderRadius: 12, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.inputBg,
    padding: 14, marginTop: EventSpacing.sm, gap: 4,
  },
  heldBannerTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Colors.asphalt },
  heldBannerBody: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.textMedium },
});
