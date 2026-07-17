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
import { Redirect, Stack, useLocalSearchParams } from 'expo-router';
import Colors from '../../constants/Colors';
import { FirstJoinDesign as D } from '../../constants/FirstJoinDesign';
import { Fonts, FontSizes } from '../../constants/Typography';
import { FirstJoinPlanCard, FirstJoinCardPlan } from '../../components/firstJoin/FirstJoinPlanCard';
import { WishlistConfirmation } from '../../components/firstJoin/WishlistConfirmation';
import { YourFirstWeekScreen } from '../../components/firstJoin/YourFirstWeekScreen';
import { supabase } from '../../lib/supabase';

const FIXTURE_AVATARS = [1, 2, 3, 4, 5, 6].map((i) => ({
  profile_photo_url: `https://i.pravatar.cc/96?img=${i + 10}`,
}));

// Next Saturday/Tuesday-ish instants; exact weekday label just needs to render.
const FIXTURE_SATURDAY = '2026-07-19T02:30:00Z'; // sat 7:30 pm LA
const FIXTURE_TUESDAY = '2026-07-22T02:00:00Z'; // tue 7:00 pm LA

const FIXTURE_PLANS: FirstJoinCardPlan[] = [
  {
    // Slot 1: big room. Gold tag, both pills, full avatar cluster, real image.
    id: 'fixture-big-room',
    title: 'griffith park sunset hike',
    start_time: FIXTURE_SATURDAY,
    neighborhood: 'Los Feliz',
    image_url: 'https://picsum.photos/seed/washedup-hike/320/320',
    primary_vibe: 'Outdoors',
    memberCount: 7,
    max_invites: 9,
    min_invites: 4,
    bigRoom: true,
    creatorName: 'Sofia',
    creatorPhotoUrl: 'https://i.pravatar.cc/96?img=32',
    attendees: FIXTURE_AVATARS,
  },
  {
    // No image → vibe illustration fallback; past minimum but plenty of room.
    id: 'fixture-vibe-fallback',
    title: 'sunday picnic at echo park lake',
    start_time: FIXTURE_TUESDAY,
    neighborhood: 'Echo Park',
    image_url: null,
    primary_vibe: 'Food',
    memberCount: 4,
    max_invites: 12,
    min_invites: 3,
    bigRoom: false,
    creatorName: 'Marlowe',
    creatorPhotoUrl: 'https://i.pravatar.cc/96?img=47',
    attendees: FIXTURE_AVATARS.slice(0, 4),
  },
  {
    // Sparse plan: no pills (not past minimum), placeholder faces.
    id: 'fixture-sparse',
    title: 'ktown karaoke night',
    start_time: FIXTURE_TUESDAY,
    neighborhood: 'Koreatown',
    image_url: null,
    primary_vibe: 'Nightlife',
    memberCount: 2,
    max_invites: 8,
    min_invites: 4,
    bigRoom: false,
    creatorName: 'Ren',
    creatorPhotoUrl: null,
    attendees: [{ profile_photo_url: null }, { profile_photo_url: null }],
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
          onContinue={() => console.log('[firstJoin dev] continue tap (stub)')}
          onEditPreferences={() => console.log('[firstJoin dev] edit preferences tap (stub)')}
        />
      </>
    );
  }

  if (state === 'screen' || state === 'empty' || state === 'live') {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <YourFirstWeekScreen
          userId={state === 'live' ? liveUserId : 'dev-harness-user'}
          overridePlans={state === 'screen' ? FIXTURE_PLANS : undefined}
          overrideEmpty={state === 'empty'}
          onWishlist={() => console.log('[firstJoin dev] wishlist tap (stub)')}
          onLater={() => console.log('[firstJoin dev] later tap (stub)')}
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
