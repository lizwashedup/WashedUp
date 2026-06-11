/**
 * CircleNoticeboard - the circle page (toward the circles design study):
 * identity hero (cover photo when set, else serif monogram tile), an
 * UNCONDITIONAL action row (post a plan / open chat / invite), the members row,
 * and "coming up" plans with a "Make the first plan." nudge when empty.
 *
 * Data-gated and deferred to a backend follow-up (see tracker): the pinned-plan
 * capacity line "{filled} of {size} in", the living cover (auto from latest plan
 * album), and RECENT TOGETHER all need circle-detail fields that get_circle does
 * not return yet. Manual covers DO work here via buildCircleCoverUrl.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { CalendarDays, CalendarPlus, MessageCircle, UserPlus, Pencil } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import { CIRCLE_HOME, TYPE } from '../../constants/YoursDesign';
import { COPY } from '../yours/state/constants';
import type { CirclePayload } from '../../lib/circles/types';
import { useCirclePlans, CirclePlanRow } from '../../hooks/useCirclePlans';
import { buildCircleCoverUrl } from '../../lib/circles/coverUrl';
import CircleCover from '../yours/circles/CircleCover';
import CircleMembersRow from './CircleMembersRow';

function formatPlanWhen(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  return `${date}, ${time}`;
}

function PlanRow({ plan, onPress }: { plan: CirclePlanRow; onPress: () => void }) {
  const isOpen = plan.circle_visibility === 'open';
  return (
    <Pressable style={styles.planRow} onPress={onPress}>
      <CalendarDays size={CIRCLE_HOME.emptyPlanIcon} color={Colors.terracotta} strokeWidth={1.75} />
      <View style={styles.planRowBody}>
        <Text style={styles.planTitle} numberOfLines={1}>{plan.title}</Text>
        <Text style={styles.planMeta} numberOfLines={1}>
          {formatPlanWhen(plan.start_time)}
          {plan.location_text ? `, ${plan.location_text}` : ''}
        </Text>
      </View>
      {isOpen ? (
        <View style={styles.openTag}><Text style={styles.openTagText}>{COPY.circlePlanFromBadge}</Text></View>
      ) : (
        <View style={styles.privTag}><Text style={styles.privTagText}>{COPY.circlePlanPrivateTag}</Text></View>
      )}
    </Pressable>
  );
}

function SectionLabel({ children }: { children: string }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

function ActionButton({
  icon: Icon, label, primary, onPress,
}: {
  icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  label: string;
  primary?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: Colors.border }}
      style={[styles.actionBtn, primary && styles.actionPrimary]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Icon size={18} color={primary ? Colors.white : Colors.terracotta} strokeWidth={1.75} />
      <Text style={[styles.actionText, primary && styles.actionPrimaryText]}>{label}</Text>
    </Pressable>
  );
}

export default function CircleNoticeboard({
  payload,
  displayName,
  onAddPeople,
  onNameCircle,
  onPostPlan,
  onOpenChat,
}: {
  payload: CirclePayload;
  displayName?: string;
  onAddPeople?: () => void;
  onNameCircle?: () => void;
  onPostPlan?: () => void;
  onOpenChat?: () => void;
}) {
  const { circle, members } = payload;
  const router = useRouter();
  const { data: plans = [] } = useCirclePlans(circle.id);
  const title = displayName?.trim() || circle.name;
  const coverUrl = buildCircleCoverUrl(circle.id, circle.cover_upload_id);

  return (
    <View style={styles.wrap}>
      {/* Identity hero: cover photo when set, else serif monogram tile. */}
      {coverUrl ? (
        <View style={styles.coverHero}>
          <Image source={{ uri: coverUrl }} style={styles.coverImg} contentFit="cover" />
          <View style={styles.coverScrim} />
          <Text style={styles.coverName} numberOfLines={2}>{title}</Text>
        </View>
      ) : (
        <View style={styles.hero}>
          <CircleCover
            name={title}
            coverUrl={null}
            size={CIRCLE_HOME.coverHero}
            radius={CIRCLE_HOME.coverHeroRadius}
            monogramSize={CIRCLE_HOME.coverMonogram}
          />
          <Text style={styles.name} numberOfLines={2}>{title}</Text>
        </View>
      )}

      <View style={styles.metaWrap}>
        <Text style={styles.memberCount}>{COPY.circleHomeMembers(members.length)}</Text>
        {!!circle.description?.trim() && (
          <Text style={styles.description}>{circle.description.trim()}</Text>
        )}
        {!!onNameCircle && (
          <Pressable
            onPress={onNameCircle}
            android_ripple={{ color: Colors.border }}
            style={styles.nameCircle}
            accessibilityRole="button"
            accessibilityLabel={COPY.circleNameThis}
          >
            <Pencil size={CIRCLE_HOME.nameIcon} color={Colors.terracotta} strokeWidth={1.75} />
            <Text style={styles.nameCircleText}>{COPY.circleNameThis}</Text>
          </Pressable>
        )}
      </View>

      {/* Action row: the only way to make a plan / open chat / invite from here. */}
      <View style={styles.actionRow}>
        <ActionButton icon={CalendarPlus} label={COPY.circleActionPost} primary onPress={onPostPlan} />
        <ActionButton icon={MessageCircle} label={COPY.circleActionChat} onPress={onOpenChat} />
        <ActionButton icon={UserPlus} label={COPY.circleActionInvite} onPress={onAddPeople} />
      </View>

      {/* Members */}
      <View style={styles.section}>
        <SectionLabel>{COPY.circleWhoLabel}</SectionLabel>
        <CircleMembersRow members={members} onAdd={onAddPeople} />
      </View>

      {/* Plans on the calendar */}
      <View style={styles.section}>
        <SectionLabel>{COPY.circlePlansLabel}</SectionLabel>
        {plans.length === 0 ? (
          <View style={styles.planEmpty}>
            <Text style={styles.planEmptyTitle}>{COPY.circlePlansEmpty}</Text>
            <Pressable
              onPress={onPostPlan}
              android_ripple={{ color: Colors.border }}
              style={styles.makeFirstPlan}
              accessibilityRole="button"
              accessibilityLabel={COPY.circleMakeFirstPlan}
            >
              <Text style={styles.makeFirstPlanText}>{COPY.circleMakeFirstPlan}</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.planList}>
            {plans.map((p) => (
              <PlanRow key={p.id} plan={p} onPress={() => router.push(`/plan/${p.id}` as never)} />
            ))}
          </View>
        )}
      </View>

      {/* RECENT TOGETHER + pinned-plan capacity: deferred (data-gated; see header). */}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingTop: 8, paddingBottom: CIRCLE_HOME.sectionGapV },
  hero: {
    alignItems: 'center',
    paddingHorizontal: CIRCLE_HOME.sectionPadH,
    marginBottom: 12,
  },
  coverHero: {
    height: 180,
    marginBottom: 12,
    justifyContent: 'flex-end',
  },
  coverImg: { ...StyleSheet.absoluteFillObject },
  coverScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.overlayDark55,
  },
  coverName: {
    ...TYPE.heroDisplay,
    color: Colors.creamHigh,
    paddingHorizontal: CIRCLE_HOME.sectionPadH,
    paddingBottom: 12,
  },
  name: {
    ...TYPE.heroDisplay,
    color: Colors.darkWarm,
    textAlign: 'center',
    marginTop: 12,
  },
  metaWrap: {
    alignItems: 'center',
    paddingHorizontal: CIRCLE_HOME.sectionPadH,
    marginBottom: CIRCLE_HOME.sectionGapV,
  },
  memberCount: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.secondary,
  },
  description: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    lineHeight: LineHeights.bodyMD,
    color: Colors.secondary,
    textAlign: 'center',
    marginTop: 10,
  },
  nameCircle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: Colors.terracotta,
  },
  nameCircleText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodySM,
    color: Colors.terracotta,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: CIRCLE_HOME.sectionPadH,
    marginBottom: CIRCLE_HOME.sectionGapV,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: Colors.terracotta,
    backgroundColor: Colors.cardBg,
  },
  actionPrimary: { backgroundColor: Colors.terracotta },
  actionText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Colors.terracotta },
  actionPrimaryText: { color: Colors.white },
  section: { marginBottom: CIRCLE_HOME.sectionGapV },
  sectionLabel: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: CIRCLE_HOME.sectionLabelGap,
    marginHorizontal: CIRCLE_HOME.sectionPadH,
  },
  planEmpty: {
    marginHorizontal: CIRCLE_HOME.sectionPadH,
    paddingVertical: CIRCLE_HOME.slotPadV,
    paddingHorizontal: CIRCLE_HOME.slotPadH,
    borderRadius: CIRCLE_HOME.slotRadius,
    backgroundColor: Colors.cardBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    alignItems: 'flex-start',
    gap: 10,
  },
  makeFirstPlan: {
    backgroundColor: Colors.goldAccent,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  makeFirstPlanText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Colors.darkWarm },
  planList: { marginHorizontal: CIRCLE_HOME.sectionPadH, gap: 8 },
  planRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: CIRCLE_HOME.slotPadV,
    paddingHorizontal: CIRCLE_HOME.slotPadH,
    borderRadius: CIRCLE_HOME.slotRadius,
    backgroundColor: Colors.cardBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  planRowBody: { flex: 1, minWidth: 0 },
  planTitle: { fontFamily: Fonts.sansSemibold, fontSize: FontSizes.bodyMD, color: Colors.darkWarm },
  planMeta: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.secondary, marginTop: 3 },
  openTag: { backgroundColor: Colors.goldenAmberTint15, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  openTagText: { fontFamily: Fonts.sansBold, fontSize: 10, color: Colors.darkWarm, letterSpacing: 0.2 },
  privTag: { backgroundColor: Colors.dividerWarm, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  privTagText: { fontFamily: Fonts.sansMedium, fontSize: 10, color: Colors.secondary, letterSpacing: 0.2 },
  planEmptyTitle: {
    fontFamily: Fonts.sansSemibold,
    fontSize: FontSizes.bodyMD,
    color: Colors.darkWarm,
  },
});
