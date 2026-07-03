/**
 * CircleNoticeboard - the circle page (toward the circles design study):
 * identity hero (cover photo when set, else serif monogram tile), an
 * UNCONDITIONAL action row (post a plan / open chat / invite), the members row,
 * and "coming up" plans with a "Make the first plan." nudge when empty.
 *
 * The cover follows the identity ladder: a manual cover (buildCircleCoverUrl) >
 * the living cover (the newest get_circle().recent_together photo, signed) >
 * the serif monogram tile. RECENTLY TOGETHER shows the circle's recent shared
 * plan-album photos as a strip. The pinned-plan capacity line lands in its
 * own pass.
 */
import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { CalendarDays, CalendarPlus, MessageCircle, UserPlus, Pencil } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import { CIRCLE_HOME, TYPE } from '../../constants/YoursDesign';
import { COPY } from '../yours/state/constants';
import type { CirclePayload } from '../../lib/circles/types';
import { useCirclePlans, CirclePlanRow } from '../../hooks/useCirclePlans';
import { useSignedAlbumUrls } from '../../hooks/useSignedAlbumUrls';
import { buildCircleCoverUrl } from '../../lib/circles/coverUrl';
import { formatPlanWhenLA } from '../../lib/planTime';
import CircleCover from '../yours/circles/CircleCover';
import CircleMembersRow from './CircleMembersRow';

// Recently-together photo strip dimensions (named, no inline math in styles).
const RECENT_THUMB = 84;
const RECENT_THUMB_RADIUS = 12;
const RECENT_THUMB_GAP = 8;

function PlanRow({
  plan,
  capacity,
  onPress,
}: {
  plan: CirclePlanRow;
  // Present only on the next (pinned) plan, where get_circle gives the counts.
  capacity?: { filled: number; size: number };
  onPress: () => void;
}) {
  const isOpen = plan.circle_visibility === 'open';
  return (
    <Pressable style={styles.planRow} onPress={onPress}>
      <CalendarDays size={CIRCLE_HOME.emptyPlanIcon} color={Colors.terracotta} strokeWidth={1.75} />
      <View style={styles.planRowBody}>
        <Text style={styles.planTitle} numberOfLines={1}>{plan.title}</Text>
        <Text style={styles.planMeta} numberOfLines={1}>
          {formatPlanWhenLA(plan.start_time)}
          {plan.location_text ? `, ${plan.location_text}` : ''}
        </Text>
        {capacity && (
          <Text style={styles.planCapacity} numberOfLines={1}>
            {COPY.circlePlanCapacity(capacity.filled, capacity.size)}
          </Text>
        )}
      </View>
      {/* "up to N others welcome" only on opened-up plans; just-us stays private. */}
      {isOpen ? (
        plan.stranger_cap != null && (
          <View style={styles.openTag}>
            <Text style={styles.openTagText}>{COPY.circlePlanSeatsWelcome(plan.stranger_cap)}</Text>
          </View>
        )
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
  icon: Icon, label, primary, grow, onPress,
}: {
  icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  label: string;
  primary?: boolean;
  grow?: boolean;
  onPress?: () => void;
}) {
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      android_ripple={{ color: Colors.border }}
      style={[
        styles.actionBtn,
        grow && styles.actionGrow,
        primary && styles.actionPrimary,
        pressed && styles.actionBtnPressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Icon
        size={primary ? 20 : 18}
        color={primary ? Colors.white : Colors.terracotta}
        strokeWidth={1.75}
      />
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
  // The next upcoming plan carries the capacity counts (get_circle.pinned_plan);
  // matched into the list by id so only that row shows "{filled} of {size} in".
  const pinned = payload.pinned_plan;

  // Sign every recent-together photo once; the strip and the living cover both
  // read from this map (album-media is private, so paths need signed URLs).
  const recentPhotos = payload.recent_together;
  const { data: signed = {} } = useSignedAlbumUrls(recentPhotos.map((p) => p.media_path));

  // Identity ladder: a manual cover wins; with none, the living cover is the
  // newest shared photo; with neither, CircleCover falls to the serif monogram.
  const manualCoverUrl = buildCircleCoverUrl(circle.id, circle.cover_upload_id);
  const livingPath = manualCoverUrl ? null : recentPhotos[0]?.media_path ?? null;
  const coverUrl = manualCoverUrl ?? (livingPath ? signed[livingPath] ?? null : null);
  const [firstPlanPressed, setFirstPlanPressed] = useState(false);

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

      {/* Action area: "post a plan" is the circle's one dominant CTA (full-width
          terracotta); chat + invite ride below as a lighter secondary pair. */}
      <View style={styles.actionCol}>
        <ActionButton icon={CalendarPlus} label={COPY.circleActionPost} primary onPress={onPostPlan} />
        <View style={styles.actionRowSecondary}>
          <ActionButton icon={MessageCircle} label={COPY.circleActionChat} grow onPress={onOpenChat} />
          <ActionButton icon={UserPlus} label={COPY.circleActionInvite} grow onPress={onAddPeople} />
        </View>
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
              onPressIn={() => setFirstPlanPressed(true)}
              onPressOut={() => setFirstPlanPressed(false)}
              android_ripple={{ color: Colors.border }}
              style={[styles.makeFirstPlan, firstPlanPressed && styles.makeFirstPlanPressed]}
              accessibilityRole="button"
              accessibilityLabel={COPY.circleMakeFirstPlan}
            >
              <Text style={styles.makeFirstPlanText}>{COPY.circleMakeFirstPlan}</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.planList}>
            {plans.map((p) => (
              <PlanRow
                key={p.id}
                plan={p}
                capacity={
                  pinned && pinned.id === p.id
                    ? { filled: pinned.circle_in_count, size: pinned.circle_size }
                    : undefined
                }
                onPress={() => router.push(`/plan/${p.id}` as never)}
              />
            ))}
          </View>
        )}
      </View>

      {/* Recently together: the circle's recent shared plan-album photos. */}
      {recentPhotos.length > 0 && (
        <View style={styles.section}>
          <SectionLabel>{COPY.circleRecentLabel}</SectionLabel>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.recentRow}
          >
            {recentPhotos.map((photo) => {
              const uri = signed[photo.media_path];
              return (
                <View key={photo.upload_id} style={styles.recentThumb}>
                  {uri ? (
                    <Image
                      source={{ uri }}
                      style={styles.recentImg}
                      contentFit="cover"
                      cachePolicy="memory-disk"
                    />
                  ) : (
                    <View style={[styles.recentImg, styles.recentSkeleton]} />
                  )}
                </View>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* Pinned-plan capacity line lands in its own pass. */}
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
  actionCol: {
    gap: 10,
    paddingHorizontal: CIRCLE_HOME.sectionPadH,
    marginBottom: CIRCLE_HOME.sectionGapV,
  },
  actionRowSecondary: {
    flexDirection: 'row',
    gap: 8,
  },
  actionBtn: {
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
  actionGrow: { flex: 1 },
  actionPrimary: {
    backgroundColor: Colors.terracotta,
    borderColor: Colors.terracotta,
    paddingVertical: 14,
    shadowColor: Colors.terracotta,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 3,
  },
  actionBtnPressed: { opacity: 0.7 },
  actionText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Colors.terracotta },
  actionPrimaryText: { color: Colors.white, fontSize: FontSizes.bodyMD },
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
  makeFirstPlanPressed: { opacity: 0.8 },
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
  planCapacity: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.darkWarm, marginTop: 3 },
  openTag: { backgroundColor: Colors.goldenAmberTint15, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  openTagText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.micro, color: Colors.darkWarm, letterSpacing: 0.2 },
  privTag: { backgroundColor: Colors.dividerWarm, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  privTagText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.micro, color: Colors.secondary, letterSpacing: 0.2 },
  planEmptyTitle: {
    fontFamily: Fonts.sansSemibold,
    fontSize: FontSizes.bodyMD,
    color: Colors.darkWarm,
  },
  recentRow: {
    paddingHorizontal: CIRCLE_HOME.sectionPadH,
    gap: RECENT_THUMB_GAP,
  },
  recentThumb: {
    width: RECENT_THUMB,
    height: RECENT_THUMB,
    borderRadius: RECENT_THUMB_RADIUS,
    overflow: 'hidden',
  },
  recentImg: {
    width: RECENT_THUMB,
    height: RECENT_THUMB,
    borderRadius: RECENT_THUMB_RADIUS,
  },
  recentSkeleton: { backgroundColor: Colors.dividerWarm },
});
