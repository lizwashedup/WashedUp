import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Image,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { router } from 'expo-router';
import { hapticLight } from '../../../lib/haptics';
import { supabase } from '../../../lib/supabase';
import { getUserBounded } from '../../../lib/authGate';
import { clearAllDrafts } from '../../../lib/onboardingDraft';
import { useSubmitGuard } from '../../../hooks/useSubmitGuard';
import { BrandedAlert, type BrandedAlertButton } from '../../../components/BrandedAlert';
import Colors from '../../../constants/Colors';
import { Fonts } from '../../../constants/Typography';

export default function OnboardingWaitlistedScreen() {
  const [city, setCity] = useState('');
  const [loading, setLoading] = useState(false);
  const [alertInfo, setAlertInfo] = useState<{
    title: string;
    message: string;
    buttons?: BrandedAlertButton[];
  } | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('profiles')
        .select('city')
        .eq('id', user.id)
        .maybeSingle();
      if (data?.city && data.city !== 'Other') setCity(data.city);
    })();
  }, []);

  const submit = useSubmitGuard();

  // Real gap found and fixed 2026-09-06: this screen used to be sign-out-only,
  // no way back for someone who mistakenly said "no" or is now actually in LA.
  // Every one of those became a manual support email + hand-edited profile row
  // (real incident: Kendall Ward-wells, 2026-09-06). Mirrors the exact update
  // la-check.tsx's "yes, i live here" path already does.
  const handleImInLA = async () => {
    if (loading) return;
    if (!submit.tryAcquire()) return;
    hapticLight();
    setLoading(true);
    try {
      const { user, resolved } = await getUserBounded();
      if (!user) {
        if (!resolved) {
          setAlertInfo({ title: 'something went wrong', message: "couldn't reach the server. try again." });
          return;
        }
        setAlertInfo({ title: 'session expired', message: 'please sign in again.' });
        await clearAllDrafts();
        await supabase.auth.signOut();
        return;
      }
      const { error } = await supabase
        .from('profiles')
        .update({ city: 'Los Angeles', is_visitor: false, onboarding_status: 'referral' })
        .eq('id', user.id);
      if (error) {
        setAlertInfo({ title: 'something went wrong', message: 'could not save. try again.' });
        return;
      }
      router.replace('/onboarding/referral');
    } finally {
      submit.release();
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    hapticLight();
    await clearAllDrafts();
    await supabase.auth.signOut();
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <StatusBar style="dark" />
      <View style={styles.container}>
        <View style={styles.brandRow}>
          <Image
            source={require('../../../assets/images/w-logo-waves.png')}
            style={styles.wMark}
            resizeMode="contain"
          />
        </View>

        <View style={styles.content}>
          <Text style={styles.heading}>
            <Text style={styles.headingSans}>you’re on the </Text>
            <Text style={styles.headingItalic}>waitlist.</Text>
          </Text>
          <Text style={styles.body}>
            {city
              ? `we’ll let you know the moment washedup lands in ${city}. we’re expanding as fast as we can.`
              : `we’ll let you know the moment washedup expands to your city. we’re expanding as fast as we can.`}
          </Text>
        </View>

        <Text style={styles.recoveryPrompt}>already in la, or just moved here?</Text>
        <TouchableOpacity
          style={[styles.primaryButton, loading && styles.primaryButtonDisabled]}
          onPress={handleImInLA}
          activeOpacity={0.9}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color={Colors.surface} />
          ) : (
            <Text style={styles.primaryButtonText}>yes, i live here</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.signOutButton}
          onPress={handleSignOut}
          activeOpacity={0.85}
          disabled={loading}
        >
          <Text style={styles.signOutText}>sign out</Text>
        </TouchableOpacity>
      </View>
      <BrandedAlert
        visible={!!alertInfo}
        title={alertInfo?.title ?? ''}
        message={alertInfo?.message}
        buttons={alertInfo?.buttons}
        onClose={() => setAlertInfo(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.cream },
  container: {
    flex: 1,
    paddingHorizontal: 28,
    paddingTop: 8,
    paddingBottom: 16,
  },

  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  wMark: { width: 28, height: 28, tintColor: Colors.brand },
  wordmark: { width: 92, height: 22, tintColor: Colors.text1, opacity: 0.92 },

  content: { flex: 1, justifyContent: 'center' },

  heading: {
    fontSize: 36,
    lineHeight: 40,
    color: Colors.text1,
    marginBottom: 16,
  },
  headingSans: { fontFamily: Fonts.headline },
  headingItalic: { fontFamily: Fonts.display },

  body: {
    fontFamily: Fonts.sans,
    fontSize: 16,
    lineHeight: 24,
    color: Colors.text2,
  },

  recoveryPrompt: {
    fontFamily: Fonts.sans,
    fontSize: 13,
    color: Colors.text3,
    textAlign: 'center',
    marginBottom: 10,
  },

  primaryButton: {
    height: 52,
    borderRadius: 8,
    backgroundColor: Colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  primaryButtonDisabled: {
    backgroundColor: Colors.borderWarm,
  },
  primaryButtonText: {
    fontFamily: Fonts.sansBold,
    fontSize: 16,
    color: Colors.surface,
    letterSpacing: 0.2,
  },

  signOutButton: {
    height: 52,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: Colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  signOutText: {
    fontFamily: Fonts.sansSemibold,
    fontSize: 15,
    color: Colors.brand,
    letterSpacing: 0.2,
  },
});
