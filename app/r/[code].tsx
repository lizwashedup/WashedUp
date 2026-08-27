/**
 * Referral-link landing for https://washedup.app/r/<code> and
 * washedupapp://r/<code> (S-05 fix, 2026-08-25).
 *
 * Before this screen existed the app CLAIMED /r/ on both platforms
 * (iOS applinks on the whole domain, Android intent filter on /r/) but had
 * no route for it, so a tapped referral link opened the app onto
 * +not-found's spinner and bounced -- dead on iOS entirely, since the OS
 * never even offered the browser. Now the tap lands here:
 *   - signed in  -> claim the inviter's server-side request, then land on the
 *     inviter's profile so the tap visibly DID something. handleReferralUrl
 *     in app/_layout.tsx may fire for the same URL via the Linking listener;
 *     the claim RPC is idempotent, so the double-fire is harmless.
 *   - signed out -> stash the code (consumePendingReferral runs it after
 *     sign-in, unchanged) and continue to the auth gate.
 *   - dead code  -> a real screen with a way onward, mirroring /e/'s
 *     "this one is gone" pattern, never a silent bounce.
 */

import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { supabase } from '../../lib/supabase';
import { unauthedRoute } from '../../lib/authRouting';
import { resolveAndConnect, stashPendingReferral } from '../../lib/yours/referralLink';
import { YOURS_PAGE_ENABLED } from '../../constants/FeatureFlags';

export default function ReferralLanding() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const [dead, setDead] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!code || typeof code !== 'string' || !/^[A-Za-z0-9_-]+$/.test(code)) {
        if (!cancelled) setDead(true);
        return;
      }
      try {
        const { data } = await supabase.auth.getSession();
        if (cancelled) return;
        if (!data.session?.user) {
          await stashPendingReferral(code);
          if (!cancelled) router.replace(unauthedRoute() as never);
          return;
        }
        const inviterId = await resolveAndConnect(code);
        if (cancelled) return;
        if (!inviterId) {
          setDead(true);
          return;
        }
        if (YOURS_PAGE_ENABLED) {
          router.replace(`/person/${inviterId}` as never);
        } else {
          router.replace('/(tabs)/plans' as never);
        }
      } catch {
        if (!cancelled) setDead(true);
      }
    })();
    return () => { cancelled = true; };
  }, [code]);

  if (dead) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.centered}>
          {/* copy to the taste gate: never a dead end, always a way on */}
          <Text style={styles.title}>this invite is gone</Text>
          <Text style={styles.body}>the link may be old, or whoever sent it made a new one.</Text>
          <TouchableOpacity
            style={styles.cta}
            onPress={() => router.replace('/(tabs)/plans' as never)}
            accessibilityRole="button"
          >
            <Text style={styles.ctaText}>see what's on</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.loading}>
      <ActivityIndicator size="large" color={Colors.terracotta} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.parchment },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 10 },
  title: { fontFamily: Fonts.displayBold, fontSize: FontSizes.displayMD, color: Colors.asphalt },
  body: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.textMedium, textAlign: 'center' },
  cta: {
    marginTop: 12, backgroundColor: Colors.terracotta, borderRadius: 999,
    paddingVertical: 14, paddingHorizontal: 28, minHeight: 44, justifyContent: 'center',
  },
  ctaText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.white },
});
