/**
 * ChatPlanCard - the compact plan card rendered for a chat system message that
 * carries a ref_event_id (an invite delivered by invite_person_to_plan /
 * invite_people_to_plan). Date + title + a quiet "Join if you're around", tapping
 * through to plan detail. A wrapped/deleted plan renders quiet and inert with one
 * line ("This plan has wrapped.") - never a broken or error card.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { COPY } from '../yours/state/constants';
import { useEventCard } from '../../hooks/useEventCard';
import { formatPlanWhenLA } from '../../lib/planTime';

export default function ChatPlanCard({ eventId }: { eventId: string }) {
  const { data, isLoading } = useEventCard(eventId);

  // While loading, hold the card's footprint without flashing placeholder text.
  if (isLoading) {
    return <View style={[styles.card, styles.cardLoading]} />;
  }

  // Wrapped: no row, or completed/cancelled. Quiet, inert, single line.
  if (!data || data.wrapped) {
    return (
      <View style={[styles.card, styles.cardInert]} accessibilityLabel={COPY.chatPlanWrapped}>
        <Text style={styles.wrapped}>{COPY.chatPlanWrapped}</Text>
      </View>
    );
  }

  return (
    <Pressable
      style={styles.card}
      onPress={() => router.push(`/plan/${data.id}` as never)}
      accessibilityRole="button"
      accessibilityLabel={data.title}
    >
      <Text style={styles.when}>{formatPlanWhenLA(data.start_time)}</Text>
      <Text style={styles.title} numberOfLines={2}>{data.title}</Text>
      <Text style={styles.joinLine}>{COPY.circlePlanJoinLine}</Text>
    </Pressable>
  );
}

const CARD_W = 240;

const styles = StyleSheet.create({
  card: {
    width: CARD_W,
    alignSelf: 'center',
    backgroundColor: Colors.cream,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginVertical: 8,
    gap: 4,
  },
  cardLoading: { height: 92 },
  cardInert: { alignItems: 'center', justifyContent: 'center' },
  when: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.secondary,
  },
  title: {
    fontFamily: Fonts.displayBold,
    fontSize: FontSizes.displaySM,
    color: Colors.darkWarm,
  },
  joinLine: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.terracotta,
    marginTop: 2,
  },
  wrapped: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.tertiary,
  },
});
