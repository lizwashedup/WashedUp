/**
 * CircleCard - one circle in the Yours > Circles directory, as a rich card.
 *
 * A white rounded card (not a thin row): a leading gold monogram square (a cover
 * photo drops in once cover_upload_id resolves, next chunk), the name in serif
 * italic, a "{N} people" meta line, and an overlapping member-avatar row.
 *
 * Graceful degrade: get_my_circles carries no plans-together count, upcoming
 * plan, or cover URL yet, so the "plans together" meta and the contextual chip
 * (terracotta upcoming-plan pill / gold "it's been a minute" nudge) are omitted
 * this chunk and fill in once circle-plans data exists.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';
import { CIRCLE_DIR, TYPE } from '../../../constants/YoursDesign';
import { COPY } from '../state/constants';
import { hapticSelection } from '../../../lib/haptics';
import type { MyCircle, MemberPreview } from '../../../lib/circles/types';
import { buildCircleCoverUrl } from '../../../lib/circles/coverUrl';
import CircleCover from './CircleCover';
import CircleMemberStack from './CircleMemberStack';

export default function CircleCard({
  circle,
  members,
  onPress,
}: {
  circle: MyCircle;
  members: MemberPreview[];
  onPress: (id: string) => void;
}) {
  const title =
    (circle.name ?? '').trim() || circle.display_name || COPY.circleUnnamed;

  return (
    <Pressable
      onPress={() => {
        hapticSelection();
        onPress(circle.id);
      }}
      style={styles.hit}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${COPY.circleMembers(circle.member_count)}`}
    >
      {({ pressed }) => (
        // The fill (bg + shadow + border) lives on this inner View: a styled
        // Pressable does not paint its background as a child cell here.
        <View style={[styles.card, pressed && styles.pressed]}>
          <View style={styles.top}>
            <CircleCover
              name={title}
              coverUrl={buildCircleCoverUrl(circle.id, circle.cover_upload_id)}
              tone="gold"
              size={CIRCLE_DIR.cover}
              radius={CIRCLE_DIR.coverRadius}
              monogramSize={CIRCLE_DIR.monogram}
            />
            <View style={styles.textCol}>
              <Text style={styles.name} numberOfLines={1}>
                {title}
              </Text>
              <Text style={styles.meta} numberOfLines={1}>
                {COPY.circleMembers(circle.member_count)}
              </Text>
            </View>
          </View>

          <View style={styles.avatars}>
            <CircleMemberStack members={members} memberCount={circle.member_count} />
          </View>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hit: {
    marginHorizontal: CIRCLE_DIR.cardMarginH,
    marginTop: CIRCLE_DIR.cardGap,
  },
  card: {
    paddingVertical: CIRCLE_DIR.cardPadV,
    paddingHorizontal: CIRCLE_DIR.cardPadH,
    borderRadius: CIRCLE_DIR.cardRadius,
    backgroundColor: Colors.cardBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.dividerWarm,
    shadowColor: Colors.terracotta,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 3,
  },
  pressed: { opacity: 0.9 },
  top: { flexDirection: 'row', alignItems: 'center' },
  textCol: { flex: 1, marginLeft: CIRCLE_DIR.coverToText },
  name: {
    ...TYPE.heroDisplay,
    color: Colors.darkWarm,
  },
  meta: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.secondary,
    marginTop: CIRCLE_DIR.nameToMeta,
  },
  avatars: { marginTop: CIRCLE_DIR.topToAvatars },
});
