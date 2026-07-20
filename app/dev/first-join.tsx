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
// real, loadable plan page (events are public-read). Founder ruling 7-19:
// a first-week card must NEVER lead to a plan the viewer can't join, so
// harness fixtures are gender_rule='mixed' with no age gate (any viewer,
// signed in or out, can open and join them). The production screen gets
// this guarantee from the ranking service's eligibility filter. Display
// values frozen at snapshot; refresh this block when the plans wrap.
const FIXTURE_PLANS: FirstJoinCardPlan[] = [
  {
    // Image-left variant (real event photo).
    id: 'd69a82d3-4909-4565-87ed-94e07148598b',
    title: 'US Open of Surf July 25-29',
    start_time: '2026-07-25T14:00:00Z',
    neighborhood: 'Other',
    image_url:
      'https://upstjumasqblszevlgik.supabase.co/storage/v1/object/public/event-images/b3c31332-3fde-42fe-bfa9-9f23dfa1d543/1783532259149.jpg?t=1783532259878',
    primary_vibe: 'outdoors',
    memberCount: 2,
    max_invites: 7,
    min_invites: 3,
    creatorName: 'Wendell',
    creatorPhotoUrl:
      'https://upstjumasqblszevlgik.supabase.co/storage/v1/object/public/profile-photos/b3c31332-3fde-42fe-bfa9-9f23dfa1d543/1783530196579.jpg?t=1783530197096',
  },
  {
    // Brand-waves fallback variant (no event photo).
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
  {
    // Sparse variant: 1 going, no pill.
    id: '8cf1a24e-1906-4247-bd5c-97d614db2c61',
    title: 'Ruck',
    start_time: '2026-07-25T14:45:00Z',
    neighborhood: 'Beach Cities',
    image_url: null,
    primary_vibe: 'wellness',
    memberCount: 1,
    max_invites: 7,
    min_invites: 3,
    creatorName: 'Toni',
    creatorPhotoUrl:
      'https://upstjumasqblszevlgik.supabase.co/storage/v1/object/public/profile-photos/9dfe4cf4-045a-4124-aaca-94c8d3ebaa46/1783492950566.jpg?t=1783492951500',
  },
];

export default function FirstJoinDevScreen() {
  const { state } = useLocalSearchParams<{ state?: string }>();
  const [liveUserId, setLiveUserId] = useState<string | null>(null);
  const [harnessVibes, setHarnessVibes] = useState<string[]>([]);

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
          // Starts empty to demo the picker; toggles are local-state only
          // (the harness never writes).
          vibeTags={harnessVibes}
          onToggleVibe={(tag) =>
            setHarnessVibes((prev) =>
              prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
            )
          }
          // Same destinations as the real first-week-confirm route, so the
          // harness demonstrates the flow (needs a signed-in session to land).
          // The wishlist capture is about plans, so it exits to Plans.
          onContinue={() => router.replace('/(tabs)/plans')}
          // Deep-links into the edit modal (where neighborhood + vibes live);
          // polish-track: replace with an in-place preferences sheet later.
          onEditPreferences={() => router.push('/(tabs)/profile?openEdit=true' as never)}
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
