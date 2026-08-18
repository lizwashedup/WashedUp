/**
 * C2 - order complete (doc 78 §4, doc 79 C2). A ticket reads as a moment of
 * arrival, not a receipt. Then it asks the organizer's buyer questions
 * IN-SESSION with one gentle skip (the elevation commitment, doc 61 §4b).
 *
 * Answers are PER SEAT (Cowork 2026-07-26): a per_attendee question is asked
 * once for every ticket in the order (attendee_index = the seat's
 * position_index, 1..qty); a per_order question is asked once (attendee_index
 * NULL). recordAnswer enforces that and reports failures, which this screen
 * surfaces rather than swallows. Value shapes are the canonical set in
 * lib/ticketing (web's reader reads the same rows). Six types (§3.8).
 *
 * Scene design spec item 05 (creator-branded ticketing, launch priority per
 * Liz): a buyer can land here with ANY order status, not just a fresh paid
 * one - app/(tabs)/_layout.tsx routes here unconditionally off a stashed
 * pending-checkout id on app resume, whether the Stripe visit finished, was
 * abandoned, or the webhook is still catching up. resolveOrderViewState
 * (lib/ticketing) is the one place that reads the order's real status
 * (pending/paid/canceled/refunded) into what this screen actually shows,
 * replacing the old ad hoc "settling" seats-only guess. The event band
 * carries the event's image + creator byline through every one of those
 * states, not just the happy path.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Check } from 'lucide-react-native';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';
import { EventAction, EventSpacing, EventSurface } from '../../../constants/EventDesign';
import { hapticLight, hapticSuccess, hapticError } from '../../../lib/haptics';
import { logError } from '../../../lib/logger';
import { formatEventDateLA } from '../../../lib/laDate';
import { getOrganizerProfiles } from '../../../lib/organizerProfile';
import {
  getConfirmationMessage,
  getOrder,
  getQuestions,
  recordAnswer,
  resolveOrderViewState,
  type MyOrder,
} from '../../../lib/ticketing';
import {
  QuestionForm,
  cellKey,
  collectCells,
  type AnswerDraft,
  type AnswerRaw,
  type Seat,
} from '../../../components/tickets/QuestionForm';

// appendix: "the gold confirmation bloom is approximately 600ms on
// successful purchase confirmation" - a different, more specific moment
// than EventMotion.published (900ms, "your event is live"), so this is its
// own local timing rather than a repurpose of that token.
const CONFIRM_BLOOM_MS = 600;
// a purely local patience threshold before a still-pending order offers the
// support/recovery affordance inline. Not a real hold-expiry countdown (law
// 10 bans fake countdowns) - just "you've waited a while, here's a person."
const PENDING_PATIENCE_MS = 75_000;

/**
 * Reduce Motion, mirrored locally rather than importing
 * components/yours/a11y/useReduceMotion.ts - that hook's own header comment
 * scopes it deliberately to components/yours/* only, and ticketing isn't
 * part of that surface.
 */
function useReduceMotionLocal(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => { if (mounted) setReduce(v); }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => setReduce(v));
    return () => { mounted = false; sub.remove(); };
  }, []);
  return reduce;
}

/** The checkmark badge + its one signature success beat: a warm gold bloom
 *  (Colors.goingConfirmedFill, the same fill this app already uses for every
 *  other "confirmed" affirmation) that expands and fades behind the badge as
 *  it scales in. Mounts exactly once, the moment the screen first reaches
 *  the 'ready' state, so the effect below is correct with an empty dep array
 *  rather than needing a fired-once guard. */
function ConfirmBadge({ reduceMotion }: { reduceMotion: boolean }) {
  const scale = useSharedValue(reduceMotion ? 1 : 0.7);
  const opacity = useSharedValue(reduceMotion ? 1 : 0);
  const bloomScale = useSharedValue(0.6);
  const bloomOpacity = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) return;
    scale.value = withTiming(1, { duration: CONFIRM_BLOOM_MS, easing: Easing.out(Easing.cubic) });
    opacity.value = withTiming(1, { duration: CONFIRM_BLOOM_MS * 0.6 });
    bloomOpacity.value = 0.55;
    bloomScale.value = 0.6;
    bloomScale.value = withTiming(1.7, { duration: CONFIRM_BLOOM_MS, easing: Easing.out(Easing.cubic) });
    bloomOpacity.value = withTiming(0, { duration: CONFIRM_BLOOM_MS });
    // mount-once beat: reanimated shared values are stable refs, not state
  }, []);

  const badgeStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }], opacity: opacity.value }));
  const bloomStyle = useAnimatedStyle(() => ({ transform: [{ scale: bloomScale.value }], opacity: bloomOpacity.value }));

  return (
    <View style={styles.badgeWrap}>
      <Animated.View style={[styles.bloom, bloomStyle]} />
      <Animated.View style={[styles.badge, badgeStyle]}>
        <Check size={26} color={EventAction.onPrimary} strokeWidth={3} />
      </Animated.View>
    </View>
  );
}

/** Scene spec 05: the event band. Carries image + title + date/venue +
 *  creator byline through every state that has real order data, not just
 *  the happy path - "the creator's identity never disappears." */
function EventHeader({
  order, bylineName, bylineLogo,
}: { order: MyOrder; bylineName: string | null; bylineLogo: string | null }) {
  return (
    <View style={styles.band}>
      {order.event_image ? (
        <Image source={{ uri: order.event_image }} style={StyleSheet.absoluteFill} contentFit="cover" />
      ) : null}
      {!!order.event_image && (
        <LinearGradient
          colors={['transparent', EventSurface.mediaVignette]}
          locations={[0.3, 1]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
      )}
      <View style={styles.bandContent}>
        {!!order.event_title && <Text style={styles.bandTitle} numberOfLines={2}>{order.event_title}</Text>}
        {(!!order.event_date || !!order.event_venue) && (
          <Text style={styles.bandMeta} numberOfLines={1}>
            {[order.event_date ? formatEventDateLA(order.event_date) : null, order.event_venue]
              .filter(Boolean).join(' · ')}
          </Text>
        )}
        {!!bylineName && (
          <View style={styles.bandCreatorRow}>
            {!!bylineLogo && (
              <Image source={{ uri: bylineLogo }} style={styles.bandCreatorAvatar} contentFit="cover" />
            )}
            {/* LIZ COPY (decision 16): bylines say put on by, never hosted by */}
            <Text style={styles.bandCreatorText} numberOfLines={1}>put on by {bylineName}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

/** Shared shape for the canceled/refunded/not-found/pending states - a
 *  title, a warm sentence, then whatever actions that state offers. */
function StatusMessage({
  title, body, children,
}: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <View style={styles.statusWrap}>
      <Text style={styles.statusTitle}>{title}</Text>
      <Text style={styles.statusBody}>{body}</Text>
      {children}
    </View>
  );
}

/** The support/recovery affordance: a real person, one tap away. Uses
 *  Linking directly (not lib/url's openUrl, which force-prefixes https:// and
 *  would mangle a mailto: link) - same pattern as app/(tabs)/profile.tsx's
 *  "Contact Us" row. */
function SupportLink() {
  return (
    <TouchableOpacity
      onPress={() => {
        hapticLight();
        Linking.openURL('mailto:hello@washedup.app').catch((e) => logError(e, 'orderComplete.openMailto'));
      }}
      hitSlop={8}
      style={styles.statusSecondary}
      accessibilityRole="button"
    >
      {/* copy to the taste gate */}
      <Text style={styles.supportLinkText}>email us — hello@washedup.app</Text>
    </TouchableOpacity>
  );
}

export default function OrderCompleteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [answers, setAnswers] = useState<AnswerDraft>({});
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const reduceMotion = useReduceMotionLocal();
  const [pendingStuck, setPendingStuck] = useState(false);

  // A card charge settles a beat after Stripe returns, and seats only exist
  // once it does. Now that a paid buyer is brought straight here (finding
  // 2), keep asking until the seats show up rather than greeting them with
  // an empty ticket. Scene spec 05: also keep asking while the order is
  // still genuinely 'pending' (the buyer may have only just returned from
  // Stripe, or the webhook hasn't landed), not only while seats are empty.
  const { data: order, isLoading } = useQuery({
    queryKey: ['ticket-order', id],
    queryFn: () => getOrder(id!),
    enabled: !!id,
    refetchInterval: (query) => {
      const o = query.state.data as MyOrder | null | undefined;
      if (!o) return 4000;
      const stillSettling = o.status === 'pending' || !o.seats.some((s) => !s.voided);
      return stillSettling ? 4000 : false;
    },
  });
  const view = resolveOrderViewState(order, isLoading);

  useEffect(() => {
    setPendingStuck(false);
    if (view.kind !== 'pending') return;
    const t = setTimeout(() => setPendingStuck(true), PENDING_PATIENCE_MS);
    return () => clearTimeout(t);
  }, [view.kind, id]);

  const { data: questions = [] } = useQuery({
    queryKey: ['order-questions', order?.event_id],
    queryFn: () => getQuestions(order!.event_id),
    enabled: !!order?.event_id,
  });
  // doc 111: the organizer's "after they buy" note; null until SQL-96 lands
  const { data: organizerNote } = useQuery({
    queryKey: ['confirmation-message', order?.event_id],
    queryFn: () => getConfirmationMessage(order!.event_id),
    enabled: !!order?.event_id,
    staleTime: 60_000,
  });
  // Scene spec 05: creator identity for the band. public_name always wins
  // and wears no avatar (the byline law); otherwise resolve the organizer's
  // own profile. Deliberately NOT the event page's fuller 3-way resolution
  // (community name + leader face) - a named, reported scope cut, not a
  // silent guess.
  const { data: organizerProfiles } = useQuery({
    queryKey: ['organizer-profile-of-order', order?.event_host_user_id],
    queryFn: () => getOrganizerProfiles([order!.event_host_user_id!]),
    enabled: !!order?.event_host_user_id && !order?.event_public_name,
    staleTime: 60_000,
  });
  const resolvedProfile = order?.event_host_user_id ? organizerProfiles?.get(order.event_host_user_id) : undefined;
  const bylineName = order?.event_public_name || resolvedProfile?.display_name || null;
  const bylineLogo = order?.event_public_name ? null : resolvedProfile?.logo_url ?? null;

  const qty = order?.qty ?? 1;

  const setCell = useCallback((questionId: string, seat: Seat, patch: AnswerRaw) => {
    const key = cellKey(questionId, seat);
    setAnswers((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }, []);

  // every (question, seat) pair that carries a real value
  const filledCells = useMemo(
    () => collectCells(questions, answers, qty),
    [questions, answers, qty],
  );

  const submit = useCallback(async () => {
    if (!id || saving) return;
    hapticLight();
    setSaving(true);
    setErrorText(null);
    let failures = 0;
    for (const cell of filledCells) {
      const res = await recordAnswer(id, cell.q.id, cell.value, cell.seat);
      if (!res.ok) failures += 1;
    }
    setSaving(false);
    if (failures > 0) {
      // never swallow the failure: the answers did NOT all save
      hapticError();
      /* copy to the taste gate */
      setErrorText(
        failures === filledCells.length
          ? 'those answers did not send. give it another try.'
          : 'some answers did not send. give it another try.',
      );
      return;
    }
    setDone(true);
    hapticSuccess();
  }, [id, saving, filledCells]);

  const showBand = !!order && view.kind !== 'not_found';

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {view.kind === 'loading' && (
          <ActivityIndicator size="small" color={EventAction.primary} style={styles.loading} />
        )}

        {view.kind === 'not_found' && (
          /* support/recovery: a bad or stale link, or an RLS-blocked read.
             Never claim a real order failed when we simply cannot see one. */
          <StatusMessage
            /* copy to the taste gate */
            title="we can't find this order"
            body="the link might be old, or something didn't save right."
          >
            <SupportLink />
            <TouchableOpacity
              onPress={() => router.replace('/(tabs)/plans' as never)}
              hitSlop={8}
              style={styles.statusSecondary}
              accessibilityRole="button"
            >
              {/* copy to the taste gate */}
              <Text style={styles.statusSecondaryText}>back to plans</Text>
            </TouchableOpacity>
          </StatusMessage>
        )}

        {showBand && <EventHeader order={order!} bylineName={bylineName} bylineLogo={bylineLogo} />}

        {view.kind === 'canceled' && (
          <StatusMessage
            /* copy to the taste gate */
            title="this order didn't go through"
            body="no charge went through here. you can try again anytime."
          >
            <TouchableOpacity
              style={styles.cta}
              onPress={() => router.push(`/event/${order!.event_id}` as never)}
              activeOpacity={0.85}
              accessibilityRole="button"
            >
              {/* copy to the taste gate */}
              <Text style={styles.ctaText}>back to the event</Text>
            </TouchableOpacity>
          </StatusMessage>
        )}

        {view.kind === 'refunded' && (
          <StatusMessage
            /* copy to the taste gate */
            title="this order was refunded"
            body="check your card statement for the details."
          >
            <TouchableOpacity
              onPress={() => router.replace('/(tabs)/plans' as never)}
              hitSlop={8}
              style={styles.statusSecondary}
              accessibilityRole="button"
            >
              {/* copy to the taste gate */}
              <Text style={styles.statusSecondaryText}>back to plans</Text>
            </TouchableOpacity>
          </StatusMessage>
        )}

        {view.kind === 'pending' && (
          <StatusMessage
            /* copy to the taste gate */
            title="hang tight"
            body="we're still confirming this one. it usually only takes a moment."
          >
            <ActivityIndicator size="small" color={EventAction.primary} style={styles.loading} />
            {pendingStuck && <SupportLink />}
          </StatusMessage>
        )}

        {view.kind === 'settling' && (
          /* copy to the taste gate */
          <Text style={styles.settlingNote}>your ticket is being made. it lands here in a moment.</Text>
        )}

        {view.kind === 'ready' && (
          <>
            <ConfirmBadge reduceMotion={reduceMotion} />
            {/* copy to the taste gate: arrival, not a receipt */}
            <Text style={styles.title}>you're in</Text>

            {/* the door checks each seat's reference_code, so those are the only
                codes worth printing; the order id is not a ticket. */}
            {order!.seats.filter((s) => !s.voided).map((s) => (
              <Text key={s.id} style={styles.ref}>
                {/* copy to the taste gate: per-seat label */}
                {order!.qty > 1 ? `ticket ${s.position_index} · ` : ''}{s.reference_code}
              </Text>
            ))}

            {/* doc 111: the organizer speaking, quiet card, the documented
                gold-border quote treatment (no new accents) */}
            {!!organizerNote && (
              <View style={styles.organizerNote}>
                {/* copy to the taste gate */}
                <Text style={styles.organizerNoteLabel}>from the organizer</Text>
                <Text style={styles.organizerNoteText}>{organizerNote}</Text>
              </View>
            )}

            {!done && questions.length > 0 && (
              <View style={styles.questions}>
                {/* copy to the taste gate */}
                <Text style={styles.qHeader}>a couple of quick things from the organizer</Text>
                <QuestionForm
                  questions={questions}
                  qty={qty}
                  draft={answers}
                  onCellChange={setCell}
                />

                {!!errorText && <Text style={styles.errorText}>{errorText}</Text>}

                <TouchableOpacity
                  style={[styles.cta, (saving || filledCells.length === 0) && styles.ctaOff]}
                  onPress={submit}
                  disabled={saving || filledCells.length === 0}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                >
                  {saving ? (
                    <ActivityIndicator size="small" color={EventAction.onPrimary} />
                  ) : (
                    /* copy to the taste gate */
                    <Text style={styles.ctaText}>send it</Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setDone(true)} hitSlop={8} style={styles.skip} accessibilityRole="button">
                  {/* one gentle skip (doc 61 §4b) */}
                  <Text style={styles.skipText}>maybe later</Text>
                </TouchableOpacity>
              </View>
            )}

            {(done || questions.length === 0) && (
              <TouchableOpacity
                style={styles.cta}
                onPress={() => router.replace('/tickets' as never)}
                activeOpacity={0.85}
                accessibilityRole="button"
              >
                {/* copy to the taste gate */}
                <Text style={styles.ctaText}>see your tickets</Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.cream },
  content: { padding: 24, alignItems: 'center' },
  loading: { marginTop: EventSpacing.xl },
  band: {
    alignSelf: 'stretch',
    minHeight: 140,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: EventSurface.media,
    justifyContent: 'flex-end',
    marginBottom: EventSpacing.lg,
  },
  bandContent: { padding: 16, gap: 2 },
  bandTitle: {
    fontFamily: Fonts.sansBold, fontSize: FontSizes.displaySM, color: EventSurface.onMedia,
    textShadowColor: EventSurface.mediaTextShadow, textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6,
  },
  bandMeta: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: EventSurface.onMediaMuted, marginTop: 2 },
  bandCreatorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  bandCreatorAvatar: { width: 20, height: 20, borderRadius: 10 },
  bandCreatorText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: EventSurface.onMediaLabel },
  statusWrap: { alignSelf: 'stretch', alignItems: 'center', gap: EventSpacing.sm, marginTop: EventSpacing.lg },
  statusTitle: { fontFamily: Fonts.displayBold, fontSize: FontSizes.displayMD, color: Colors.asphalt, textAlign: 'center' },
  statusBody: {
    fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.textMedium,
    textAlign: 'center', marginBottom: EventSpacing.sm,
  },
  statusSecondary: { marginTop: EventSpacing.sm, alignItems: 'center' },
  statusSecondaryText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.darkWarm },
  supportLinkText: {
    fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.darkWarm, textDecorationLine: 'underline',
  },
  badgeWrap: {
    width: 96, height: 96, alignItems: 'center', justifyContent: 'center',
    marginTop: EventSpacing.md, marginBottom: EventSpacing.md,
  },
  bloom: { position: 'absolute', width: 96, height: 96, borderRadius: 48, backgroundColor: Colors.goingConfirmedFill },
  badge: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: EventAction.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  title: { fontFamily: Fonts.displayBold, fontSize: FontSizes.displayLG, color: Colors.asphalt },
  ref: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.warmGray, marginTop: EventSpacing.sm, letterSpacing: 1 },
  settlingNote: {
    fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.textMedium,
    marginTop: EventSpacing.sm, textAlign: 'center',
  },
  organizerNote: {
    alignSelf: 'stretch', backgroundColor: Colors.white, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border,
    borderLeftWidth: 2, borderLeftColor: Colors.goldAccent,
    padding: 14, marginTop: EventSpacing.lg, gap: 4,
  },
  organizerNoteLabel: {
    fontFamily: Fonts.sansMedium, fontSize: FontSizes.caption, color: Colors.tertiary,
    letterSpacing: 0.5, textTransform: 'uppercase',
  },
  organizerNoteText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.quoteText, lineHeight: 20 },
  questions: { alignSelf: 'stretch', marginTop: EventSpacing.xl, gap: EventSpacing.lg },
  qHeader: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.asphalt },
  errorText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: EventAction.error },
  cta: {
    alignSelf: 'stretch', backgroundColor: EventAction.primary, borderRadius: 999,
    minHeight: 48, paddingVertical: 15, alignItems: 'center', justifyContent: 'center', marginTop: EventSpacing.md,
    shadowColor: Colors.terracotta, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 3,
  },
  ctaOff: { opacity: 0.5, shadowOpacity: 0 },
  ctaText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: EventAction.onPrimary },
  skip: { alignItems: 'center', marginTop: EventSpacing.sm },
  skipText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.textMedium },
});
