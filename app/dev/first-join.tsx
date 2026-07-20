/**
 * Dev-only review harness for the first-join surfaces (step 2). NOT part of
 * any user flow; onboarding wiring is step 2b after visual sign-off.
 *
 * States via query param:
 *   /dev/first-join               → fixture cards alone (card review)
 *   /dev/first-join?state=screen  → YourFirstWeek screen on fixture data
 *   /dev/first-join?state=empty   → YourFirstWeek empty/fallback state
 *   /dev/first-join?state=confirm → wishlist confirmation on fixture data
 *   /dev/first-join?state=live    → YourFirstWeek screen on live data
 *
 * Fixture avatar/plan imagery is dev-harness-only placeholder (never ships);
 * production surfaces render real user photos per spec b5.
 */
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Redirect, router, Stack, useLocalSearchParams } from 'expo-router';
import Colors from '../../constants/Colors';
import { FirstJoinDesign as D } from '../../constants/FirstJoinDesign';
import { Fonts, FontSizes } from '../../constants/Typography';
import { FirstJoinPlanCard, FirstJoinCardPlan } from '../../components/firstJoin/FirstJoinPlanCard';
import { WishlistConfirmation } from '../../components/firstJoin/WishlistConfirmation';
import { YourFirstWeekScreen } from '../../components/firstJoin/YourFirstWeekScreen';
import { supabase } from '../../lib/supabase';

// REAL plans, snapshotted from prod 2026-07-19, so every card tap opens a
// real, loadable plan page (events are public-read; fixture ids dead-ended
// on "couldn't load this plan"). Display values are frozen at snapshot time
// for deterministic review; refresh this block when the plans wrap.
const FIXTURE_PLANS: FirstJoinCardPlan[] = [
  {
    // Image-left variant (real event photo).
    id: 'd36fd4c0-d155-4bc8-8eba-21649b01c126',
    title: 'Walk Silverlake Reservoir & Picnic',
    start_time: '2026-07-25T00:30:00Z',
    neighborhood: 'Silver Lake',
    image_url:
      'https://upstjumasqblszevlgik.supabase.co/storage/v1/object/public/event-images/a9f3c004-073b-4dfd-b942-d0cd288a7aec/1784408589649.jpg?t=1784408590455',
    primary_vibe: 'outdoors',
    memberCount: 1,
    max_invites: 7,
    min_invites: 3,
    creatorName: 'Dani',
    creatorPhotoUrl:
      'https://upstjumasqblszevlgik.supabase.co/storage/v1/object/public/profile-photos/a9f3c004-073b-4dfd-b942-d0cd288a7aec/profile.jpg?t=1784164260276',
  },
  {
    // Brand-waves fallback variant (no event photo); full room.
    id: '8f341f06-e83a-4121-ad33-81d0f02c3fac',
    title: 'Pub trivia at a British bar!',
    start_time: '2026-07-21T03:00:00Z',
    neighborhood: 'Studio City',
    image_url: null,
    primary_vibe: 'nightlife',
    memberCount: 4,
    max_invites: 4,
    min_invites: 3,
    creatorName: 'Anna',
    creatorPhotoUrl:
      'https://upstjumasqblszevlgik.supabase.co/storage/v1/object/public/profile-photos/e2975ad6-0d90-4c49-9950-1f8f5bbf07d9/1780941279632.jpg?t=1780941280962',
  },
  {
    // Sparse variant: 1 going, no pill.
    id: '85a31d78-ec20-40a6-9d7d-3e0f13116e25',
    title: 'Evil Dead Burn at AMC Century City',
    start_time: '2026-07-23T03:15:00Z',
    neighborhood: 'Century City',
    image_url: null,
    primary_vibe: 'film',
    memberCount: 1,
    max_invites: 5,
    min_invites: 3,
    creatorName: 'Zach',
    creatorPhotoUrl:
      'https://upstjumasqblszevlgik.supabase.co/storage/v1/object/public/profile-photos/5de0c01f-3803-46fd-b46a-9dac7aea49d9/1779343323841.jpg?t=1779343324557',
  },
];

export default function FirstJoinDevScreen() {
  const { state } = useLocalSearchParams<{ state?: string }>();
  const [liveUserId, setLiveUserId] = useState<string | null>(null);

  useEffect(() => {
    if (state !== 'live') return;
    supabase.auth.getUser().then(({ data }) => setLiveUserId(data.user?.id ?? null));
  }, [state]);

  if (!__DEV__) return <Redirect href="/(tabs)/plans" />;

  if (state === 'confirm') {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <WishlistConfirmation
          neighborhood="Echo Park"
          vibeTags={['Music', 'Outdoors', 'Food']}
          // Same destinations as the real first-week-confirm route, so the
          // harness demonstrates the flow (needs a signed-in session to land).
          // The wishlist capture is about plans, so it exits to Plans.
          onContinue={() => router.replace('/(tabs)/plans')}
          onEditPreferences={() => router.push('/(tabs)/profile' as never)}
        />
      </>
    );
  }

  if (state === 'screen' || state === 'empty' || state === 'live') {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <YourFirstWeekScreen
          // Fixture states pass null so live impression logging never fires
          // from the harness (the table is real now); only state=live logs.
          userId={state === 'live' ? liveUserId : null}
          overridePlans={state === 'screen' ? FIXTURE_PLANS : undefined}
          overrideEmpty={state === 'empty'}
          // Harness never writes: wishlist tap shows the confirm preview, later
          // goes where the real screen goes (needs a signed-in session to land).
          onWishlist={() => router.push('/dev/first-join?state=confirm' as never)}
          onLater={() => router.replace('/(tabs)/explore')}
          onBack={() => router.replace('/(tabs)/explore')}
        />
      </>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.harnessLabel}>dev harness · first-join card · state={state ?? 'card'}</Text>
        {FIXTURE_PLANS.map((plan) => (
          <FirstJoinPlanCard key={plan.id} plan={plan} />
        ))}
        <View style={styles.footerSpacer} />
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
    paddingHorizontal: D.screenPaddingH,
    gap: D.screenGap,
  },
  harnessLabel: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.caption,
    color: Colors.warmGray,
    paddingVertical: D.sublineTopGap,
  },
  footerSpacer: {
    height: D.laterBottomGap,
  },
});
