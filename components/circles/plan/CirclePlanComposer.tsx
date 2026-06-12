/**
 * CirclePlanComposer - the "Make a plan" sheet, opened from a circle chat or a
 * DM (never from inside an individual plan chat). A circle plan is a real
 * events row created via create_circle_plan. Gated upstream by GROUPS_ENABLED.
 *
 * The sheet carries the standard plan fields (what / where / when) above the
 * one circle-specific question, WHO IS THIS FOR, which quietly sets both the
 * audience and whether the plan gets its own chat:
 *   Just us  + everyone  -> circle_only, lives in the circle chat (no new chat)
 *   Just us  + pick people-> circle_only, its own chat for the picked subset
 *   Open it up           -> open, posts to the public feed, its own chat
 *
 * v1 notes (see docs/circle-plans-build-notes.md): "Where" is free text (no
 * Places autocomplete / lat-lng); gender is not set here (all circle plans are
 * mixed, matching the spec's "inherited, not set here").
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
} from 'react-native';
import Animated, { FadeInDown, ZoomIn } from 'react-native-reanimated';
import { Minus, Plus } from 'lucide-react-native';
import { hapticSelection } from '../../../lib/haptics';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';
import { CIRCLE_PLAN } from '../../../constants/YoursDesign';
import { COPY } from '../../yours/state/constants';
import { useAuthUserId } from '../../yours/state/useAuthUserId';
import BottomSheet from '../../yours/primitives/BottomSheet';
import { type CalendarDay } from '../../calendar/WashedUpCalendar';
import CollapsibleCalendar from '../../composer/CollapsibleCalendar';
import TimePicker from '../../composer/TimePicker';
import InlineNudge from '../../composer/InlineNudge';
import { useNudgeArbiter, NUDGE_PLACE_BASE, NUDGE_PLACE_WARM } from '../../composer/nudgeArbiter';
import { getTodayInLA, laWallTimeToUTC } from '../../../lib/laDate';
import {
  useCreateCirclePlan,
  CreateCirclePlanResult,
} from '../../../hooks/useCreateCirclePlan';
import EditorialTitleField from '../../composer/EditorialTitleField';
import CategoryChips from '../../composer/CategoryChips';
import PlacePicker, { type PlaceValue } from '../../composer/place/PlacePicker';
import { type PlanCategory } from '../../../constants/Categories';

interface ComposerMember {
  user_id: string;
  first_name_display: string | null;
  profile_photo_url: string | null;
}

interface CirclePlanComposerProps {
  visible: boolean;
  onClose: () => void;
  circleId: string;
  /** Resolved display name (member names for an unnamed circle / DM). */
  circleName: string;
  members: ComposerMember[];
  /** A DM is a 2-person circle: hide the "pick people" subset path. */
  isDm: boolean;
  onPosted: (result: CreateCirclePlanResult) => void;
}

const MINUTES = [0, 15, 30, 45] as const;
const STRANGER_MIN = 2;
const STRANGER_MAX = 7;
const STRANGER_DEFAULT = 4;

function todayCalendarDay(): CalendarDay {
  const t = getTodayInLA();
  return { year: t.y, month: t.m, day: t.d };
}

export default function CirclePlanComposer({
  visible,
  onClose,
  circleId,
  circleName,
  members,
  isDm,
  onPosted,
}: CirclePlanComposerProps) {
  const { data: myUserId } = useAuthUserId();
  const createPlan = useCreateCirclePlan();

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<PlanCategory | null>(null);
  const [where, setWhere] = useState('');
  const [date, setDate] = useState<CalendarDay>(todayCalendarDay);
  const [hour, setHour] = useState(7);
  const [minute, setMinute] = useState('00');
  const [period, setPeriod] = useState<'AM' | 'PM'>('PM');
  const [visibilityOpen, setVisibilityOpen] = useState(false); // false = circle only
  const [strangerCap, setStrangerCap] = useState(STRANGER_DEFAULT);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setTitle('');
    setCategory(null);
    setWhere('');
    setDate(todayCalendarDay());
    setHour(7);
    setMinute('00');
    setPeriod('PM');
    setVisibilityOpen(false);
    setStrangerCap(STRANGER_DEFAULT);
    setError(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  const selectQuick = (k: 'tonight' | 'tomorrow') => {
    hapticSelection();
    const t = getTodayInLA();
    const base = new Date(t.y, t.m, t.d);
    if (k === 'tomorrow') base.setDate(base.getDate() + 1);
    setDate({ year: base.getFullYear(), month: base.getMonth(), day: base.getDate() });
  };

  const activeQuick: 'tonight' | 'tomorrow' | null = (() => {
    const t = getTodayInLA();
    if (date.year === t.y && date.month === t.m && date.day === t.d) return 'tonight';
    const tm = new Date(t.y, t.m, t.d);
    tm.setDate(tm.getDate() + 1);
    if (date.year === tm.getFullYear() && date.month === tm.getMonth() && date.day === tm.getDate()) return 'tomorrow';
    return null;
  })();

  // Single owner of the one visible gold line. No recovery nudge here (post
  // failures show the inline error), so the arbiter just picks between the two
  // Tier-3 nudges: most recently triggered wins.
  const nudge = useNudgeArbiter({
    recoveryActive: false,
    tonightEligible: activeQuick === 'tonight',
    placeSkipEligible: !where.trim(),
  });

  const buildStartTime = (): Date => {
    let h = hour % 12;
    if (period === 'PM') h += 12;
    // Pin to the LA wall clock, not the device's local zone (see laDate).
    return laWallTimeToUTC(date.year, date.month, date.day, h, parseInt(minute, 10));
  };

  const onPost = async () => {
    setError(null);
    if (!title.trim()) {
      setError(COPY.circlePlanTitleRequired);
      return;
    }
    const start = buildStartTime();
    if (start.getTime() <= Date.now()) {
      setError(COPY.circlePlanWhenRequired);
      return;
    }
    try {
      const result = await createPlan.mutateAsync({
        circleId,
        title: title.trim(),
        startTime: start.toISOString(),
        visibility: visibilityOpen ? 'open' : 'circle_only',
        strangerCap: visibilityOpen ? strangerCap : null,
        // "Pick people" is cut: the whole circle is always the audience. An open
        // plan still gets its own chat (RPC: has_own_chat keys on visibility,
        // not on member ids), so the chat-spawn machinery is unaffected.
        memberUserIds: null,
        locationText: where.trim() || null,
        primaryVibe: category?.toLowerCase() ?? null,
      });
      close();
      onPosted(result);
    } catch {
      setError(COPY.circlePlanError);
    }
  };

  const postDisabled = createPlan.isPending || !title.trim();

  return (
    <BottomSheet visible={visible} onClose={close} heightPct={CIRCLE_PLAN.sheetHeightPct} springMotion>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetEyebrow}>{circleName}</Text>
          <Text style={styles.sheetTitle}>{COPY.circlePlanComposerTitle}</Text>
        </View>

        {/* What */}
        <EditorialTitleField
          value={title}
          onChangeText={setTitle}
          placeholder={COPY.circlePlanWhatPlaceholder}
          label={COPY.circlePlanWhatLabel}
          maxLength={80}
        />

        {/* Category */}
        <View style={styles.categoryWrap}>
          <CategoryChips selected={category} onSelect={setCategory} />
        </View>

        {/* Where */}
        <Text style={styles.fieldLabel}>{COPY.circlePlanWhereLabel}</Text>
        <View style={styles.whereWrap}>
          <PlacePicker
            value={where.trim() ? { name: where.trim(), lat: null, lng: null, neighborhood: null } : null}
            onChange={(v: PlaceValue | null) => setWhere(v?.name ?? '')}
          />
          {nudge === 'placeSkip' ? (
            <InlineNudge text={visibilityOpen ? NUDGE_PLACE_WARM : NUDGE_PLACE_BASE} />
          ) : null}
        </View>

        {/* When */}
        <Text style={styles.fieldLabel}>{COPY.circlePlanWhenLabel}</Text>
        <View style={styles.quickRow}>
          {(['tonight', 'tomorrow'] as const).map((k) => {
            const on = activeQuick === k;
            return (
              <Pressable
                key={k}
                onPress={() => selectQuick(k)}
                style={[styles.quickChip, on && styles.quickChipOn]}
              >
                <Text style={[styles.quickChipText, on && styles.quickChipTextOn]}>{k}</Text>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.calendarWrap}>
          <CollapsibleCalendar selected={date} onSelect={setDate} />
        </View>
        <View style={styles.timeWrap}>
          <TimePicker
            hour={hour}
            minute={minute}
            period={period}
            selected
            onChange={(h, m, p) => { setHour(h); setMinute(m); setPeriod(p); }}
          />
          {nudge === 'tonight' ? <InlineNudge text={COPY.composerTonightNudge} /> : null}
        </View>

        {/* WHO IS THIS FOR - the audience binary. "Pick people" is cut. */}
        <Text style={styles.sectionLabel}>{COPY.circlePlanWhoLabel}</Text>

        {/* Circle only */}
        <Pressable
          onPress={() => { hapticSelection(); setVisibilityOpen(false); }}
          style={[styles.audCard, !visibilityOpen && styles.audCardOn]}
        >
          <View style={styles.audTop}>
            <View style={styles.audTextWrap}>
              <Text style={styles.audName}>{COPY.circlePlanAudienceCircleOnly(circleName)}</Text>
              <Text style={styles.audSub}>{COPY.circlePlanAudienceCircleOnlySub}</Text>
            </View>
            <View style={[styles.radio, !visibilityOpen && styles.radioOn]}>
              {!visibilityOpen ? <Animated.View entering={ZoomIn.springify().mass(0.5).damping(24).stiffness(500)} style={styles.radioDot} /> : null}
            </View>
          </View>
        </Pressable>

        {/* Open to others (+ stranger stepper reveal + capacity truth) */}
        <Pressable
          onPress={() => { hapticSelection(); setVisibilityOpen(true); }}
          style={[styles.audCard, visibilityOpen && styles.audCardOn]}
        >
          <View style={styles.audTop}>
            <View style={styles.audTextWrap}>
              <Text style={styles.audName}>{COPY.circlePlanAudienceOpen}</Text>
              <Text style={styles.audSub}>{COPY.circlePlanAudienceOpenSub(strangerCap)}</Text>
            </View>
            <View style={[styles.radio, visibilityOpen && styles.radioOn]}>
              {visibilityOpen ? <Animated.View entering={ZoomIn.springify().mass(0.5).damping(24).stiffness(500)} style={styles.radioDot} /> : null}
            </View>
          </View>

          {visibilityOpen ? (
            <Animated.View
              entering={FadeInDown.springify().mass(0.7).damping(28).stiffness(350)}
              style={styles.stepperReveal}
            >
              <Text style={styles.stepperRevealLabel}>{COPY.circlePlanSpotsForOthers}</Text>
              <View style={styles.stepperInline}>
                <Pressable
                  onPress={() => setStrangerCap((c) => Math.max(STRANGER_MIN, c - 1))}
                  disabled={strangerCap <= STRANGER_MIN}
                  style={[styles.stepperBtn, strangerCap <= STRANGER_MIN && styles.stepperBtnOff]}
                >
                  <Minus size={16} color={strangerCap <= STRANGER_MIN ? Colors.tertiary : Colors.terracotta} strokeWidth={2.5} />
                </Pressable>
                <Text style={styles.stepperValue}>{strangerCap}</Text>
                <Pressable
                  onPress={() => setStrangerCap((c) => Math.min(STRANGER_MAX, c + 1))}
                  disabled={strangerCap >= STRANGER_MAX}
                  style={[styles.stepperBtn, strangerCap >= STRANGER_MAX && styles.stepperBtnOff]}
                >
                  <Plus size={16} color={strangerCap >= STRANGER_MAX ? Colors.tertiary : Colors.terracotta} strokeWidth={2.5} />
                </Pressable>
                <Text style={styles.stepperRange}>{COPY.circlePlanStrangerRange}</Text>
              </View>
              <View style={styles.capacityTruthPill}>
                <Text style={styles.capacityTruthText}>
                  {COPY.circlePlanCapacityTruth(members.length, strangerCap)}
                </Text>
              </View>
            </Animated.View>
          ) : null}
        </Pressable>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          onPress={onPost}
          disabled={postDisabled}
          style={[styles.postBtn, postDisabled && styles.postBtnDisabled]}
        >
          <Text style={styles.postBtnText}>
            {visibilityOpen ? COPY.circlePlanPostToFeed : COPY.circlePlanPostToCircle(circleName)}
          </Text>
        </Pressable>
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: CIRCLE_PLAN.sectionGap },
  title: {
    fontFamily: Fonts.displayBold,
    fontSize: 26,
    color: Colors.darkWarm,
    marginBottom: CIRCLE_PLAN.sectionGap,
  },
  fieldLabel: {
    fontFamily: Fonts.sansSemibold,
    fontSize: 13,
    color: Colors.terracotta,
    letterSpacing: 1.3,
    textTransform: 'uppercase',
    marginBottom: CIRCLE_PLAN.labelGap,
  },
  field: {
    minHeight: CIRCLE_PLAN.fieldMinHeight,
    borderRadius: CIRCLE_PLAN.fieldRadius,
    backgroundColor: Colors.inputBg,
    paddingHorizontal: CIRCLE_PLAN.fieldPadH,
    paddingVertical: CIRCLE_PLAN.fieldPadV,
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyLG,
    color: Colors.darkWarm,
    marginBottom: CIRCLE_PLAN.sectionGap,
  },
  categoryWrap: { marginBottom: CIRCLE_PLAN.sectionGap },
  whereWrap: { marginBottom: CIRCLE_PLAN.sectionGap },
  calendarWrap: {},
  timeWrap: { marginBottom: CIRCLE_PLAN.sectionGap },
  quickRow: { flexDirection: 'row', gap: 7, marginBottom: CIRCLE_PLAN.labelGap },
  quickChip: {
    paddingHorizontal: 13, paddingVertical: 7, borderRadius: 16,
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.white,
  },
  quickChipOn: { backgroundColor: Colors.terracotta, borderColor: Colors.terracotta },
  quickChipText: { fontFamily: Fonts.sansSemibold, fontSize: 13, color: Colors.secondary },
  quickChipTextOn: { color: Colors.white },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: CIRCLE_PLAN.chipGap,
    marginBottom: CIRCLE_PLAN.chipGap,
  },
  timeChipsContent: { gap: CIRCLE_PLAN.chipGap, paddingRight: CIRCLE_PLAN.fieldPadH },
  timeChip: {
    minWidth: CIRCLE_PLAN.timeChipMinWidth,
    paddingHorizontal: CIRCLE_PLAN.dayChipPadH,
    paddingVertical: CIRCLE_PLAN.dayChipPadV,
    borderRadius: CIRCLE_PLAN.chipRadius,
    backgroundColor: Colors.inputBg,
    alignItems: 'center',
  },
  timeChipOn: { backgroundColor: Colors.terracotta },
  timeChipText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.secondary },
  timeChipTextOn: { color: Colors.white, fontFamily: Fonts.sansBold },
  periodGroup: { flexDirection: 'row', gap: CIRCLE_PLAN.chipGap, marginLeft: 'auto' },
  sectionLabel: {
    fontFamily: Fonts.sansSemibold,
    fontSize: 13,
    color: Colors.terracotta,
    letterSpacing: 1.3,
    textTransform: 'uppercase',
    marginTop: CIRCLE_PLAN.chipGap,
    marginBottom: CIRCLE_PLAN.labelGap,
  },
  audienceCard: {
    borderRadius: CIRCLE_PLAN.cardRadius,
    borderWidth: CIRCLE_PLAN.cardBorder,
    borderColor: Colors.border,
    backgroundColor: Colors.cardBg,
    paddingVertical: CIRCLE_PLAN.cardPadV,
    paddingHorizontal: CIRCLE_PLAN.cardPadH,
    marginBottom: CIRCLE_PLAN.cardGap,
  },
  audienceCardOn: { borderColor: Colors.terracotta, backgroundColor: Colors.accentSubtle },
  audienceTitle: {
    fontFamily: Fonts.displayBold,
    fontSize: FontSizes.bodyLG,
    color: Colors.darkWarm,
    marginBottom: 2,
  },
  audienceSub: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.secondary },
  recipientBlock: { marginBottom: CIRCLE_PLAN.cardGap },
  chipRow: { flexDirection: 'row', gap: CIRCLE_PLAN.chipGap, marginBottom: CIRCLE_PLAN.labelGap },
  recipientChip: {
    paddingHorizontal: CIRCLE_PLAN.chipPadH,
    paddingVertical: CIRCLE_PLAN.chipPadV,
    borderRadius: CIRCLE_PLAN.chipRadius,
    backgroundColor: Colors.inputBg,
  },
  recipientChipGhost: {
    paddingHorizontal: CIRCLE_PLAN.chipPadH,
    paddingVertical: CIRCLE_PLAN.chipPadV,
    borderRadius: CIRCLE_PLAN.chipRadius,
    borderWidth: CIRCLE_PLAN.cardBorder,
    borderColor: Colors.border,
  },
  recipientChipOn: { backgroundColor: Colors.terracotta, borderColor: Colors.terracotta },
  recipientChipText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.secondary },
  recipientChipGhostText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.secondary },
  recipientChipTextOn: { color: Colors.white, fontFamily: Fonts.sansBold },
  helper: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.tertiary, lineHeight: 18 },
  memberList: { marginTop: CIRCLE_PLAN.labelGap, gap: 4 },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: CIRCLE_PLAN.memberRowGap, paddingVertical: 6 },
  memberAvatar: { width: CIRCLE_PLAN.memberAvatar, height: CIRCLE_PLAN.memberAvatar, borderRadius: CIRCLE_PLAN.memberAvatar / 2, backgroundColor: Colors.inputBg },
  memberAvatarPlaceholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.accentSubtle },
  memberInitial: { fontFamily: Fonts.displayBold, fontSize: FontSizes.bodyLG, color: Colors.terracotta },
  memberName: { flex: 1, fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.darkWarm },
  memberCheck: {
    width: CIRCLE_PLAN.memberCheck,
    height: CIRCLE_PLAN.memberCheck,
    borderRadius: CIRCLE_PLAN.memberCheck / 2,
    borderWidth: CIRCLE_PLAN.cardBorder,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberCheckOn: { backgroundColor: Colors.terracotta, borderColor: Colors.terracotta },
  stepperBlock: { marginBottom: CIRCLE_PLAN.cardGap },
  stepperLabel: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.darkWarm, marginBottom: CIRCLE_PLAN.labelGap },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: CIRCLE_PLAN.stepperGap, marginBottom: CIRCLE_PLAN.labelGap },
  stepperBtn: {
    width: CIRCLE_PLAN.stepperBtn,
    height: CIRCLE_PLAN.stepperBtn,
    borderRadius: CIRCLE_PLAN.stepperRadius,
    borderWidth: CIRCLE_PLAN.cardBorder,
    borderColor: Colors.terracotta,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperBtnOff: { borderColor: Colors.border },
  stepperValue: { fontFamily: Fonts.displayBold, fontSize: 24, color: Colors.darkWarm, minWidth: 28, textAlign: 'center' },
  error: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.errorBrand, marginBottom: CIRCLE_PLAN.labelGap },
  postBtn: {
    height: CIRCLE_PLAN.postHeight,
    borderRadius: CIRCLE_PLAN.postRadius,
    backgroundColor: Colors.terracotta,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: CIRCLE_PLAN.chipGap,
  },
  postBtnDisabled: { opacity: 0.5 },
  postBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.white },

  // Sheet header (eyebrow = circle name)
  sheetHeader: { marginBottom: CIRCLE_PLAN.sectionGap },
  sheetEyebrow: {
    fontFamily: Fonts.sansSemibold, fontSize: 13, letterSpacing: 1.3,
    textTransform: 'uppercase', color: Colors.terracotta, marginBottom: 2,
  },
  sheetTitle: { fontFamily: Fonts.displayBold, fontSize: 26, color: Colors.darkWarm },

  // Audience binary cards
  audCard: {
    borderRadius: CIRCLE_PLAN.cardRadius,
    borderWidth: CIRCLE_PLAN.cardBorder,
    borderColor: Colors.border,
    backgroundColor: Colors.cardBg,
    paddingVertical: CIRCLE_PLAN.cardPadV,
    paddingHorizontal: CIRCLE_PLAN.cardPadH,
    marginBottom: CIRCLE_PLAN.cardGap,
  },
  audCardOn: { borderColor: Colors.terracotta, backgroundColor: Colors.accentSubtle },
  audTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  audTextWrap: { flex: 1, paddingRight: 12 },
  audName: { fontFamily: Fonts.displayBold, fontSize: FontSizes.bodyLG, color: Colors.darkWarm, marginBottom: 3 },
  audSub: { fontFamily: Fonts.sans, fontSize: 13, lineHeight: 18, color: Colors.secondary },
  radio: {
    width: 20, height: 20, borderRadius: 10, marginTop: 2,
    borderWidth: 1.5, borderColor: Colors.borderWarm,
    alignItems: 'center', justifyContent: 'center',
  },
  radioOn: { borderColor: Colors.terracotta },
  radioDot: { width: 9, height: 9, borderRadius: 4.5, backgroundColor: Colors.terracotta },

  // Stranger stepper reveal
  stepperReveal: {
    marginTop: 14, paddingTop: 14,
    borderTopWidth: 1, borderTopColor: Colors.overlayWarm,
  },
  stepperRevealLabel: { fontFamily: Fonts.sansSemibold, fontSize: 13, color: Colors.secondary, marginBottom: 10 },
  stepperInline: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  stepperRange: { fontFamily: Fonts.sans, fontSize: 13, color: Colors.tertiary, marginLeft: 4 },

  // Capacity truth (gold-tinted pill + readable warm text)
  capacityTruthPill: {
    marginTop: 12, alignSelf: 'flex-start',
    backgroundColor: Colors.goldBadgeSoft, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 7,
  },
  capacityTruthText: { fontFamily: Fonts.sansMedium, fontSize: 13, color: Colors.quoteText },
});
