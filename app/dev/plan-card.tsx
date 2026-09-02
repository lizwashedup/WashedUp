/**
 * Local visual review harness for Liz's activity-first plan-card experiment.
 * It is not linked from the app and redirects in production native builds.
 */
import React from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Redirect, Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PlanCard } from '../../components/plans/PlanCard';
import Colors from '../../constants/Colors';
import { PLAN_CARD_ACTIVITY_FIRST_ENABLED } from '../../constants/FeatureFlags';
import { Fonts, FontSizes } from '../../constants/Typography';

const REVIEW_PLAN = {
  id: 'activity-first-review',
  title: 'Love island reunion watch party',
  host_message: 'Would love to meet up with fellow islander watchers.',
  start_time: '2026-09-05T19:00:00-07:00',
  location_text: 'Happy Rabbit Bar and Lounge',
  neighborhood: 'Sherman Oaks',
  category: 'Other',
  max_invites: 6,
  member_count: 3,
  creator: {
    id: 'review-creator',
    first_name_display: 'Anna',
    profile_photo_url:
      'https://upstjumasqblszevlgik.supabase.co/storage/v1/object/public/profile-photos/5de0c01f-3803-46fd-b46a-9dac7aea49d9/1779343323841.jpg?t=1779343324557',
  },
  attendees: [
    {
      profile_photo_url:
        'https://upstjumasqblszevlgik.supabase.co/storage/v1/object/public/profile-photos/b3c31332-3fde-42fe-bfa9-9f23dfa1d543/1783530196579.jpg?t=1783530197096',
    },
    { profile_photo_url: null },
  ],
};

export default function PlanCardDevScreen() {
  if (!PLAN_CARD_ACTIVITY_FIRST_ENABLED || (!__DEV__ && Platform.OS !== 'web')) {
    return <Redirect href="/(tabs)/plans" />;
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.eyebrow}>LOCAL REVIEW</Text>
        <Text style={styles.heading}>Activity first</Text>
        <Text style={styles.context}>Proposed experiment</Text>
        <PlanCard
          plan={REVIEW_PLAN}
          layout="activity-first"
          onWishlist={() => {}}
          onCreatorPress={() => {}}
        />

        <View style={styles.divider} />

        <Text style={styles.heading}>Current card</Text>
        <Text style={styles.context}>Default control</Text>
        <PlanCard plan={REVIEW_PLAN} onWishlist={() => {}} onCreatorPress={() => {}} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.cream,
  },
  scroll: {
    width: '100%',
    maxWidth: 430,
    alignSelf: 'center',
    paddingHorizontal: 18,
    paddingVertical: 24,
  },
  eyebrow: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    letterSpacing: 1.5,
    color: Colors.terracotta,
    marginBottom: 8,
  },
  heading: {
    fontFamily: Fonts.displayBold,
    fontSize: FontSizes.displayLG,
    color: Colors.darkWarm,
  },
  context: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.secondary,
    marginBottom: 12,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.borderWarm,
    marginVertical: 28,
  },
});
