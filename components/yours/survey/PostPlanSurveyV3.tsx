/**
 * Post-plan survey v3. ONE survey, replacing both the legacy survey and
 * SurveyV2. Memory + people-growth first; attendance is plan-type-aware.
 *
 * Flow (every beat escapable):
 *   1. "How was it?" (always)        -> upsert_plan_feedback (complete state)
 *   2. "Did these people attend?" (conditional) -> explicit no_show_reports
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
 * state (last-write-wins). Feedback errors never trap. Attendance failures stay
 * visible and retryable; skipping remains available while requests are pending.
 *
 * No emoji, no em dashes, no forbidden words.
 */
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  Keyboard,
  KeyboardAvoidingView,
  Animated,
  Dimensions,
  Platform,
  useWindowDimensions,
  ScrollView,
} from 'react-native';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { supabase } from '../../../lib/supabase';
import { requestWithDeadline } from '../../../lib/requestWithDeadline';
import { sendOrAcceptPeopleRequest } from '../../../lib/yours/connectionRequests';
import { hapticSelection, hapticSuccess } from '../../../lib/haptics';
import { YOURS_PAGE_ENABLED } from '../../../constants/FeatureFlags';
import { useReduceMotion } from '../a11y/useReduceMotion';
import { COPY } from '../state/constants';
import {
  markPostPlanSurveyHandled,
  type SurveyProps,
  type SurveyMember,
} from '../../PostPlanSurvey';

import { PlanCardBehind, SheetHeader, Footer, StepHow, StepWho, StepKeep, KeepFooter, type Rating, type AttendanceAnswer } from './SurveyPresentation';
import { styles } from './surveyStyles';

// ─── Types ────────────────────────────────────────────────────────────────
type Step = 'how' | 'who' | 'keep';

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
export default function PostPlanSurveyV3(props: SurveyProps) {
  // Each opening, plan and account owns fresh, initially unanswered choices.
  return props.visible ? <SurveySession key={`${props.userId}:${props.plan.id}`} {...props} /> : null;
}

function SurveySession({
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

  const { height: windowHeight, fontScale } = useWindowDimensions();
  // Fixed headings and summaries can consume the entire list viewport on
  // small screens or with larger text. Keep those sections in the scroll flow.
  const scrollSections = windowHeight < 740 || fontScale > 1.3;
  const [step, setStep] = useState<Step>('how');
  const [rating, setRating] = useState<Rating | null>(null);
  const [comment, setComment] = useState('');
  const [showComment, setShowComment] = useState(false);
  const bodyScroll = useRef<ScrollView>(null);
  useEffect(() => { bodyScroll.current?.scrollTo({ y: 0, animated: false }); }, [step]);
  const commentFocused = useRef(false);
  const revealFocusedComment = () => {
    if (step === 'how' && commentFocused.current) bodyScroll.current?.scrollToEnd({ animated: false });
  };
  const [answers, setAnswers] = useState<Record<string, AttendanceAnswer>>({});
  const noShows = useMemo(() => new Set(peoplePool.filter(member => answers[member.id] === 'no_show').map(member => member.id)), [answers, peoplePool]);
  const [attendanceStarted, setAttendanceStarted] = useState(false);
  const attendanceFrozen = useRef(false);
  const [attendanceError, setAttendanceError] = useState<string | null>(null);
  const attendanceAttempt = useRef<object | null>(null);
  const attendanceCommitted = useRef(new Set<string>());
  const ratingAdvanced = useRef(false);
  const keepAttempt = useRef<object | null>(null);
  const mounted = useRef(false);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; attendanceAttempt.current = null; keepAttempt.current = null; }; }, []);
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
  const isCurrent = () => mounted.current && !exitedRef.current;
  // True once the user commits the TOP rating ("Really good"). Reported up on
  // exit so the owner can fire the native review ask after this modal dismisses.
  const topRatedRef = useRef(false);

  // ── Grow-sheet motion. translateY: enter/exit. sheetHeight: monotonic grow
  // from HALF to TALL on the first non-'how' step. Both JS-driven so height can
  // animate; Reduce Motion snaps to final.
  const reduceMotion = useReduceMotion();
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(SCREEN_H)).current;
  const backdrop = useRef(new Animated.Value(0)).current;
  const sheetHeight = useRef(new Animated.Value(HALF_H)).current;
  const grownRef = useRef(false);

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
    if (!isCurrent()) return;
    exitedRef.current = true;
    Keyboard.dismiss();
    attendanceAttempt.current = null;
    keepAttempt.current = null;
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
    ]).start(() => { if (mounted.current) onComplete(topRatedRef.current); });
  };

  // Rail 3: complete-state upsert (rating + comment together), fire-and-forget.
  const commitFeedback = (r: Rating, cmt: string | null) => {
    if (!isCurrent()) return;
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

  const submitAttendance = async () => {
    if (!isCurrent() || attendanceAttempt.current || !showWhoMadeIt) return;
    const attempt = {}; attendanceAttempt.current = attempt;
    const current = () => isCurrent() && attendanceAttempt.current === attempt;
    const selected = new Set(noShows);
    setAttendanceError(null);
    if (selected.size === 0) {
      attendanceAttempt.current = null;
      goToKeepOrClose(selected);
      return;
    }
    // Once reports have been dispatched, keep this submitted selection stable.
    // A timeout may have committed; the existing RPC makes retries idempotent.
    attendanceFrozen.current = true;
    setAttendanceStarted(true); setBusy(true);
    try {
      const auth = await requestWithDeadline(supabase.auth.getUser(), 8000);
      if (!current()) return;
      if (auth.error || auth.data.user?.id !== userId) throw new Error('account changed');
      const results = await Promise.allSettled([...selected].filter(id => !attendanceCommitted.current.has(id)).map(async id => {
        if (!current()) return;
        const response = await requestWithDeadline(supabase.rpc('report_no_show', { p_event_id: plan.id, p_no_show_user_id: id }), 8000);
        if (response.error) throw response.error;
        if (current()) attendanceCommitted.current.add(id);
      }));
      if (!current()) return;
      if (results.some(result => result.status === 'rejected')) throw new Error('report failed');
      attendanceAttempt.current = null;
      setBusy(false);
      goToKeepOrClose(selected);
    } catch {
      if (current()) {
        attendanceAttempt.current = null;
        setBusy(false);
        setAttendanceError('Some no-show reports couldn’t be submitted. Try again or skip the rest. Reports already sent are kept.');
      }
    }
  };

  const skipAttendance = () => {
    if (!isCurrent()) return;
    attendanceAttempt.current = null;
    setBusy(false); setAttendanceError(null);
    // Skipping before submission must never turn a selection into a report.
    if (!attendanceFrozen.current) setAnswers({});
    goToKeepOrClose(attendanceFrozen.current ? noShows : new Set());
  };

  // Step 3 gating: only with the people system on, and only when there is at
  // least one eligible person (incoming_pending or none; mutual / outgoing /
  // blocked are excluded server-side via keep_state). Otherwise close.
  const goToKeepOrClose = (currentNoShows: Set<string>) => {
    if (!isCurrent()) return;
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
    if (!isCurrent() || keepAttempt.current) return;
    const selected = keepCandidates.filter((m) => addSel.has(m.id));
    if (selected.length === 0) return;
    const attempt = {}; keepAttempt.current = attempt;
    const current = () => isCurrent() && keepAttempt.current === attempt;
    setBusy(true);
    const auth = await requestWithDeadline(supabase.auth.getUser(), 8000).catch(() => null);
    if (!current()) return;
    if (!auth || auth.error || auth.data.user?.id !== userId) {
      keepAttempt.current = null; setBusy(false); setResult({ connectedNames: [], requested: 0, failed: true }); return;
    }
    const settled = await Promise.allSettled(
      selected.map(async (m) => {
        const outcome = await requestWithDeadline(sendOrAcceptPeopleRequest({
          recipientId: m.id,
          context: 'plan_history',
          contextEventId: plan.id,
        }), 8000);
        return { member: m, outcome };
      }),
    );
    if (!current()) return;
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

  const header = (
    <SheetHeader
      eyebrow={plan.title}
      title={headerTitle}
      current={stepIndex[step]}
      total={totalSteps}
    />
  );
  const attendanceSummary = step === 'who' && (
    <View style={styles.attendanceSummary}>
      <Text accessibilityLiveRegion="polite" style={styles.whoHelper}>
        {noShows.size === 1 ? '1 person marked ‘Didn’t show up.’' : `${noShows.size} people marked ‘Didn’t show up.’`}
      </Text>
      {attendanceError && <Text accessibilityRole="alert" style={styles.attendanceError}>{attendanceError}</Text>}
      <Pressable accessibilityRole="button" accessibilityLabel={attendanceStarted ? 'Skip remaining attendance reports' : 'Skip attendance'} style={styles.skipAttendance} onPress={skipAttendance}>
        <Text style={styles.escapeText}>{attendanceStarted ? 'Skip remaining' : 'Skip'}</Text>
      </Pressable>
    </View>
  );

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
          <KeyboardAvoidingView
            style={[styles.keyboardSpace, { paddingTop: insets.top + 8 }]}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          >
          <Animated.View
            style={[
              styles.sheet,
              { height: sheetHeight, transform: [{ translateY }] },
            ]}
          >
            <View style={styles.handle} />
            {!scrollSections && header}

            {/* Bodies land in checkpoints 2-4. */}
            <Animated.ScrollView
              ref={bodyScroll}
              style={styles.body}
              contentContainerStyle={scrollSections ? styles.scrollingSections : styles.bodyContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              onLayout={revealFocusedComment}
              onContentSizeChange={() => {
                if (scrollSections && attendanceError) bodyScroll.current?.scrollToEnd({ animated: false });
                else revealFocusedComment();
              }}
            >
              {scrollSections && header}
              <View style={scrollSections ? styles.bodyContent : undefined}>
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
                    onCommentFocus={() => { commentFocused.current = true; revealFocusedComment(); }}
                    onCommentBlur={() => { commentFocused.current = false; }}
                  />
                )}
                {step === 'who' && (
                  <StepWho
                    list={whoMadeItList}
                    answers={answers}
                    disabled={attendanceStarted}
                    onAnswer={(id, answer) => {
                      if (!isCurrent() || attendanceFrozen.current || attendanceAttempt.current) return;
                      hapticSelection();
                      setAnswers(current => ({ ...current, [id]: answer }));
                    }}
                  />
                )}
                {step === 'keep' && (
                  <StepKeep
                    candidates={keepCandidates}
                    selected={addSel}
                    disabled={busy || !!result}
                    onToggle={(id) => {
                      if (!isCurrent() || keepAttempt.current) return;
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
              </View>
              {scrollSections && attendanceSummary}
            </Animated.ScrollView>

            {!scrollSections && attendanceSummary}

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
                primaryLabel={attendanceError ? 'Try again' : COPY.surveyContinue}
                primaryActive={step !== 'how' || rating != null}
                busy={busy}
                onPrimary={() => {
                  if (!isCurrent()) return;
                  if (step === 'how') {
                    if (rating == null || ratingAdvanced.current) return;
                    ratingAdvanced.current = true;
                    Keyboard.dismiss();
                    if (rating !== 'thumbs_down') commitFeedback(rating, null);
                    else commitFeedback('thumbs_down', comment.trim() || null);
                    // The TOP rating is the soft-ask for the native review sheet;
                    // recorded here, fired by the owner after this modal closes.
                    topRatedRef.current = rating === 'thumbs_up';
                    afterRating();
                  } else {
                    void submitAttendance();
                  }
                }}
                onEscape={exit}
              />
            )}
          </Animated.View>
          </KeyboardAvoidingView>

          {result && (
            <SurveyOutcomeOverlay result={result} onDismiss={exit} />
          )}
        </View>
      </SafeAreaProvider>
    </Modal>
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
