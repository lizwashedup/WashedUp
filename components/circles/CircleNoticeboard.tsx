/**
 * CircleNoticeboard — the people + plans + details surface of a circle home.
 * A pure content block (no scroll container of its own) so the circle home can
 * render it directly now, and later drop it in as the header above the
 * persistent circle chat (the "stacked" surface).
 *
 * v1 state: `pinned_plan` is null and `recent_together` is empty (the RPC
 * returns them as stable extension points), so the plans slot shows its empty
 * treatment and the recently-together section is hidden until there is history.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { CalendarDays } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import { CIRCLE_HOME, TYPE } from '../../constants/YoursDesign';
import { COPY } from '../yours/state/constants';
import type { CirclePayload } from '../../lib/circles/types';
import CircleCover from '../yours/circles/CircleCover';
import CircleMembersRow from './CircleMembersRow';
import TheRoomSlot from './TheRoomSlot';

function SectionLabel({ children }: { children: string }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

export default function CircleNoticeboard({ payload }: { payload: CirclePayload }) {
  const { circle, members } = payload;

  return (
    <View style={styles.wrap}>
      {/* Identity hero */}
      <View style={styles.hero}>
        <CircleCover
          name={circle.name}
          coverUrl={null}
          size={CIRCLE_HOME.coverHero}
          radius={CIRCLE_HOME.coverHeroRadius}
          monogramSize={CIRCLE_HOME.coverMonogram}
        />
        <Text style={styles.name} numberOfLines={2}>
          {circle.name}
        </Text>
        <Text style={styles.memberCount}>{COPY.circleHomeMembers(members.length)}</Text>
        {!!circle.description?.trim() && (
          <Text style={styles.description}>{circle.description.trim()}</Text>
        )}
      </View>

      {/* Members */}
      <View style={styles.section}>
        <SectionLabel>{COPY.circleWhoLabel}</SectionLabel>
        <CircleMembersRow members={members} />
      </View>

      {/* Plans on the calendar (empty in v1) */}
      <View style={styles.section}>
        <SectionLabel>{COPY.circlePlansLabel}</SectionLabel>
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
