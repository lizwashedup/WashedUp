/**
 * Post-plan survey v3. ONE survey, replacing both the legacy survey and
 * SurveyV2. Memory + people-growth first; attendance is plan-type-aware.
 *
 * Flow (every beat escapable):
 *   1. "How was it?" (always)        -> upsert_plan_feedback (complete state)
 *   2. "Who made it?" (conditional)  -> no_show_reports
 *   3. "Keep these people" (only when YOURS_PAGE_ENABLED) -> the handshake
 *
 * NON-NEGOTIABLE rails (2026-05-18 lockout): an escape on every step, never
 * network-gated; markPostPlanSurveyHandled on EVERY exit BEFORE any network
 * write; all plan_feedback writes through upsert_plan_feedback with COMPLETE
 * state (last-write-wins); write errors swallowed, never trap.
 *
 * No emoji, no em dashes, no forbidden words.
 */
import React, { useMemo, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  TextInput,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeIn } from 'react-native-reanimated';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';
import { supabase } from '../../../lib/supabase';
import { hapticSelection, hapticSuccess } from '../../../lib/haptics';
import { YOURS_PAGE_ENABLED } from '../../../constants/FeatureFlags';
import YoursAvatar from '../primitives/YoursAvatar';
import { COPY } from '../state/constants';
import {
  markPostPlanSurveyHandled,
  type SurveyProps,
  type SurveyMember,
} from '../../PostPlanSurvey';

// ─── Types ────────────────────────────────────────────────────────────────
type Step = 'how' | 'who' | 'keep';
type Rating = 'thumbs_up' | 'thumbs_down' | 'fine';

// The handshake result overlay. Celebration (gold card) only when someone
// became a mutual connection; otherwise a quiet auto-dismissing line.
interface HandshakeResult {
  connectedNames: string[];
  requested: number;
  failed: boolean;
}

// "A" / "A and B" / "A, B and C"
function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

const QUIET_AUTO_MS = 1500;

// ─── Component ──────────────────────────────────────────────────────────────
export default function PostPlanSurveyV3({
  visible,
  plan,
  members,
  userId,
  onComplete,
}: SurveyProps) {
  const others = useMemo(
    () => members.filter((m) => m.id !== userId),
    [members, userId],
  );

  // Plan-type rules. Featured plans never police attendance; circle plans only
  // when strangers actually joined (and then only the strangers are listed).
  const showWhoMadeIt =
    !plan.is_featured && (plan.circle_id == null || plan.any_stranger_joined);
  const whoMadeItList = useMemo<SurveyMember[]>(() => {
    if (plan.circle_id != null && plan.any_stranger_joined) {
      return others.filter((m) => m.is_stranger);
    }
    return others;
  }, [others, plan.circle_id, plan.any_stranger_joined]);

  const [step, setStep] = useState<Step>('how');
  const [rating, setRating] = useState<Rating | null>(null);
  const [comment, setComment] = useState('');
  const [showComment, setShowComment] = useState(false);
  const [noShows, setNoShows] = useState<Set<string>>(new Set());
  const [addSel, setAddSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<HandshakeResult | null>(null);

  const wroteRef = useRef(false);
  const exitedRef = useRef(false);

  // ── The single exit. Rails 2 + 4: mark handled BEFORE any network write, then
  // close. A bare escape with no rating still records a distinct skip sentinel
  // (rating=null, comment='skipped', never 'fine'), fire-and-forget, so the
  // server stops re-offering even if local storage is later cleared. Writes are
  // swallowed; a failure never traps the user.
  const exit = () => {
    if (exitedRef.current) return;
    exitedRef.current = true;
    void markPostPlanSurveyHandled(plan.id);
    if (!wroteRef.current) {
      void supabase
        .rpc('upsert_plan_feedback', {
          p_event_id: plan.id,
          p_rating: null,
          p_comment: 'skipped',
          p_attended: true,
        })
        .then(
          () => {},
          () => {},
        );
    }
    onComplete();
  };

  // Rail 3: complete-state upsert (rating + comment together), fire-and-forget.
  const commitFeedback = (r: Rating, cmt: string | null) => {
    wroteRef.current = true;
    void supabase
      .rpc('upsert_plan_feedback', {
        p_event_id: plan.id,
        p_rating: r,
        p_comment: cmt,
        p_attended: true,
      })
      .then(
        () => {},
        () => {},
      );
  };

  const afterRating = () => {
    if (showWhoMadeIt) {
      setStep('who');
    } else {
      goToKeepOrClose(new Set());
    }
  };

  const pick = (label: 'good' | 'fine' | 'bad') => {
    hapticSelection();
    if (label === 'bad') {
      setRating('thumbs_down');
      setShowComment(true);
      return; // wait for optional comment + explicit Next
    }
    const r: Rating = label === 'good' ? 'thumbs_up' : 'fine';
    setRating(r);
    commitFeedback(r, null);
    afterRating();
  };

  const submitBadComment = () => {
    commitFeedback('thumbs_down', comment.trim() || null);
    afterRating();
  };

  const submitWho = () => {
    // no_show_reports is write-only and best-effort; never block on it.
    if (noShows.size > 0) {
      void supabase
        .from('no_show_reports')
        .insert(
          Array.from(noShows).map((id) => ({
            event_id: plan.id,
            reporter_user_id: userId,
            no_show_user_id: id,
          })),
        )
        .then(
          () => {},
          () => {},
        );
    }
    goToKeepOrClose(noShows);
  };

  // Step 3 gating: only with the people system on, and only when there is at
  // least one eligible person (incoming_pending or none; mutual / outgoing /
  // blocked are excluded server-side via keep_state). Otherwise close.
  const goToKeepOrClose = (currentNoShows: Set<string>) => {
    if (!YOURS_PAGE_ENABLED) {
      exit();
      return;
    }
    const eligible = others.filter(
      (m) =>
        !currentNoShows.has(m.id) &&
        (m.keep_state === 'incoming_pending' || m.keep_state === 'none'),
    );
    if (eligible.length === 0) {
      exit();
      return;
    }
    setAddSel(new Set(eligible.map((m) => m.id)));
    setStep('keep');
  };

  const keepCandidates = useMemo<SurveyMember[]>(
    () =>
      others.filter(
        (m) =>
          !noShows.has(m.id) &&
          (m.keep_state === 'incoming_pending' || m.keep_state === 'none'),
      ),
    [others, noShows],
  );

  // THE HANDSHAKE. One atomic server RPC per person; the client never branches
  // the relationship logic itself. blocked (a race) raises and is a silent skip.
  const submitAdd = async () => {
    const selected = keepCandidates.filter((m) => addSel.has(m.id));
    if (selected.length === 0) return;
    setBusy(true);
    const settled = await Promise.allSettled(
      selected.map(async (m) => {
        const { data, error } = await supabase.rpc('add_or_accept_person', {
          p_target: m.id,
          p_context: 'plan_history',
          p_context_event_id: plan.id,
        });
        if (error) throw error;
        return { member: m, outcome: String(data) };
      }),
    );
    setBusy(false);

    const connectedNames: string[] = [];
    let requested = 0;
    let failed = false;
    for (const r of settled) {
      if (r.status === 'fulfilled') {
        if (r.value.outcome === 'now_connected') {
          connectedNames.push(r.value.member.first_name_display ?? 'Someone');
        } else if (r.value.outcome === 'requested') {
          requested += 1;
        }
        // 'already_connected' -> silent no-op
      } else {
        const msg = String(
          (r.reason as { message?: string })?.message ?? r.reason ?? '',
        );
        if (!msg.includes('blocked')) failed = true; // blocked = silent skip
      }
    }

    if (connectedNames.length === 0 && requested === 0 && !failed) {
      exit();
      return;
    }
    if (connectedNames.length > 0) hapticSuccess();
    setResult({ connectedNames, requested, failed });

    // Quiet-only outcomes are non-blocking: a brief line, then close.
    if (connectedNames.length === 0) {
      setTimeout(exit, QUIET_AUTO_MS);
    }
  };

  const celebrationText =
    result && result.connectedNames.length === 1
      ? COPY.surveyConnectedOne(result.connectedNames[0])
      : result
        ? COPY.surveyConnectedMany(joinNames(result.connectedNames))
        : '';

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={exit}>
      {/* SafeAreaProvider inside the Modal so insets are non-zero: an RN Modal is
          a separate native window with no provider, so a bare SafeAreaView would
          render the always-available escape (and the title) under the notch /
          dynamic island. Rail 1 requires the escape to stay reachable. */}
      <SafeAreaProvider>
        <SafeAreaView style={styles.container}>
        {/* Rail 1: escape on EVERY step, never disabled, never network-gated.
            A flow header (not absolute) so it always sits below the inset. */}
        <View style={styles.header}>
          <Pressable
            onPress={exit}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={COPY.surveyNotNow}
          >
            <Text style={styles.escapeText}>{COPY.surveyNotNow}</Text>
          </Pressable>
        </View>
        {step === 'how' && (
          <View style={styles.body}>
            <Text style={styles.planTitle}>{plan.title}</Text>
            <Text style={styles.q}>{COPY.surveyHow}</Text>
            <Pressable style={[styles.pill, styles.pillGood]} onPress={() => pick('good')}>
              <Text style={styles.pillGoodText}>{COPY.surveyGood}</Text>
            </Pressable>
            <Pressable style={[styles.pill, styles.pillFine]} onPress={() => pick('fine')}>
              <Text style={styles.pillFineText}>{COPY.surveyFine}</Text>
            </Pressable>
            <Pressable style={[styles.pill, styles.pillBad]} onPress={() => pick('bad')}>
              <Text style={styles.pillBadText}>{COPY.surveyBad}</Text>
            </Pressable>

            {showComment && (
              <View style={styles.commentWrap}>
                <TextInput
                  value={comment}
                  onChangeText={setComment}
                  placeholder={COPY.surveyBadFollowup}
                  placeholderTextColor={Colors.tertiary}
                  style={styles.comment}
                  multiline
                />
                <Pressable style={styles.next} onPress={submitBadComment}>
                  <Text style={styles.nextText}>{COPY.surveyNext}</Text>
                </Pressable>
              </View>
            )}
          </View>
        )}

        {step === 'who' && (
          <View style={styles.body}>
            <Text style={styles.q}>{COPY.surveyWhoMadeIt}</Text>
            <ScrollView style={styles.stretch}>
              {whoMadeItList.map((m) => {
                const out = noShows.has(m.id);
                return (
                  <Pressable
                    key={m.id}
                    style={styles.memberRow}
                    onPress={() => {
                      hapticSelection();
                      setNoShows((s) => {
                        const n = new Set(s);
                        if (n.has(m.id)) n.delete(m.id);
                        else n.add(m.id);
                        return n;
                      });
                    }}
                  >
                    <View style={{ opacity: out ? 0.4 : 1 }}>
                      <YoursAvatar
                        name={m.first_name_display}
                        photoUrl={m.profile_photo_url}
                        size={44}
                        bucket="none"
                      />
                    </View>
                    <Text style={[styles.memberName, out && styles.memberNameOut]}>
                      {m.first_name_display ?? 'Someone'}
                    </Text>
                    {out && <Text style={styles.didnt}>{COPY.surveyDidntMakeIt}</Text>}
                  </Pressable>
                );
              })}
            </ScrollView>
            <Pressable style={styles.next} onPress={submitWho}>
              <Text style={styles.nextText}>{COPY.surveyNext}</Text>
            </Pressable>
          </View>
        )}

        {step === 'keep' && (
          <View style={styles.body}>
            <Text style={styles.q}>{COPY.surveyAddPrompt}</Text>
            <ScrollView contentContainerStyle={styles.chipWrap}>
              {keepCandidates.map((m) => {
                const on = addSel.has(m.id);
                return (
                  <Pressable
                    key={m.id}
                    style={styles.chip}
                    onPress={() => {
                      hapticSelection();
                      setAddSel((s) => {
                        const n = new Set(s);
                        if (n.has(m.id)) n.delete(m.id);
                        else n.add(m.id);
                        return n;
                      });
                    }}
                  >
                    <YoursAvatar
                      name={m.first_name_display}
                      photoUrl={m.profile_photo_url}
                      size={56}
                      bucket={on ? 'full' : 'none'}
                    />
                    <Text style={styles.chipName} numberOfLines={1}>
                      {m.first_name_display ?? ''}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <Pressable
              style={[styles.next, addSel.size === 0 && styles.nextOff]}
              disabled={busy || addSel.size === 0}
              onPress={submitAdd}
            >
              {busy ? (
                <ActivityIndicator color={Colors.white} />
              ) : (
                <Text style={styles.nextText}>{COPY.surveyAddButton}</Text>
              )}
            </Pressable>
            <Pressable style={styles.skip} onPress={exit}>
              <Text style={styles.skipText}>{COPY.surveySkip}</Text>
            </Pressable>
          </View>
        )}

        {/* Handshake feedback. In-Modal overlay (NOT a nested RN Modal, which is
            the known iOS present-while-presenting bug). Celebration when someone
            became mutual; otherwise a quiet auto-dismissing line. */}
        {result && result.connectedNames.length > 0 && (
          <Pressable style={styles.scrim} onPress={exit}>
            <Animated.View entering={FadeIn.duration(300)} style={styles.celebrateCard}>
              <View style={styles.goldRule} />
              <Text style={styles.celebrateText}>{celebrationText}</Text>
              {result.requested > 0 && (
                <Text style={styles.quietLine}>{COPY.surveyRequested}</Text>
              )}
              {result.failed && (
                <Text style={styles.quietLine}>{COPY.surveyCouldntReach}</Text>
              )}
              <Pressable style={styles.gotIt} onPress={exit}>
                <Text style={styles.gotItText}>Got it</Text>
              </Pressable>
            </Animated.View>
          </Pressable>
        )}
        {result && result.connectedNames.length === 0 && (
          <Animated.View entering={FadeIn.duration(200)} style={styles.quietToast}>
            <Text style={styles.quietToastText}>
              {result.requested > 0 ? COPY.surveyRequested : COPY.surveyCouldntReach}
            </Text>
          </Animated.View>
        )}
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  header: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 2 },
  body: { flex: 1, paddingHorizontal: 24, paddingTop: 16, gap: 14 },
  stretch: { alignSelf: 'stretch' },
  planTitle: {
    fontFamily: Fonts.displayItalic,
    fontSize: FontSizes.displayLG,
    color: Colors.asphalt,
    textAlign: 'center',
  },
  q: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.displaySM,
    color: Colors.secondary,
    textAlign: 'center',
    marginBottom: 12,
  },
  pill: { height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  pillGood: { backgroundColor: Colors.terracotta },
  pillGoodText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.white },
  pillFine: { backgroundColor: Colors.surface },
  pillFineText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.asphalt },
  pillBad: { backgroundColor: Colors.yoursGhostBg },
  pillBadText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyLG, color: Colors.secondary },
  commentWrap: { marginTop: 16, gap: 12 },
  comment: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    minHeight: 80,
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
    textAlignVertical: 'top',
  },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  memberName: { flex: 1, fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.asphalt },
  memberNameOut: { color: Colors.tertiary, textDecorationLine: 'line-through' },
  didnt: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.tertiary },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, justifyContent: 'center' },
  chip: { width: 72, alignItems: 'center' },
  chipName: { fontFamily: Fonts.sans, fontSize: FontSizes.micro, color: Colors.secondary, marginTop: 4 },
  next: {
    backgroundColor: Colors.terracotta,
    borderRadius: 999,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  nextOff: { opacity: 0.4 },
  nextText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.white },
  skip: { alignItems: 'center', paddingVertical: 12 },
  skipText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.tertiary },
  escapeText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.tertiary, paddingVertical: 6, paddingHorizontal: 4 },
  // ── Handshake celebration (in-Modal overlay) ──
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(44,24,16,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  celebrateCard: {
    backgroundColor: Colors.cardBg,
    borderRadius: 20,
    paddingVertical: 28,
    paddingHorizontal: 24,
    alignItems: 'center',
    alignSelf: 'stretch',
    gap: 10,
  },
  goldRule: { width: 40, height: 2, borderRadius: 1, backgroundColor: Colors.goldAccent, marginBottom: 6 },
  celebrateText: {
    fontFamily: Fonts.displayBold,
    fontSize: FontSizes.displaySM,
    color: Colors.asphalt,
    textAlign: 'center',
  },
  quietLine: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.secondary, textAlign: 'center' },
  gotIt: { marginTop: 10, paddingVertical: 8, paddingHorizontal: 20 },
  gotItText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.terracotta },
  quietToast: {
    position: 'absolute',
    left: 24,
    right: 24,
    bottom: 48,
    backgroundColor: Colors.darkWarm,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 18,
    alignItems: 'center',
  },
  quietToastText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.white },
});
