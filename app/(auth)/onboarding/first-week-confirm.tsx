/**
 * Wishlist confirmation route: "you're on the list" (step 2b). Reached only
 * after saveAreaWishlist succeeds on the first-week step. Shows what we are
 * watching for (profile neighborhood + vibe tags) and exits to Scene.
 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, BackHandler, StyleSheet, View } from 'react-native';
import { router, Stack } from 'expo-router';
import Colors from '../../../constants/Colors';
import { WishlistConfirmation } from '../../../components/firstJoin/WishlistConfirmation';
import { getUserBounded } from '../../../lib/authGate';
import { PLANS_ROUTE, SCENE_ROUTE } from '../../../lib/firstJoin/onboardingGate';
import { supabase } from '../../../lib/supabase';

interface WatchingProfile {
  neighborhood: string | null;
  vibeTags: string[];
}

export default function FirstWeekConfirm() {
  const [profile, setProfile] = useState<WatchingProfile | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { user } = await getUserBounded();
      if (cancelled) return;
      if (!user) {
        router.replace(SCENE_ROUTE);
        return;
      }
      const { data } = await supabase
        .from('profiles')
        .select('neighborhood, vibe_tags')
        .eq('id', user.id)
        .maybeSingle();
      if (cancelled) return;
      setProfile({
        neighborhood: data?.neighborhood ?? null,
        vibeTags: data?.vibe_tags ?? [],
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Back skips the ceremony, not the outcome: the wishlist is already saved.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      router.replace(PLANS_ROUTE);
      return true;
    });
    return () => sub.remove();
  }, []);

  return (
    <>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      {profile === null ? (
        <View style={styles.loading}>
          <ActivityIndicator color={Colors.terracotta} />
        </View>
      ) : (
        <WishlistConfirmation
          neighborhood={profile.neighborhood}
          vibeTags={profile.vibeTags}
          onContinue={() => router.replace(PLANS_ROUTE)}
          onEditPreferences={() => router.push('/(tabs)/profile' as never)}
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
