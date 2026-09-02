/**
 * RoomSlot - The Room's reserved placeholder tile.
 *
 * Spec (WashedUp_Circles_Functional_Spec.md section 3, "The Room (reserve
 * space, do not build)"): the circle page reserves a UI slot for The Room, an
 * opt-in AI planning agent that proposes activities to the circle. It is not
 * active this release. "Design reserves the space (a gold dashed placeholder
 * reading 'the room is listening' with an opt-in toggle, or empty if opted
 * out). The data model is baked in (circle_briefs, circle_listener_state) but
 * no Room logic ships now."
 *
 * This component renders ONLY that reserved tile. It never reads or writes
 * circle_briefs, circle_listener_state, or planner_queue (the Room's actual
 * brain/state machine, correctly dormant, RLS-locked to service_role). The
 * one field it touches is `circles.room_enabled`, a plain opt-in flag already
 * returned by get_circle() and already an update_circle() parameter, both
 * shipped for the existing admin identity-edit flow (rename/cover). Flipping
 * that flag here reuses that existing plumbing; it starts no Room behavior.
 *
 * Two states:
 *   - room_enabled true: gold dashed tile, "the room is listening".
 *   - room_enabled false (default): the same reserved slot, showing its "not
 *     on yet" framing (COPY.circleRoomSub) instead of the listening line. Per
 *     that copy's own authoring comment, this IS the spec's "empty" state.
 *     The slot itself always renders (design reserves the space); the Room
 *     just has nothing to say yet.
 *
 * Toggling is admin-gated server-side (update_circle raises for a non-admin
 * caller, same gate as renaming/cover), so `isAdmin` disables the Switch for
 * everyone else. They still see the circle's current state, which matches
 * how a circle-wide setting (not a private one) should read to its members.
 *
 * NOTE ON TWO INLINE STRINGS BELOW: this build could not get an approved edit
 * to components/yours/state/constants.ts (see that file's existing, unused
 * COPY.circleRoomTitle / COPY.circleRoomSub, both reused as-is below).
 * ROOM_LISTENING_TEXT and ROOM_TOGGLE_ERROR are the two new strings that
 * belong alongside them once that edit lands. ROOM_LISTENING_TEXT is the
 * spec's literal placeholder phrase verbatim. ROOM_TOGGLE_ERROR matches this
 * file's existing "Couldn't X just now. Try again." error-copy template
 * exactly. Moving both into COPY (and importing them here) is a pure
 * copy-organization follow-up, not a behavior change.
 */
import React from 'react';
import { View, Text, Switch, Alert, StyleSheet } from 'react-native';
import { Sparkles } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import { CIRCLE_HOME } from '../../constants/YoursDesign';
import { COPY } from '../yours/state/constants';
import { hapticSelection } from '../../lib/haptics';
import { useUpdateCircleRoom } from '../../hooks/useUpdateCircleRoom';

// Spec section 3's literal placeholder line, shown only once a circle opts in.
const ROOM_LISTENING_TEXT = 'the room is listening';
const ROOM_TOGGLE_ERROR = "Couldn't update the room just now. Try again.";

export default function RoomSlot({
  circleId,
  roomEnabled,
  isAdmin,
}: {
  circleId: string;
  /** circles.room_enabled, from get_circle().circle: the one live field this reads. */
  roomEnabled: boolean;
  /** Gate the Switch to circle admins; update_circle rejects anyone else. */
  isAdmin: boolean;
}) {
  const updateRoom = useUpdateCircleRoom(circleId);

  const onToggle = (next: boolean) => {
    if (!isAdmin || updateRoom.isPending) return;
    hapticSelection();
    updateRoom.mutate(next, {
      onError: () => Alert.alert(ROOM_TOGGLE_ERROR),
    });
  };

  return (
    <View style={styles.card}>
      <Sparkles size={CIRCLE_HOME.roomIcon} color={Colors.goldAccent} strokeWidth={1.75} />
      <View style={styles.body}>
        <Text style={styles.headline} numberOfLines={2}>
          {roomEnabled ? ROOM_LISTENING_TEXT : COPY.circleRoomSub}
        </Text>
      </View>
      <Switch
        value={roomEnabled}
        onValueChange={onToggle}
        disabled={!isAdmin || updateRoom.isPending}
        trackColor={{ false: Colors.border, true: Colors.goldAccent }}
        thumbColor={Colors.white}
        accessibilityLabel={COPY.circleRoomTitle}
        accessibilityState={{ disabled: !isAdmin }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: CIRCLE_HOME.sectionPadH,
    paddingVertical: CIRCLE_HOME.slotPadV,
    paddingHorizontal: CIRCLE_HOME.slotPadH,
    borderRadius: CIRCLE_HOME.slotRadius,
    borderWidth: CIRCLE_HOME.roomDashWidth,
    borderStyle: 'dashed',
    borderColor: Colors.goldAccent,
  },
  body: { flex: 1, minWidth: 0 },
  headline: {
    fontFamily: Fonts.sansSemibold,
    fontSize: FontSizes.bodyMD,
    lineHeight: LineHeights.bodyMD,
    color: Colors.darkWarm,
  },
});
