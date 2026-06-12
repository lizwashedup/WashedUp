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
import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  Image,
  StyleSheet,
} from 'react-native';
import { Check, Minus, Plus } from 'lucide-react-native';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';
import { CIRCLE_PLAN } from '../../../constants/YoursDesign';
import { COPY } from '../../yours/state/constants';
import { useAuthUserId } from '../../yours/state/useAuthUserId';
import BottomSheet from '../../yours/primitives/BottomSheet';
import { type CalendarDay } from '../../calendar/WashedUpCalendar';
import CollapsibleCalendar from '../../composer/CollapsibleCalendar';
import { getTodayInLA } from '../../../lib/laDate';
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

function memberLabel(m: ComposerMember): string {
  return m.first_name_display?.trim() || COPY.circleMemberFallback;
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
  const [minute, setMinute] = useState<(typeof MINUTES)[number]>(0);
  const [period, setPeriod] = useState<'AM' | 'PM'>('PM');
  const [visibilityOpen, setVisibilityOpen] = useState(false); // false = Just us
  const [pickMode, setPickMode] = useState(false); // false = everyone
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [strangerCap, setStrangerCap] = useState(STRANGER_DEFAULT);
  const [error, setError] = useState<string | null>(null);

  const pickable = useMemo(
    () => members.filter((m) => m.user_id !== myUserId),
    [members, myUserId],
  );

  const reset = () => {
    setTitle('');
    setCategory(null);
    setWhere('');
    setDate(todayCalendarDay());
    setHour(7);
    setMinute(0);
    setPeriod('PM');
    setVisibilityOpen(false);
    setPickMode(false);
    setPicked(new Set());
    setStrangerCap(STRANGER_DEFAULT);
    setError(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  const togglePicked = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const buildStartTime = (): Date => {
    const base = new Date(date.year, date.month, date.day);
    let h = hour % 12;
    if (period === 'PM') h += 12;
    base.setHours(h, minute, 0, 0);
    return base;
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
    const subset = !visibilityOpen && pickMode ? Array.from(picked) : null;
    try {
      const result = await createPlan.mutateAsync({
        circleId,
        title: title.trim(),
        startTime: start.toISOString(),
        visibility: visibilityOpen ? 'open' : 'circle_only',
        strangerCap: visibilityOpen ? strangerCap : null,
        memberUserIds: subset,
        locationText: where.trim() || null,
      });
      close();
      onPosted(result);
    } catch {
      setError(COPY.circlePlanError);
    }
  };

  const postDisabled =
    createPlan.isPending ||
    !title.trim() ||
    (!visibilityOpen && pickMode && picked.size === 0);

  return (
    <BottomSheet visible={visible} onClose={close} heightPct={CIRCLE_PLAN.sheetHeightPct}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>{COPY.circlePlanComposerTitle}</Text>

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
            openToOthers={visibilityOpen}
          />
        </View>

        {/* When (date) */}
        <Text style={styles.fieldLabel}>{COPY.circlePlanWhenLabel}</Text>
        <View style={styles.calendarWrap}>
          <CollapsibleCalendar selected={date} onSelect={setDate} />
        </View>
        <View style={styles.timeRow}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.timeChipsContent}
          >
            {Array.from({ length: 12 }, (_, k) => k + 1).map((h) => {
              const on = h === hour;
              return (
                <Pressable
                  key={h}
                  onPress={() => setHour(h)}
                  style={[styles.timeChip, on && styles.timeChipOn]}
                >
                  <Text style={[styles.timeChipText, on && styles.timeChipTextOn]}>{h}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
        <View style={styles.timeRow}>
          {MINUTES.map((m) => {
            const on = m === minute;
            return (
              <Pressable
                key={m}
                onPress={() => setMinute(m)}
                style={[styles.timeChip, on && styles.timeChipOn]}
              >
                <Text style={[styles.timeChipText, on && styles.timeChipTextOn]}>
                  {m.toString().padStart(2, '0')}
                </Text>
              </Pressable>
            );
          })}
          <View style={styles.periodGroup}>
            {(['AM', 'PM'] as const).map((p) => {
              const on = p === period;
              return (
                <Pressable
                  key={p}
                  onPress={() => setPeriod(p)}
                  style={[styles.timeChip, on && styles.timeChipOn]}
                >
                  <Text style={[styles.timeChipText, on && styles.timeChipTextOn]}>{p}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* WHO IS THIS FOR */}
        <Text style={styles.sectionLabel}>{COPY.circlePlanWhoLabel}</Text>

        <Pressable
          onPress={() => setVisibilityOpen(false)}
          style={[styles.audienceCard, !visibilityOpen && styles.audienceCardOn]}
        >
          <Text style={styles.audienceTitle}>{COPY.circlePlanJustUs}</Text>
          <Text style={styles.audienceSub}>{COPY.circlePlanJustUsSub(circleName)}</Text>
        </Pressable>

        {/* Just-us recipients (hidden for a 2-person DM: "just us" is the pair) */}
        {!visibilityOpen && !isDm && (
          <View style={styles.recipientBlock}>
            <View style={styles.chipRow}>
              <Pressable
                onPress={() => setPickMode(false)}
                style={[styles.recipientChip, !pickMode && styles.recipientChipOn]}
              >
                <Text style={[styles.recipientChipText, !pickMode && styles.recipientChipTextOn]}>
                  {COPY.circlePlanEveryone(circleName)}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setPickMode(true)}
                style={[styles.recipientChipGhost, pickMode && styles.recipientChipOn]}
              >
                <Text style={[styles.recipientChipGhostText, pickMode && styles.recipientChipTextOn]}>
                  {COPY.circlePlanPickPeople}
                </Text>
              </Pressable>
            </View>
            <Text style={styles.helper}>{COPY.circlePlanPickHelper}</Text>

            {pickMode && (
              <View style={styles.memberList}>
                {pickable.map((m) => {
                  const on = picked.has(m.user_id);
                  return (
                    <Pressable
                      key={m.user_id}
                      onPress={() => togglePicked(m.user_id)}
                      style={styles.memberRow}
                    >
                      {m.profile_photo_url ? (
                        <Image source={{ uri: m.profile_photo_url }} style={styles.memberAvatar} />
                      ) : (
                        <View style={[styles.memberAvatar, styles.memberAvatarPlaceholder]}>
                          <Text style={styles.memberInitial}>
                            {memberLabel(m)[0]?.toUpperCase() ?? '?'}
                          </Text>
                        </View>
                      )}
                      <Text style={styles.memberName} numberOfLines={1}>
                        {memberLabel(m)}
                      </Text>
                      <View style={[styles.memberCheck, on && styles.memberCheckOn]}>
                        {on && <Check size={14} color={Colors.white} strokeWidth={3} />}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>
        )}

        <Pressable
          onPress={() => setVisibilityOpen(true)}
          style={[styles.audienceCard, visibilityOpen && styles.audienceCardOn]}
        >
          <Text style={styles.audienceTitle}>{COPY.circlePlanOpenUp}</Text>
          <Text style={styles.audienceSub}>{COPY.circlePlanOpenUpSub}</Text>
        </Pressable>

        {/* Open-it-up stranger stepper */}
        {visibilityOpen && (
          <View style={styles.stepperBlock}>
            <Text style={styles.stepperLabel}>{COPY.circlePlanStepperLabel}</Text>
            <View style={styles.stepperRow}>
              <Pressable
                onPress={() => setStrangerCap((c) => Math.max(STRANGER_MIN, c - 1))}
                disabled={strangerCap <= STRANGER_MIN}
                style={[styles.stepperBtn, strangerCap <= STRANGER_MIN && styles.stepperBtnOff]}
              >
                <Minus size={18} color={strangerCap <= STRANGER_MIN ? Colors.tertiary : Colors.terracotta} strokeWidth={2.5} />
              </Pressable>
              <Text style={styles.stepperValue}>{strangerCap}</Text>
              <Pressable
                onPress={() => setStrangerCap((c) => Math.min(STRANGER_MAX, c + 1))}
                disabled={strangerCap >= STRANGER_MAX}
                style={[styles.stepperBtn, strangerCap >= STRANGER_MAX && styles.stepperBtnOff]}
              >
                <Plus size={18} color={strangerCap >= STRANGER_MAX ? Colors.tertiary : Colors.terracotta} strokeWidth={2.5} />
              </Pressable>
            </View>
            <Text style={styles.helper}>{COPY.circlePlanStepperSub(circleName)}</Text>
          </View>
        )}

        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable
          onPress={onPost}
          disabled={postDisabled}
          style={[styles.postBtn, postDisabled && styles.postBtnDisabled]}
        >
          <Text style={styles.postBtnText}>{COPY.circlePlanPost}</Text>
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
  calendarWrap: { marginBottom: CIRCLE_PLAN.sectionGap },
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
});
