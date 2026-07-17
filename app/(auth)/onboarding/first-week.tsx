/**
 * Final onboarding step: "your first week" (spec a2). Mounted ONLY by the
 * post-photo transition (photo step navigates here with ?from=onboarding
 * after onboarding_status flips to 'complete'). Existing users, deep links,
 * and unfinished onboarding all redirect: this screen never blocks anyone.
 *
 * "later" and Android back both land on Scene. The wishlist capture writes
 * (saveAreaWishlist), then moves to the confirmation screen.
 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, BackHandler, StyleSheet, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import Colors from '../../../constants/Colors';
import { BrandedAlert } from '../../../components/BrandedAlert';
import { YourFirstWeekScreen } from '../../../components/firstJoin/YourFirstWeekScreen';
import { getUserBounded } from '../../../lib/authGate';
import { FIRST_JOIN_COPY as COPY } from '../../../lib/firstJoin/copy';
import { onboardingDest } from '../../../lib/authRouting';
import { resolveFirstWeekAccess, SCENE_ROUTE } from '../../../lib/firstJoin/onboardingGate';
import { saveAreaWishlist } from '../../../lib/firstJoin/wishlist';
import { supabase } from '../../../lib/supabase';

type GateState =
  | { phase: 'loading' }
  | { phase: 'show'; userId: string };

export default function FirstWeekStep() {
  const { from } = useLocalSearchParams<{ from?: string }>();
  const [gate, setGate] = useState<GateState>({ phase: 'loading' });
  const [saveFailed, setSaveFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { user } = await getUserBounded();
      if (cancelled) return;
      if (!user) {
        router.replace(SCENE_ROUTE);
        return;
      }
      const { data: profile } = await supabase
        .from('profiles')
        .select('onboarding_status, referral_source')
        .eq('id', user.id)
        .maybeSingle();
      if (cancelled) return;

      const access = resolveFirstWeekAccess({
        fromParam: from,
        onboardingStatus: profile?.onboarding_status ?? null,
      });
      if (access.kind === 'redirect') {
        router.replace(access.to);
      } else if (access.kind === 'resume_onboarding') {
        router.replace(onboardingDest(profile?.onboarding_status ?? null, profile?.referral_source ?? null) as never);
      } else {
        setGate({ phase: 'show', userId: user.id });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [from]);

  // Hardware back never re-enters onboarding; it lands on Scene (spec a2).
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      router.replace(SCENE_ROUTE);
      return true;
    });
    return () => sub.remove();
  }, []);

  const handleLater = () => {
    router.replace(SCENE_ROUTE);
  };

  const handleWishlist = async () => {
    if (gate.phase !== 'show' || saving) return;
    setSaving(true);
    const result = await saveAreaWishlist(gate.userId);
    setSaving(false);
    if (result.ok) {
      router.push('/onboarding/first-week-confirm' as never);
    } else {
      // Never claim "you're on the list" unless the write landed.
      setSaveFailed(true);
    }
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      {gate.phase === 'loading' ? (
        <View style={styles.loading}>
          <ActivityIndicator color={Colors.terracotta} />
        </View>
      ) : (
        <YourFirstWeekScreen userId={gate.userId} onWishlist={handleWishlist} onLater={handleLater} onBack={handleLater} />
      )}
      {saveFailed && (
        <BrandedAlert
          visible
          onClose={() => setSaveFailed(false)}
          title={COPY.saveFailedTitle}
          message={COPY.saveFailedBody}
          buttons={[{ text: COPY.saveFailedOk, onPress: () => setSaveFailed(false) }]}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: Colors.cream,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
