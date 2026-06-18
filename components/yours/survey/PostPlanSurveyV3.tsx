/**
 * Post-plan survey v3. ONE survey, replacing both the legacy survey and
 * SurveyV2. Memory + people-growth first; attendance is plan-type-aware.
 *
 * Flow (every beat escapable):
 *   1. "How was it?" (always)        -> upsert_plan_feedback (complete state)
 *   2. "Who made it?" (conditional)  -> no_show_reports
 *   3. "Keep these people" (only when YOURS_PAGE_ENABLED) -> the handshake
 *
 * FORM FACTOR (survey-v3-visual-spec): a bottom sheet that GROWS with
 * commitment. Step 1 enters at ~half height over the dimmed plan card (the card
 * behind IS the context). Steps 2-3 spring-expand to tall (the people moment
 * gets the full stage). The sheet never shrinks once grown. Backdrop dim, no
 * tap-to-dismiss, no pan-to-dismiss; the only escape is the explicit "Not now".
 *
 * Spring family = the documented composer/calendar-expand family from
 * primitives/BottomSheet (mass 1 / stiffness 280 / damping 26 in, 320/30 out).
 * Driven JS-side (useNativeDriver:false) so the sheet HEIGHT can animate; the
 * primitive isn't a drop-in (it dismisses on tap/pan and is fixed-height).
 *
 * NON-NEGOTIABLE rails (2026-05-18 lockout): an escape on every step, never
 * network-gated; markPostPlanSurveyHandled on EVERY exit BEFORE any network
 * write; all plan_feedback writes through upsert_plan_feedback with COMPLETE
 * state (last-write-wins); write errors swallowed, never trap.
 *
 * No emoji, no em dashes, no forbidden words.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  TextInput,
  Keyboard,
  StyleSheet,
  Animated,
  Dimensions,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Image } from 'expo-image';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';
import { supabase } from '../../../lib/supabase';
import { hapticSelection, hapticSuccess } from '../../../lib/haptics';
import { YOURS_PAGE_ENABLED } from '../../../constants/FeatureFlags';
import { useReduceMotion } from '../a11y/useReduceMotion';
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

// The handshake result overlay. Celebration (gold-ruled toast) only when
// someone became a mutual connection; otherwise a quiet auto-dismissing line.
export interface HandshakeResult {
  connectedNames: string[];
  requested: number;
  failed: boolean;
}

// ─── Sheet geometry + motion (the composer/calendar-expand spring family) ───
const SCREEN_H = Dimensions.get('window').height;
const HALF_H = Math.round(SCREEN_H * 0.66); // step 1: half, plan card visible
const TALL_H = Math.round(SCREEN_H * 0.9); // steps 2-3: the people moment
const SPRING_IN = { mass: 1, stiffness: 280, damping: 26 };
const SPRING_OUT = { mass: 1, stiffness: 320, damping: 30 };

// "A" / "A and B" / "A, B and C"
function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

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

  // The people pool for the who-made-it AND keep steps. On an opened-up circle
  // plan (strangers joined) the steps ONLY concern strangers plus the creator,
  // never circle co-members; the creator is always shown even when they are a
  // circle member. Public plans show everyone (is_stranger is false for all
  // there, so the stranger filter must not apply).
  const peoplePool = useMemo<SurveyMember[]>(() => {
    if (plan.circle_id != null && plan.any_stranger_joined) {
      return others.filter((m) => m.is_stranger || m.is_creator);
    }
    return others;
  }, [others, plan.circle_id, plan.any_stranger_joined]);

  // Plan-type rules. Featured plans never police attendance; circle plans only
  // when strangers actually joined (and then only strangers + the creator). A
  // who-made-it step with nobody to show is meaningless, so an empty pool (solo
  // plan, or every co-member filtered out) skips the step entirely.
  const showWhoMadeIt =
    !plan.is_featured &&
    (plan.circle_id == null || plan.any_stranger_joined) &&
    peoplePool.length > 0;
  const whoMadeItList = peoplePool;

  const [step, setStep] = useState<Step>('how');
  const [rating, setRating] = useState<Rating | null>(null);
  const [comment, setComment] = useState('');
  const [showComment, setShowComment] = useState(false);
  const [noShows, setNoShows] = useState<Set<string>>(new Set());
  const [addSel, setAddSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<HandshakeResult | null>(null);

  // Whether a keep step will actually follow, given the CURRENT no-show
  // selection. Computed live (not a pre-no-show estimate) so the step counter
  // and dots stay honest: marking the last keep-candidate as a no-show on the
  // who step retracts the keep step rather than promising a "3 of 3" that then
  // closes at 2. No-shows only ever subtract from the eligible set.
  const keepWillFollow =
    YOURS_PAGE_ENABLED &&
    peoplePool.some(
      (m) =>
        !noShows.has(m.id) &&
        (m.keep_state === 'incoming_pending' || m.keep_state === 'none'),
    );
  const totalSteps = 1 + (showWhoMadeIt ? 1 : 0) + (keepWillFollow ? 1 : 0);
  const stepIndex: Record<Step, number> = {
    how: 1,
    who: showWhoMadeIt ? 2 : 1,
    keep: totalSteps,
  };

  const wroteRef = useRef(false);
  const exitedRef = useRef(false);
  // True once the user commits the TOP rating ("Really good"). Reported up on
  // exit so the owner can fire the native review ask after this modal dismisses.
  const topRatedRef = useRef(false);

  // ── Grow-sheet motion. translateY: enter/exit. sheetHeight: monotonic grow
  // from HALF to TALL on the first non-'how' step. Both JS-driven so height can
  // animate; Reduce Motion snaps to final.
  const reduceMotion = useReduceMotion();
  const translateY = useRef(new Animated.Value(SCREEN_H)).current;
  const backdrop = useRef(new Animated.Value(0)).current;
  const sheetHeight = useRef(new Animated.Value(HALF_H)).current;
  const grownRef = useRef(false);

  // Keyboard lift. Step 1's optional comment box would sit under the keyboard on
  // the half sheet; lift the whole sheet by the keyboard height while editing.
  const kb = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const onShow = Keyboard.addListener(showEvt, (e) => {
      Animated.timing(kb, {
        toValue: -e.endCoordinates.height,
        duration: 220,
        useNativeDriver: false,
      }).start();
    });
    const onHide = Keyboard.addListener(hideEvt, () => {
      Animated.timing(kb, { toValue: 0, duration: 200, useNativeDriver: false }).start();
    });
    return () => {
      onShow.remove();
      onHide.remove();
    };
  }, [kb]);

  // Enter.
  useEffect(() => {
    if (!visible) return;
    if (reduceMotion) {
      translateY.setValue(0);
      backdrop.setValue(1);
      return;
    }
    translateY.setValue(SCREEN_H);
    backdrop.setValue(0);
    Animated.parallel([
      Animated.spring(translateY, {
        toValue: 0,
        ...SPRING_IN,
        useNativeDriver: false,
      }),
      Animated.timing(backdrop, {
        toValue: 1,
        duration: 280,
        useNativeDriver: false,
      }),
    ]).start();
  }, [visible, reduceMotion]);

  // Grow to tall the first time we leave step 1; never shrink back.
  const growTall = () => {
    if (grownRef.current) return;
    grownRef.current = true;
    if (reduceMotion) {
      sheetHeight.setValue(TALL_H);
      return;
    }
    Animated.spring(sheetHeight, {
      toValue: TALL_H,
      ...SPRING_IN,
      useNativeDriver: false,
    }).start();
  };

  // ── The single exit. Rails 2 + 4: mark handled BEFORE any network write, then
  // close. A bare escape with no rating still records a distinct skip sentinel
  // (rating=null, comment='skipped', never 'fine'), fire-and-forget, so the
  // server stops re-offering even if local storage is later cleared. Writes are
  // swallowed; a failure never traps the user. The close plays the slide-down
  // first, then hands control back to the owner (onComplete).
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
    if (reduceMotion) {
      onComplete(topRatedRef.current);
      return;
    }
    Animated.parallel([
      Animated.spring(translateY, {
        toValue: SCREEN_H,
        ...SPRING_OUT,
        useNativeDriver: false,
      }),
      Animated.timing(backdrop, {
        toValue: 0,
        duration: 220,
        useNativeDriver: false,
      }),
    ]).start(() => onComplete(topRatedRef.current));
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
      growTall();
      setStep('who');
    } else {
      goToKeepOrClose(new Set());
    }
  };

  // Record who didn't make it, as the spec requires ("writes no_show_reports
  // rows as before"). Fire-and-forget + idempotent: the SECURITY DEFINER RPC
  // validates the reporter and target are members and ignores duplicates, so a
  // re-entered step never double-counts. Called once when attendance is
  // finalized (advancing off the "who made it" step).
  const commitNoShows = (ids: Set<string>) => {
    for (const id of ids) {
      supabase
        .rpc('report_no_show', { p_event_id: plan.id, p_no_show_user_id: id })
        .then(({ error }) => {
          if (error) console.warn('[survey] report_no_show failed:', error.message);
        });
    }
  };

  // Step 3 gating: only with the people system on, and only when there is at
  // least one eligible person (incoming_pending or none; mutual / outgoing /
  // blocked are excluded server-side via keep_state). Otherwise close.
  const goToKeepOrClose = (currentNoShows: Set<string>) => {
    // Persist attendance before we branch to keep-or-close, so the no-show
    // record is written whether or not a keep step follows.
    commitNoShows(currentNoShows);
    if (!YOURS_PAGE_ENABLED) {
      exit();
      return;
    }
    const eligible = peoplePool.filter(
      (m) =>
        !currentNoShows.has(m.id) &&
        (m.keep_state === 'incoming_pending' || m.keep_state === 'none'),
    );
    if (eligible.length === 0) {
      exit();
      return;
    }
    setAddSel(new Set(eligible.map((m) => m.id)));
    growTall();
    setStep('keep');
  };

  const keepCandidates = useMemo<SurveyMember[]>(
    () =>
      peoplePool.filter(
        (m) =>
          !noShows.has(m.id) &&
          (m.keep_state === 'incoming_pending' || m.keep_state === 'none'),
      ),
    [peoplePool, noShows],
  );

  // Step-3 footer label: the button speaks the name when exactly one is picked.
  const addSelectedNames = keepCandidates
    .filter((m) => addSel.has(m.id))
    .map((m) => m.first_name_display ?? 'them');
  const addSelectedCount = addSelectedNames.length;
  const addLabel =
    addSelectedCount === 1
      ? COPY.surveyAddOne(addSelectedNames[0])
      : COPY.surveyAddButton;

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
  };

  // ── Render ────────────────────────────────────────────────────────────────
  const headerTitle =
    step === 'how' ? COPY.surveyHow : step === 'who' ? COPY.surveyWhoMadeIt : null;

  return (
    <Modal visible={visible} transparent statusBarTranslucent animationType="none" onRequestClose={exit}>
      <SafeAreaProvider>
        <View style={styles.root}>
          {/* Backdrop: warm dim. NO tap-to-dismiss (escapes are explicit). The
              plan card sits behind the sheet as the "which plan" context. */}
          <Animated.View style={[styles.backdrop, { opacity: backdrop }]} />
          <Animated.View
            style={[styles.planContext, { opacity: backdrop }]}
            pointerEvents="none"
          >
            <PlanCardBehind plan={plan} wentCount={others.length + 1} />
          </Animated.View>

          {/* The grow-sheet. */}
          <Animated.View
            style={[
              styles.sheet,
              { height: sheetHeight, transform: [{ translateY: Animated.add(translateY, kb) }] },
            ]}
          >
            <View style={styles.handle} />
            <SheetHeader
              eyebrow={plan.title}
              title={headerTitle}
              current={stepIndex[step]}
              total={totalSteps}
            />

            {/* Bodies land in checkpoints 2-4. */}
            <Animated.ScrollView
              style={styles.body}
              contentContainerStyle={styles.bodyContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {step === 'how' && (
                <StepHow
                  selected={rating}
                  onPick={(r) => {
                    hapticSelection();
                    setRating(r);
                    setShowComment(r === 'thumbs_down');
                    if (r !== 'thumbs_down') Keyboard.dismiss();
                  }}
                  comment={comment}
                  setComment={setComment}
                  showComment={showComment}
                />
              )}
              {step === 'who' && (
                <StepWho
                  list={whoMadeItList}
                  noShows={noShows}
                  onToggle={(id) => {
                    hapticSelection();
                    setNoShows((s) => {
                      const n = new Set(s);
                      if (n.has(id)) n.delete(id);
                      else n.add(id);
                      return n;
                    });
                  }}
                />
              )}
              {step === 'keep' && (
                <StepKeep
                  candidates={keepCandidates}
                  selected={addSel}
                  onToggle={(id) => {
                    hapticSelection();
                    setAddSel((s) => {
                      const n = new Set(s);
                      if (n.has(id)) n.delete(id);
                      else n.add(id);
                      return n;
                    });
                  }}
                />
              )}
            </Animated.ScrollView>

            {/* Footer. Steps 1-2: a single Continue. Step 3: equal-weight Add /
                Skip (fill vs ghost only). "Not now" stays present on all steps. */}
            {step === 'keep' ? (
              <KeepFooter
                addLabel={addLabel}
                canAdd={addSelectedCount > 0}
                busy={busy}
                onAdd={() => void submitAdd()}
                onSkip={exit}
                onEscape={exit}
              />
            ) : (
              <Footer
                primaryLabel={COPY.surveyContinue}
                primaryActive={step !== 'how' || rating != null}
                busy={busy}
                onPrimary={() => {
                  if (step === 'how') {
                    if (rating == null) return;
                    if (rating !== 'thumbs_down') commitFeedback(rating, null);
                    else commitFeedback('thumbs_down', comment.trim() || null);
                    // The TOP rating is the soft-ask for the native review sheet;
                    // recorded here, fired by the owner after this modal closes.
                    topRatedRef.current = rating === 'thumbs_up';
                    afterRating();
                  } else {
                    goToKeepOrClose(noShows);
                  }
                }}
                onEscape={exit}
              />
            )}
          </Animated.View>

          {result && (
            <SurveyOutcomeOverlay result={result} onDismiss={exit} />
          )}
        </View>
      </SafeAreaProvider>
    </Modal>
  );
}

// ─── Plan card behind (the "which plan" context) ────────────────────────────
function PlanCardBehind({
  plan,
  wentCount,
}: {
  plan: SurveyProps['plan'];
  wentCount: number;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.cardBehindWrap, { paddingTop: insets.top + 12 }]}>
      <Text style={styles.cardBehindEyebrow}>{COPY.wordmark}</Text>
      <View style={styles.cardBehind}>
        {plan.image_url ? (
          <Image
            source={{ uri: plan.image_url }}
            style={styles.cardBehindImg}
            contentFit="cover"
          />
        ) : (
          <View style={[styles.cardBehindImg, styles.cardBehindImgFallback]} />
        )}
        <View style={styles.cardBehindBody}>
          <Text style={styles.cardBehindTitle} numberOfLines={2}>
            {plan.title}
          </Text>
          <Text style={styles.cardBehindMeta}>{wentCount} went</Text>
        </View>
      </View>
    </View>
  );
}

// ─── Sheet header (eyebrow + serif title + step indicator) ──────────────────
function SheetHeader({
  eyebrow,
  title,
  current,
  total,
}: {
  eyebrow: string;
  title: string | null;
  current: number;
  total: number;
}) {
  return (
    <View style={styles.header}>
      <Text style={styles.eyebrow} numberOfLines={1}>
        {eyebrow}
      </Text>
      {title != null && <Text style={styles.title}>{title}</Text>}
      <View style={styles.stepRow}>
        {Array.from({ length: total }).map((_, i) => {
          const n = i + 1;
          const state = n < current ? 'done' : n === current ? 'on' : 'todo';
          return (
            <View
              key={n}
              style={[
                styles.stepDot,
                state === 'on' && styles.stepDotOn,
                state === 'done' && styles.stepDotDone,
              ]}
            />
          );
        })}
        <Text style={styles.stepCounter}>
          {COPY.surveyStepCounter(current, total)}
        </Text>
      </View>
    </View>
  );
}

// ─── Footer (Continue + Not now) ────────────────────────────────────────────
function Footer({
  primaryLabel,
  primaryActive,
  busy,
  onPrimary,
  onEscape,
}: {
  primaryLabel: string;
  primaryActive: boolean;
  busy: boolean;
  onPrimary: () => void;
  onEscape: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.footer, { paddingBottom: Math.max(20, insets.bottom + 8) }]}>
      <Pressable
        style={[styles.primary, !primaryActive && styles.primaryOff]}
        disabled={!primaryActive || busy}
        onPress={onPrimary}
      >
        {busy ? (
          <ActivityIndicator color={Colors.white} />
        ) : (
          <Text style={styles.primaryText}>{primaryLabel}</Text>
        )}
      </Pressable>
      <Pressable
        style={styles.escape}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel={COPY.surveyNotNow}
        onPress={onEscape}
      >
        <Text style={styles.escapeText}>{COPY.surveyNotNow}</Text>
      </Pressable>
    </View>
  );
}

// ─── Step 1: How was it? (pills + optional "Not great" comment reveal) ───────
const COMMENT_REVEAL_H = 134;

function StepHow({
  selected,
  onPick,
  comment,
  setComment,
  showComment,
}: {
  selected: Rating | null;
  onPick: (r: Rating) => void;
  comment: string;
  setComment: (s: string) => void;
  showComment: boolean;
}) {
  const reduceMotion = useReduceMotion();
  const reveal = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduceMotion) {
      reveal.setValue(showComment ? 1 : 0);
      return;
    }
    Animated.spring(reveal, {
      toValue: showComment ? 1 : 0,
      mass: 1,
      stiffness: 280,
      damping: 30,
      useNativeDriver: false,
    }).start();
  }, [showComment, reduceMotion, reveal]);

  const pills: Array<{ r: Rating; label: string }> = [
    { r: 'thumbs_up', label: COPY.surveyGood },
    { r: 'fine', label: COPY.surveyFine },
    { r: 'thumbs_down', label: COPY.surveyBad },
  ];
  return (
    <View style={styles.pillCol}>
      {pills.map((p) => {
        const on = selected === p.r;
        return (
          <Pressable
            key={p.r}
            style={[styles.pill, on && styles.pillOn]}
            onPress={() => onPick(p.r)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
          >
            <Text style={[styles.pillText, on && styles.pillTextOn]}>{p.label}</Text>
          </Pressable>
        );
      })}

      {/* "Not great" reveals an optional, never-required comment box. */}
      <Animated.View
        style={[
          styles.commentReveal,
          {
            height: reveal.interpolate({
              inputRange: [0, 1],
              outputRange: [0, COMMENT_REVEAL_H],
            }),
            opacity: reveal,
          },
        ]}
      >
        <Text style={styles.commentLabel}>{COPY.surveyBadFollowup}</Text>
        <TextInput
          value={comment}
          onChangeText={setComment}
          placeholder=""
          style={styles.commentInput}
          multiline
          editable={showComment}
        />
        <Text style={styles.commentHint}>{COPY.surveyBadHelper}</Text>
      </Animated.View>
    </View>
  );
}

// ─── Step 2: Who made it? (explicit two-state rows) ─────────────────────────
function StepWho({
  list,
  noShows,
  onToggle,
}: {
  list: SurveyMember[];
  noShows: Set<string>;
  onToggle: (id: string) => void;
}) {
  return (
    <View>
      <Text style={styles.whoHelper}>{COPY.surveyWhoHelper}</Text>
      <View style={styles.attendList}>
        {list.map((m) => {
          const out = noShows.has(m.id);
          const name = m.first_name_display ?? 'Someone';
          return (
            <Pressable
              key={m.id}
              style={[styles.attendRow, out && styles.attendRowOut]}
              onPress={() => onToggle(m.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: !out }}
              accessibilityLabel={`${name}, ${out ? COPY.surveyDidntMakeIt : COPY.surveyMadeIt}`}
            >
              <YoursAvatar name={m.first_name_display} photoUrl={m.profile_photo_url} size={44} bucket="none" />
              <Text style={styles.attendName} numberOfLines={1}>
                {name}
              </Text>
              <View style={[styles.tag, out ? styles.tagMissed : styles.tagMade]}>
                <Text style={[styles.tagText, out ? styles.tagTextMissed : styles.tagTextMade]}>
                  {out ? COPY.surveyDidntMakeIt : COPY.surveyMadeIt}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ─── Step 3: Keep these people (pre-selected avatar chips) ──────────────────
function StepKeep({
  candidates,
  selected,
  onToggle,
}: {
  candidates: SurveyMember[];
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  return (
    <View>
      <Text style={styles.keepHeadline}>{COPY.surveyAddPrompt}</Text>
      <View style={styles.chipWrap}>
        {candidates.map((m) => {
          const on = selected.has(m.id);
          return (
            <Pressable
              key={m.id}
              style={[styles.chip, on ? styles.chipOn : styles.chipOff]}
              onPress={() => onToggle(m.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
            >
              <YoursAvatar name={m.first_name_display} photoUrl={m.profile_photo_url} size={28} bucket="none" />
              <Text style={styles.chipName} numberOfLines={1}>
                {m.first_name_display ?? ''}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ─── Step 3 footer: equal-weight Add / Skip + the always-live escape ────────
function KeepFooter({
  addLabel,
  canAdd,
  busy,
  onAdd,
  onSkip,
  onEscape,
}: {
  addLabel: string;
  canAdd: boolean;
  busy: boolean;
  onAdd: () => void;
  onSkip: () => void;
  onEscape: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.footer, { paddingBottom: Math.max(20, insets.bottom + 8) }]}>
      <View style={styles.keepRow}>
        <Pressable
          style={[styles.keepBtn, styles.keepBtnFill, !canAdd && styles.primaryOff]}
          disabled={!canAdd || busy}
          onPress={onAdd}
        >
          {busy ? (
            <ActivityIndicator color={Colors.white} />
          ) : (
            <Text style={styles.keepBtnFillText}>{addLabel}</Text>
          )}
        </Pressable>
        <Pressable style={[styles.keepBtn, styles.keepBtnGhost]} onPress={onSkip}>
          <Text style={styles.keepBtnGhostText}>{COPY.surveySkip}</Text>
        </Pressable>
      </View>
      <Pressable
        style={styles.escape}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel={COPY.surveyNotNow}
        onPress={onEscape}
      >
        <Text style={styles.escapeText}>{COPY.surveyNotNow}</Text>
      </Pressable>
    </View>
  );
}

// ─── Outcome overlay (celebration toast + quiet line) ───────────────────────
// Owns its own enter motion + auto-dismiss timers; timers are cleared on
// unmount (suspect-3 guard: no setState after the survey unmounts).
const AUTO_DISMISS_MS = 3000;

export function SurveyOutcomeOverlay({
  result,
  onDismiss,
}: {
  result: HandshakeResult;
  onDismiss: () => void;
}) {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const rise = useRef(new Animated.Value(reduceMotion ? 0 : 14)).current;
  const opacity = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const mutual = result.connectedNames.length > 0;

  useEffect(() => {
    if (!reduceMotion) {
      Animated.parallel([
        Animated.spring(rise, { toValue: 0, ...SPRING_IN, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 240, useNativeDriver: true }),
      ]).start();
    }
    const t = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const celebrationText =
    result.connectedNames.length === 1
      ? COPY.surveyConnectedOne(result.connectedNames[0])
      : COPY.surveyConnectedMany(joinNames(result.connectedNames));

  // Quiet lines, always stacked in order: request-sent, then the non-blocking
  // failure note (a failure is appended, never an error state, never blocks).
  const quietLines: string[] = [];
  if (result.requested > 0) quietLines.push(COPY.surveyRequested);
  if (result.failed) quietLines.push(COPY.surveyCouldntReach);

  return (
    <Pressable
      style={[styles.overlay, { paddingBottom: Math.max(28, insets.bottom + 12) }]}
      onPress={onDismiss}
    >
      {mutual ? (
        <Animated.View
          style={[styles.toast, { opacity, transform: [{ translateY: rise }] }]}
        >
          <View style={styles.toastRule} />
          <View style={styles.toastInner}>
            <Text style={styles.toastEyebrow}>{COPY.surveyMutualEyebrow}</Text>
            <Text style={styles.toastTitle}>{celebrationText}</Text>
            {quietLines.map((line) => (
              <Text key={line} style={styles.toastQuiet}>
                {line}
              </Text>
            ))}
            <Text style={styles.toastDismiss}>Tap to dismiss</Text>
          </View>
        </Animated.View>
      ) : (
        <Animated.View style={[styles.quietLine, { opacity }]}>
          <View style={styles.quietDot} />
          <View style={styles.quietTextCol}>
            {quietLines.map((line) => (
              <Text key={line} style={styles.quietText}>
                {line}
              </Text>
            ))}
          </View>
        </Animated.View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: Colors.surveyScrim },

  // ── Plan card behind ──
  planContext: { ...StyleSheet.absoluteFillObject },
  cardBehindWrap: { paddingHorizontal: 20 },
  cardBehindEyebrow: {
    fontFamily: Fonts.displayItalic,
    fontSize: FontSizes.displayLG,
    color: Colors.asphalt,
    marginBottom: 12,
  },
  cardBehind: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: Colors.cardBg,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 12,
    alignItems: 'center',
  },
  cardBehindImg: { width: 56, height: 56, borderRadius: 10 },
  cardBehindImgFallback: { backgroundColor: Colors.yoursGhostBg },
  cardBehindBody: { flex: 1, minWidth: 0 },
  cardBehindTitle: {
    fontFamily: Fonts.displayItalic,
    fontSize: FontSizes.displaySM,
    color: Colors.asphalt,
  },
  cardBehindMeta: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.secondary,
    marginTop: 3,
  },

  // ── Sheet ──
  sheet: {
    backgroundColor: Colors.cream,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.iconMuted,
    marginTop: 12,
  },

  // ── Header ──
  header: {
    paddingHorizontal: 24,
    paddingTop: 14,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  eyebrow: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: Colors.tertiary,
  },
  title: {
    fontFamily: Fonts.displayItalic,
    fontSize: FontSizes.displayLG,
    color: Colors.asphalt,
    marginTop: 4,
  },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  stepDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.border,
  },
  stepDotOn: { backgroundColor: Colors.terracotta },
  stepDotDone: { backgroundColor: Colors.gold },
  stepCounter: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodySM,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: Colors.terracotta,
    marginLeft: 6,
  },

  // ── Body + footer ──
  body: { flex: 1 },
  bodyContent: { paddingHorizontal: 24, paddingTop: 18, paddingBottom: 8, flexGrow: 1 },
  footer: {
    paddingHorizontal: 24,
    paddingTop: 8,
  },
  primary: {
    backgroundColor: Colors.terracotta,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 8,
  },
  primaryOff: { opacity: 0.4 },
  primaryText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyLG,
    color: Colors.white,
  },
  escape: { alignItems: 'center', paddingVertical: 8 },
  escapeText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.tertiary,
  },

  // ── Step 1 pills (checkpoint 2 refines) ──
  pillCol: { gap: 10 },
  pill: {
    height: 56,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.cardBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillOn: { borderColor: Colors.terracotta, backgroundColor: Colors.terracotta },
  pillText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyLG,
    color: Colors.asphalt,
  },
  pillTextOn: { color: Colors.cream },

  // ── Step 1 comment reveal ──
  commentReveal: {
    overflow: 'hidden',
    marginTop: 6,
    justifyContent: 'flex-start',
  },
  commentLabel: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: Colors.secondary,
    marginBottom: 8,
  },
  commentInput: {
    backgroundColor: Colors.cardBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 12,
    minHeight: 72,
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
    textAlignVertical: 'top',
  },
  commentHint: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.tertiary,
    marginTop: 6,
  },

  // ── Step 2 attendance rows ──
  whoHelper: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.secondary,
    lineHeight: 19,
    marginBottom: 14,
  },
  attendList: { gap: 2 },
  attendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  // "Didn't make it" = the whole row dims. The faded rows answer "who's out" at
  // a glance; no strikethrough anywhere (striking "Didn't make it" double-negates).
  attendRowOut: { opacity: 0.5 },
  attendName: {
    flex: 1,
    minWidth: 0,
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
  },
  tag: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  // Made = gold-tint FILL + ink text (reads filled). Missed = plain outline.
  tagMade: { borderColor: Colors.gold, backgroundColor: Colors.surveyChipFill },
  tagMissed: { borderColor: Colors.border, backgroundColor: 'transparent' },
  tagText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM },
  tagTextMade: { color: Colors.asphalt },
  tagTextMissed: { color: Colors.secondary },

  // ── Step 3 keep chips ──
  keepHeadline: {
    fontFamily: Fonts.displayItalic,
    fontSize: FontSizes.displayMD,
    color: Colors.asphalt,
    lineHeight: 28,
    marginBottom: 18,
  },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 7,
    paddingLeft: 7,
    paddingRight: 14,
    borderRadius: 24,
    borderWidth: 1.5,
  },
  // Selected reads ADDED: gold-tint fill + terracotta ring + full-color avatar/ink.
  chipOn: { borderColor: Colors.terracotta, backgroundColor: Colors.surveyChipFill },
  // Deselected is a ghost: no fill, faint border, avatar + text dimmed.
  chipOff: { borderColor: Colors.border, backgroundColor: 'transparent', opacity: 0.45 },
  chipName: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodySM,
    color: Colors.asphalt,
  },

  // ── Step 3 footer (equal-weight Add / Skip) ──
  keepRow: { flexDirection: 'row', gap: 10, marginBottom: 8 },
  keepBtn: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keepBtnFill: { backgroundColor: Colors.terracotta },
  keepBtnFillText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyLG,
    color: Colors.white,
  },
  keepBtnGhost: { borderWidth: 1.5, borderColor: Colors.border },
  keepBtnGhostText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyLG,
    color: Colors.asphalt,
  },

  // ── Outcome overlay ──
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
  },
  toast: {
    backgroundColor: Colors.darkWarm,
    borderRadius: 18,
    overflow: 'hidden',
  },
  toastRule: { height: 3, backgroundColor: Colors.gold },
  toastInner: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16 },
  toastEyebrow: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    color: Colors.gold,
    marginBottom: 6,
  },
  toastTitle: {
    fontFamily: Fonts.displayItalic,
    fontSize: FontSizes.displaySM,
    color: Colors.white,
    lineHeight: 26,
  },
  toastQuiet: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.overlayWhite,
    marginTop: 6,
  },
  toastDismiss: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.tertiary,
    marginTop: 10,
  },
  // Quiet variant (request-sent / failure, no mutual): a LIGHT cream/gold inline
  // toast. The dark gold-rule card is reserved exclusively for mutual moments.
  quietLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.surveyQuietBg,
    borderWidth: 1,
    borderColor: Colors.goldAccent,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 18,
  },
  quietDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.gold },
  quietTextCol: { flex: 1, gap: 3 },
  quietText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.asphalt,
  },
});
