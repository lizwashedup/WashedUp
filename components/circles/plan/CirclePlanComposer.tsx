/**
 * CirclePlanComposer - the "Make a plan" sheet, opened from a circle chat or a
 * DM (never from inside an individual plan chat). A circle plan is a real
 * events row created via create_circle_plan. Gated upstream by GROUPS_ENABLED.
 *
 * The sheet carries the standard plan fields (what / where / when) above the
 * one circle-specific question, WHO IS THIS FOR, which quietly sets both the
 * audience and whether the plan gets its own chat:
 *   Just us  + everyone  -> circle_only, lives in the circle chat (no new chat)
 *   Just us  + pick people -> circle_only, its own chat for the picked subset
 *   Open it up           -> open, posts to the public feed, its own chat
 *
 * v1 notes (see docs/circle-plans-build-notes.md): "Where" is free text (no
 * Places autocomplete / lat-lng); gender is not set here (all circle plans are
 * mixed, matching the spec's "inherited, not set here").
 */
import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  TextInput,
} from 'react-native';
import { Image } from 'expo-image';
import Animated, { FadeInDown, ZoomIn } from 'react-native-reanimated';
import { Check, Minus, Plus } from 'lucide-react-native';
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

/** One row in the "pick people" multiselect: avatar, name, a terracotta check. */
function PickMemberRow({
  member,
  selected,
  onToggle,
}: {
  member: ComposerMember;
  selected: boolean;
  onToggle: () => void;
}) {
  const name = member.first_name_display?.trim() || 'Someone';
  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={onToggle}
      style={styles.memberRow}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={name}
    >
      {member.profile_photo_url ? (
        <Image source={{ uri: member.profile_photo_url }} style={styles.memberAvatar} />
      ) : (
        <View style={[styles.memberAvatar, styles.memberAvatarPlaceholder]}>
          <Text style={styles.memberInitial}>{name[0]?.toUpperCase() ?? '?'}</Text>
        </View>
      )}
      <Text style={styles.memberName} numberOfLines={1}>{name}</Text>
      <View style={[styles.memberCheck, selected && styles.memberCheckOn]}>
        {selected ? <Check size={12} color={Colors.white} strokeWidth={3} /> : null}
      </View>
    </TouchableOpacity>
  );
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
  // Required only when the plan is opened to others (strangers lack the circle's
  // built-in context); circle-only plans stay title-first.
  const [description, setDescription] = useState('');
  const [date, setDate] = useState<CalendarDay>(todayCalendarDay);
  const [hour, setHour] = useState(7);
  const [minute, setMinute] = useState('00');
  const [period, setPeriod] = useState<'AM' | 'PM'>('PM');
  const [visibilityOpen, setVisibilityOpen] = useState(false); // false = circle only
  const [strangerCap, setStrangerCap] = useState(STRANGER_DEFAULT);
  // "Who exactly" (Just-us only, hidden for a DM): the whole circle, or a
  // picked subset. This is the chat-spawn signal, never surfaced as a "make a
  // chat?" question of its own (see file header + spec section 4).
  const [pickMode, setPickMode] = useState<'everyone' | 'subset'>('everyone');
  const [pickedIds, setPickedIds] = useState<Set<string>>(new Set());
  // Non-destructive feedback, gold never red (moments Tier 3/4). `hint` is a
  // warm validation line shown on a blocked post attempt; `recoveryActive` is
  // the Tier-4 soft recovery after a post failed (mirrors PlanComposerV2).
  const [hint, setHint] = useState<string | null>(null);
  const [recoveryActive, setRecoveryActive] = useState(false);

  const reset = () => {
    setTitle('');
    setCategory(null);
    setWhere('');
    setDescription('');
    setDate(todayCalendarDay());
    setHour(7);
    setMinute('00');
    setPeriod('PM');
    setVisibilityOpen(false);
    setStrangerCap(STRANGER_DEFAULT);
    setPickMode('everyone');
    setPickedIds(new Set());
    setHint(null);
    setRecoveryActive(false);
  };

  const close = () => {
    reset();
    onClose();
  };

  // Circle members other than the poster themselves -- the pickable list. A
  // circle chat (isDm false) is always 3+ real members by definition, so this
  // is never empty when the "pick people" chip is even reachable.
  const otherMembers = useMemo(
    () => members.filter((m) => m.user_id !== myUserId),
    [members, myUserId],
  );
  // True only when the subset path is both reachable (real circle, Just us)
  // and actually chosen. Open it up and a DM never reach "subset".
  const pickingSubset = !isDm && !visibilityOpen && pickMode === 'subset';
  const subsetEmpty = pickingSubset && pickedIds.size === 0;

  const togglePicked = (id: string) => {
    hapticSelection();
    setPickedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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

  // Single owner of the one visible gold line. A Tier-4 recovery (a failed
  // post) suppresses the Tier-3 nudges; otherwise the arbiter picks between the
  // two Tier-3 nudges, most recently triggered wins. A validation `hint` (below)
  // shares the same gold budget: when it shows, the ambient nudges hide too.
  const nudge = useNudgeArbiter({
    recoveryActive,
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
    setHint(null);
    setRecoveryActive(false);
    if (!title.trim()) {
      setHint(COPY.circlePlanTitleRequired);
      return;
    }
    const start = buildStartTime();
    if (start.getTime() <= Date.now()) {
      setHint(COPY.circlePlanWhenRequired);
      return;
    }
    try {
      const result = await createPlan.mutateAsync({
        circleId,
        title: title.trim(),
        startTime: start.toISOString(),
        visibility: visibilityOpen ? 'open' : 'circle_only',
        strangerCap: visibilityOpen ? strangerCap : null,
        // null/empty = the whole circle; a picked subset spawns its own chat
        // for exactly those people (create_circle_plan already handles both
        // server-side). Only reachable for a real circle's Just-us plan --
        // Open it up and a DM (isDm) always pass null here.
        memberUserIds: pickingSubset ? Array.from(pickedIds) : null,
        locationText: where.trim() || null,
        primaryVibe: category?.toLowerCase() ?? null,
        description: visibilityOpen ? (description.trim() || null) : null,
      });
      close();
      onPosted(result);
    } catch {
      // Tier-4 soft recovery: keep every field intact, no red, name the next
      // step. The same shape PlanComposerV2 uses on a failed post.
      setRecoveryActive(true);
    }
  };

  const postDisabled =
    createPlan.isPending ||
    !title.trim() ||
    (visibilityOpen && !description.trim()) ||
    subsetEmpty;

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
          {nudge === 'placeSkip' && !hint ? (
            <InlineNudge text={visibilityOpen ? NUDGE_PLACE_WARM : NUDGE_PLACE_BASE} />
          ) : null}
        </View>

        {/* When */}
        <Text style={styles.fieldLabel}>{COPY.circlePlanWhenLabel}</Text>
        <View style={styles.quickRow}>
          {(['tonight', 'tomorrow'] as const).map((k) => {
            const on = activeQuick === k;
            return (
              <TouchableOpacity
                key={k}
                activeOpacity={0.7}
                onPress={() => selectQuick(k)}
                style={[styles.quickChip, on && styles.quickChipOn]}
              >
                <Text style={[styles.quickChipText, on && styles.quickChipTextOn]}>{k}</Text>
              </TouchableOpacity>
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
          {nudge === 'tonight' && !hint ? <InlineNudge text={COPY.composerTonightNudge} /> : null}
        </View>

        {/* WHO IS THIS FOR - the audience choice. Just us reveals a second,
            secondary choice (progressive disclosure): the whole circle, or a
            picked subset that quietly gets its own chat. See spec section 4. */}
        <Text style={styles.sectionLabel}>{COPY.circlePlanWhoLabel}</Text>

        {/* Just us */}
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => { hapticSelection(); setVisibilityOpen(false); }}
          style={[styles.audCard, !visibilityOpen && styles.audCardOn]}
        >
          <View style={styles.audTop}>
            <View style={styles.audTextWrap}>
              <Text style={styles.audName}>{COPY.circlePlanJustUs}</Text>
              <Text style={styles.audSub}>{COPY.circlePlanJustUsSub(circleName)}</Text>
            </View>
            <View style={[styles.radio, !visibilityOpen && styles.radioOn]}>
              {!visibilityOpen ? <Animated.View entering={ZoomIn.springify().mass(0.5).damping(24).stiffness(500)} style={styles.radioDot} /> : null}
            </View>
          </View>

          {/* Who exactly (the chat-spawn signal). A DM is already exactly the
              2 people in it, so there is no one else to pick -- hidden. */}
          {!visibilityOpen && !isDm ? (
            <Animated.View
              entering={FadeInDown.springify().mass(0.7).damping(28).stiffness(350)}
              style={styles.recipientBlock}
            >
              <View style={styles.chipRow}>
                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={() => { hapticSelection(); setPickMode('everyone'); }}
                  style={[styles.recipientChip, pickMode === 'everyone' && styles.recipientChipOn]}
                >
                  <Text
                    style={[styles.recipientChipText, pickMode === 'everyone' && styles.recipientChipTextOn]}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                  >
                    {COPY.circlePlanEveryone(circleName)}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={() => { hapticSelection(); setPickMode('subset'); }}
                  style={[styles.recipientChipGhost, pickMode === 'subset' && styles.recipientChipOn]}
                >
                  <Text style={[styles.recipientChipGhostText, pickMode === 'subset' && styles.recipientChipTextOn]}>
                    {COPY.circlePlanPickPeople}
                  </Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.helper}>{COPY.circlePlanPickHelper}</Text>

              {pickMode === 'subset' ? (
                <View style={styles.memberList}>
                  {otherMembers.map((m) => (
                    <PickMemberRow
                      key={m.user_id}
                      member={m}
                      selected={pickedIds.has(m.user_id)}
                      onToggle={() => togglePicked(m.user_id)}
                    />
                  ))}
                </View>
              ) : null}
              {subsetEmpty ? <InlineNudge text={COPY.circlePlanPickPeopleRequired} /> : null}
            </Animated.View>
          ) : null}
        </TouchableOpacity>

        {/* Open it up (+ stranger stepper reveal + capacity truth) */}
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => { hapticSelection(); setVisibilityOpen(true); }}
          style={[styles.audCard, visibilityOpen && styles.audCardOn]}
        >
          <View style={styles.audTop}>
            <View style={styles.audTextWrap}>
              <Text style={styles.audName}>{COPY.circlePlanOpenUp}</Text>
              <Text style={styles.audSub}>{COPY.circlePlanOpenUpSub}</Text>
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
              <Text style={styles.stepperRevealLabel}>{COPY.circlePlanStepperLabel}</Text>
              <View style={styles.stepperInline}>
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => setStrangerCap((c) => Math.max(STRANGER_MIN, c - 1))}
                  disabled={strangerCap <= STRANGER_MIN}
                  style={[styles.stepperBtn, strangerCap <= STRANGER_MIN && styles.stepperBtnOff]}
                >
                  <Minus size={16} color={strangerCap <= STRANGER_MIN ? Colors.tertiary : Colors.terracotta} strokeWidth={2.5} />
                </TouchableOpacity>
                <Text style={styles.stepperValue}>{strangerCap}</Text>
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => setStrangerCap((c) => Math.min(STRANGER_MAX, c + 1))}
                  disabled={strangerCap >= STRANGER_MAX}
                  style={[styles.stepperBtn, strangerCap >= STRANGER_MAX && styles.stepperBtnOff]}
                >
                  <Plus size={16} color={strangerCap >= STRANGER_MAX ? Colors.tertiary : Colors.terracotta} strokeWidth={2.5} />
                </TouchableOpacity>
                <Text style={styles.stepperRange}>{COPY.circlePlanStrangerRange}</Text>
              </View>
              <View style={styles.capacityTruthPill}>
                <Text style={styles.capacityTruthText}>
                  {COPY.circlePlanCapacityTruth(members.length, strangerCap)}
                </Text>
              </View>
            </Animated.View>
          ) : null}
        </TouchableOpacity>

        {/* DESCRIPTION (required once opened to others; strangers lack the
            circle's built-in context). Hidden for circle-only plans. */}
        {visibilityOpen ? (
          <Animated.View
            entering={FadeInDown.springify().mass(0.7).damping(28).stiffness(350)}
            style={styles.descWrap}
          >
            <Text style={styles.fieldLabel}>{COPY.circlePlanDescriptionLabel}</Text>
            <TextInput
              style={styles.descInput}
              value={description}
              onChangeText={setDescription}
              placeholder={COPY.circlePlanDescriptionPlaceholder}
              placeholderTextColor={Colors.tertiary}
              multiline
              maxLength={2000}
            />
            {!description.trim() ? (
              <InlineNudge text={COPY.circlePlanDescriptionRequired} />
            ) : null}
          </Animated.View>
        ) : null}

        {/* One gold line, never red. Tier-4 recovery (failed post, tap to
            dismiss) wins; otherwise a Tier-3 validation hint. */}
        {nudge === 'recovery' ? (
          <TouchableOpacity
            style={styles.recoveryNudge}
            onPress={() => setRecoveryActive(false)}
            activeOpacity={0.8}
          >
            <View style={styles.recoveryDot} />
            <Text style={styles.recoveryText}>{COPY.circlePlanRecovery}</Text>
          </TouchableOpacity>
        ) : hint ? (
          <InlineNudge text={hint} />
        ) : null}

        <TouchableOpacity
          activeOpacity={0.85}
          onPress={onPost}
          disabled={postDisabled}
          style={[styles.postBtn, postDisabled && styles.postBtnDisabled]}
        >
          <Text style={styles.postBtnText}>
            {visibilityOpen ? COPY.circlePlanPostToFeed : COPY.circlePlanPostToCircle(circleName)}
          </Text>
        </TouchableOpacity>
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
  descWrap: { marginBottom: CIRCLE_PLAN.sectionGap },
  descInput: {
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    minHeight: 72,
    textAlignVertical: 'top',
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyLG,
    color: Colors.darkWarm,
  },
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
  recipientBlock: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: Colors.overlayWarm,
    marginBottom: CIRCLE_PLAN.cardGap,
  },
  chipRow: { flexDirection: 'row', gap: CIRCLE_PLAN.chipGap, marginBottom: CIRCLE_PLAN.labelGap },
  recipientChip: {
    paddingHorizontal: CIRCLE_PLAN.chipPadH,
    paddingVertical: CIRCLE_PLAN.chipPadV,
    borderRadius: CIRCLE_PLAN.chipRadius,
    backgroundColor: Colors.inputBg,
    // "Everyone in {circle}" carries a variable-length name (an unnamed
    // circle falls back to a member-list title); shrink + ellipsize rather
    // than overflow the row or squeeze the "Pick people" chip beside it.
    flexShrink: 1,
    minWidth: 0,
  },
  recipientChipGhost: {
    paddingHorizontal: CIRCLE_PLAN.chipPadH,
    paddingVertical: CIRCLE_PLAN.chipPadV,
    borderRadius: CIRCLE_PLAN.chipRadius,
    borderWidth: CIRCLE_PLAN.cardBorder,
    borderColor: Colors.border,
    flexShrink: 0,
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
  // Tier-4 soft recovery line, gold never red (mirrors PlanComposerV2).
  recoveryNudge: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.goldBadgeSoft, borderWidth: 1, borderColor: Colors.goldAccent,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, marginBottom: CIRCLE_PLAN.labelGap,
  },
  recoveryDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.gold },
  recoveryText: { flex: 1, fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, lineHeight: 18, color: Colors.quoteText },
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
