import React from 'react';
import { Pressable, Text, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';
import type { NearbyPlan } from '../../../hooks/useNearbyPlans';

function when(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      weekday: 'long',
      hour: 'numeric',
    });
  } catch {
    return '';
  }
}

/** Horizontal-scrolling nearby-plan preview card (activation funnel). */
export default function NearbyPlanCard({ plan }: { plan: NearbyPlan }) {
  return (
    <Pressable
      style={styles.card}
      onPress={() => router.push(`/plan/${plan.id}` as never)}
      accessibilityRole="button"
      accessibilityLabel={plan.title}
    >
      <Text style={styles.title} numberOfLines={2}>
        {plan.title}
      </Text>
      <Text style={styles.when}>{when(plan.start_time)}</Text>
      {plan.member_count != null && (
        <Text style={styles.going}>{plan.member_count} going</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 240,
    backgroundColor: Colors.cream,
    borderRadius: 16,
    padding: 16,
    marginRight: 12,
    gap: 6,
  },
  title: {
    fontFamily: Fonts.displayBold,
    fontSize: FontSizes.displaySM,
    color: Colors.asphalt,
  },
  when: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.secondary,
  },
  going: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.terracotta,
    marginTop: 2,
  },
});
