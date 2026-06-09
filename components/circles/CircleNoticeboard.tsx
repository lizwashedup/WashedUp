/**
 * CircleNoticeboard - the people + plans + details surface of a circle home.
 * A pure content block (no scroll container of its own) so the circle home can
 * render it directly now, and later drop it in as the header above the
 * persistent circle chat (the "stacked" surface).
 *
 * v1 state: `pinned_plan` is null and `recent_together` is empty (the RPC
 * returns them as stable extension points), so the plans slot shows its empty
 * treatment and the recently-together section is hidden until there is history.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { CalendarDays } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import { CIRCLE_HOME, TYPE } from '../../constants/YoursDesign';
import { COPY } from '../yours/state/constants';
import type { CirclePayload } from '../../lib/circles/types';
import { useCirclePlans, CirclePlanRow } from '../../hooks/useCirclePlans';
import CircleCover from '../yours/circles/CircleCover';
import CircleMembersRow from './CircleMembersRow';
import TheRoomSlot from './TheRoomSlot';

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

export default function CircleNoticeboard({
  payload,
  displayName,
  onAddPeople,
}: {
  payload: CirclePayload;
  // Resolved title (member names for an unnamed/DM-grown circle); falls back to
  // the stored name. Keeps the hero from ever showing a blank name.
  displayName?: string;
  onAddPeople?: () => void;
}) {
  const { circle, members } = payload;
  const router = useRouter();
  const { data: plans = [] } = useCirclePlans(circle.id);

  return (
    <View style={styles.wrap}>
      {/* Identity hero */}
      <View style={styles.hero}>
        <CircleCover
          name={displayName?.trim() || circle.name}
          coverUrl={null}
          size={CIRCLE_HOME.coverHero}
          radius={CIRCLE_HOME.coverHeroRadius}
          monogramSize={CIRCLE_HOME.coverMonogram}
        />
        <Text style={styles.name} numberOfLines={2}>
          {displayName?.trim() || circle.name}
        </Text>
        <Text style={styles.memberCount}>{COPY.circleHomeMembers(members.length)}</Text>
        {!!circle.description?.trim() && (
          <Text style={styles.description}>{circle.description.trim()}</Text>
        )}
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
            <CalendarDays
              size={CIRCLE_HOME.emptyPlanIcon}
              color={Colors.iconMuted}
              strokeWidth={1.75}
            />
            <View style={styles.planEmptyBody}>
              <Text style={styles.planEmptyTitle}>{COPY.circlePlansEmpty}</Text>
              <Text style={styles.planEmptySub}>{COPY.circlePlansEmptySub}</Text>
            </View>
          </View>
        ) : (
          <View style={styles.planList}>
            {plans.map((p) => (
              <PlanRow key={p.id} plan={p} onPress={() => router.push(`/plan/${p.id}` as never)} />
            ))}
          </View>
        )}
      </View>

      {/* Recently-together lands with Step 10 (co-attendance), when
          recent_together is actually populated. */}

      {/* The Room (reserved, UI only) */}
      <View style={styles.section}>
        <TheRoomSlot />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingTop: 8, paddingBottom: CIRCLE_HOME.sectionGapV },
  hero: {
    alignItems: 'center',
    paddingHorizontal: CIRCLE_HOME.sectionPadH,
    marginBottom: CIRCLE_HOME.sectionGapV,
  },
  name: {
    ...TYPE.heroDisplay,
    color: Colors.darkWarm,
    textAlign: 'center',
    marginTop: 12,
  },
  memberCount: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.secondary,
    marginTop: 4,
  },
  description: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    lineHeight: LineHeights.bodyMD,
    color: Colors.secondary,
    textAlign: 'center',
    marginTop: 10,
  },
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
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: CIRCLE_HOME.sectionPadH,
    paddingVertical: CIRCLE_HOME.slotPadV,
    paddingHorizontal: CIRCLE_HOME.slotPadH,
    borderRadius: CIRCLE_HOME.slotRadius,
    backgroundColor: Colors.cardBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
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
  planEmptyBody: { flex: 1, marginLeft: 12 },
  planEmptyTitle: {
    fontFamily: Fonts.sansSemibold,
    fontSize: FontSizes.bodyMD,
    color: Colors.darkWarm,
  },
  planEmptySub: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.secondary,
    marginTop: 3,
  },
});
