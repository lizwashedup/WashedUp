/**
 * CircleRow - one thin row in the Yours > Circles directory. Cover + name +
 * a quiet meta line (member count, last activity), deep-linking to the circle
 * home. Mirrors the chat-list row's calm density, in the Yours design system.
 */
import React from 'react';
import { Pressable, View, Text, StyleSheet } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';
import { CIRCLE } from '../../../constants/YoursDesign';
import { COPY } from '../state/constants';
import { hapticSelection } from '../../../lib/haptics';
import type { MyCircle } from '../../../lib/circles/types';
import CircleCover from './CircleCover';

/**
 * Short relative-activity label. Mirrors the chat list's local formatter
 * (app/(tabs)/chats/index.tsx) so circle and chat timestamps read the same.
 */
function formatLastActivity(iso: string): string {
  const then = new Date(iso).getTime();
  // A malformed timestamp converges to the same "no real activity" read as a
  // true SQL null, so the two quiet paths never diverge.
  if (Number.isNaN(then)) return COPY.circleQuiet;
  const diffMs = Date.now() - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d`;
  return new Date(then).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function CircleRow({
  circle,
  onPress,
}: {
  circle: MyCircle;
  onPress: (id: string) => void;
}) {
  const activity = circle.last_message_at
    ? formatLastActivity(circle.last_message_at)
    : COPY.circleQuiet;

  return (
    <Pressable
      onPress={() => {
        hapticSelection();
        onPress(circle.id);
      }}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      accessibilityRole="button"
      accessibilityLabel={`${circle.name}, ${COPY.circleMembers(circle.member_count)}`}
    >
      <CircleCover name={circle.name} coverUrl={null} />
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>
          {circle.name}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {COPY.circleMembers(circle.member_count)}
          {activity ? `  ·  ${activity}` : ''}
        </Text>
      </View>
      <ChevronRight size={CIRCLE.rowChevron} color={Colors.iconMuted} strokeWidth={2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: CIRCLE.rowVerticalPad,
    paddingHorizontal: CIRCLE.dividerInset,
  },
  rowPressed: { backgroundColor: Colors.warmTint },
  body: {
    flex: 1,
    marginLeft: CIRCLE.rowGap,
    marginRight: 8,
  },
  name: {
    fontFamily: Fonts.sansSemibold,
    fontSize: FontSizes.bodyLG,
    color: Colors.darkWarm,
  },
  meta: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.secondary,
    marginTop: 3,
  },
});
