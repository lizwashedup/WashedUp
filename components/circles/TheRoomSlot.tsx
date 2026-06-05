/**
 * TheRoomSlot - the reserved, gold-dashed placeholder for The Room, the opt-in
 * AI planner that proposes activities to a circle (spec section 3).
 *
 * UI ONLY. No Room logic ships this release: this is the design reservation
 * (gold = warm, optional, no pressure), deliberately non-interactive. The data
 * model (circle_briefs / circle_listener_state, circles.room_enabled) exists,
 * but nothing here reads or writes it yet.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Sparkles } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import { CIRCLE_HOME } from '../../constants/YoursDesign';
import { COPY } from '../yours/state/constants';

export default function TheRoomSlot() {
  return (
    <View
      style={styles.slot}
      accessibilityRole="text"
      accessibilityLabel={`${COPY.circleRoomTitle}. ${COPY.circleRoomSub}`}
    >
      <Sparkles size={CIRCLE_HOME.roomIcon} color={Colors.gold} strokeWidth={1.75} />
      <View style={styles.body}>
        <Text style={styles.title}>{COPY.circleRoomTitle}</Text>
        <Text style={styles.sub}>{COPY.circleRoomSub}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  slot: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: CIRCLE_HOME.sectionPadH,
    paddingVertical: CIRCLE_HOME.slotPadV,
    paddingHorizontal: CIRCLE_HOME.slotPadH,
    borderRadius: CIRCLE_HOME.slotRadius,
    borderWidth: CIRCLE_HOME.roomDashWidth,
    borderStyle: 'dashed',
    borderColor: Colors.gold,
    backgroundColor: Colors.goldBadgeSoft,
  },
  body: {
    flex: 1,
    marginLeft: 12,
  },
  title: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: Colors.quoteText,
  },
  sub: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    lineHeight: LineHeights.bodySM,
    color: Colors.secondary,
    marginTop: 3,
  },
});
