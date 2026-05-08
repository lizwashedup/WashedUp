import { useCallback, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ImageBackground,
  Image,
  Linking,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import Colors from '../../constants/Colors';
import { Fonts } from '../../constants/Typography';
import { supabase } from '../../lib/supabase';
import { hapticLight, hapticError } from '../../lib/haptics';
import { formatToE164, isValidUSPhone } from '../../lib/phoneFormat';
import { wasOtpRecentlySent, markOtpSent } from '../../lib/navState';
import { useSubmitGuard } from '../../hooks/useSubmitGuard';
import { WELCOME_HERO_URI } from '../../lib/onboardingAssets';
import PhoneInput from '../../components/auth/PhoneInput';

const TERMS_URL = 'https://washedup.app/terms';
const PRIVACY_URL = 'https://washedup.app/privacy';
const GUIDELINES_URL = 'https://washedup.app/community-guidelines';

export default function PhoneEntryScreen() {
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tenDigits = phone.length === 10;
  const valid = isValidUSPhone(phone);
  const canSubmit = tenDigits && valid && !submitting;
  const submit = useSubmitGuard();

  const handlePhoneChange = useCallback((d: string) => {
    setError(null);
    setPhone(d);
  }, []);

  const handleContinue = async () => {
    if (!canSubmit) return;
    if (!submit.tryAcquire()) return;
    setError(null);
    setSubmitting(true);
    try {
      const e164 = formatToE164(phone);
      // Defensive guard: phone-entry is only for unauthenticated users.
      // If somehow an already-signed-in user lands here (routing regression,
      // deep link, stale session), running signInWithOtp would create a
      // duplicate auth.users row and orphan the existing user's data —
      // the bug originally patched in commit 5cf9927 via signOut+resignin.
      //
      // The correct flow for an authed user without a phone is the
      // migration-gate (auth.updateUser({phone}) → phone_change verifyOtp
      // on the SAME user id). authedDest() already routes them there;
      // this guard is the per-screen safety net.
      const { data: { session: existingSession } } = await supabase.auth.getSession();
      if (existingSession?.user?.id) {
        submit.release();
        setSubmitting(false);
        router.replace('/migration-gate');
        return;
      }
      // If we've sent an OTP to this number recently (e.g., user backed out
      // of /verify-code and re-tapped continue), skip the API and let them
      // verify the code that's already in their messages.
      if (!wasOtpRecentlySent(e164)) {
        const { error: otpError } = await supabase.auth.signInWithOtp({
          phone: e164,
        });
        if (otpError) throw otpError;
        markOtpSent(e164);
      }
      hapticLight();
      router.push({
        pathname: '/verify-code',
        params: { phone },
      });
    } catch (e: unknown) {
      hapticError();
      const status = (e as { status?: number } | null)?.status;
      const message = (e as { message?: string } | null)?.message ?? '';
      if (status === 429 || /rate.?limit/i.test(message)) {
        setError('too many attempts. try again in a few minutes.');
      } else if (/invalid.*phone/i.test(message)) {
        setError('that phone number doesn’t look right. double-check and try again.');
      } else {
        setError('something went wrong. try again.');
      }
    } finally {
      submit.release();
      setSubmitting(false);
    }
  };

  return (
    <ImageBackground
      source={{ uri: WELCOME_HERO_URI }}
      style={styles.bg}
      resizeMode="cover"
    >
      <StatusBar style="light" />
      <LinearGradient
        colors={[
          Colors.overlayWarm,
          Colors.overlayWarmSoft,
          Colors.overlayBrandDeep,
        ]}
        locations={[0, 0.5, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <LinearGradient
        colors={['transparent', Colors.overlayDark55]}
        locations={[0.55, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.kav}
        >
          <View style={styles.topRow}>
            <Image
              source={require('../../assets/images/washedup-logo.png')}
              style={styles.wordmark}
              resizeMode="contain"
            />
          </View>

          <View style={styles.heroWrap}>
            <Text style={styles.hero}>find people{'\n'}to go with</Text>
          </View>

          <View style={styles.bottomBlock}>
            <Text style={styles.label}>phone number</Text>
            <PhoneInput
              value={phone}
              onChangeText={handlePhoneChange}
              onSubmitEditing={handleContinue}
              error={error ?? undefined}
              editable={!submitting}
            />

            <TouchableOpacity
              style={[styles.cta, !canSubmit && styles.ctaDisabled]}
              onPress={handleContinue}
              activeOpacity={0.9}
              disabled={!canSubmit}
            >
              <Text style={[styles.ctaText, !canSubmit && styles.ctaTextDisabled]}>
                continue
              </Text>
            </TouchableOpacity>

            {/* Escape hatch for existing email/Apple/Google users — without
                this they'd accidentally create a duplicate account by
                entering their phone above. Full-width secondary button so
                it's easy to find but visually subordinate to "continue". */}
            <TouchableOpacity
              onPress={() => router.push('/login')}
              activeOpacity={0.85}
              style={styles.ctaSecondary}
              accessibilityRole="button"
              accessibilityLabel="already on washedup? sign in"
            >
              <Text style={styles.ctaSecondaryText}>already a member? sign in</Text>
            </TouchableOpacity>

            <Text style={styles.legal}>
              by continuing you agree to our{' '}
              <Text
                style={styles.legalLink}
                onPress={() => Linking.openURL(TERMS_URL)}
              >
                terms
              </Text>
              {', '}
              <Text
                style={styles.legalLink}
                onPress={() => Linking.openURL(PRIVACY_URL)}
              >
                privacy policy
              </Text>
              {' & '}
              <Text
                style={styles.legalLink}
                onPress={() => Linking.openURL(GUIDELINES_URL)}
              >
                community guidelines
              </Text>
            </Text>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  bg: { flex: 1, backgroundColor: Colors.brandDeep },
  safe: { flex: 1 },
  kav: { flex: 1, paddingHorizontal: 28 },
  topRow: {
    paddingTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  wordmark: {
    width: 132,
    height: 28,
    opacity: 0.96,
  },
  heroWrap: {
    flex: 1,
    justifyContent: 'center',
    paddingTop: 8,
    paddingBottom: 24,
  },
  hero: {
    fontFamily: Fonts.displayBold,
    fontSize: 44,
    lineHeight: 48,
    color: Colors.terracotta,
    maxWidth: 280,
    textShadowColor: Colors.shadowWarmDark,
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 16,
  },
  bottomBlock: {
    paddingBottom: 12,
    gap: 12,
  },
  label: {
    fontFamily: Fonts.sansSemibold,
    fontSize: 13,
    color: Colors.creamMedium,
    letterSpacing: 0.2,
    marginBottom: 2,
  },
  cta: {
    height: 52,
    borderRadius: 8,
    backgroundColor: Colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    shadowColor: Colors.brandDeep,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.45,
    shadowRadius: 28,
    elevation: 6,
  },
  ctaDisabled: {
    backgroundColor: Colors.borderWarm,
    shadowOpacity: 0,
    elevation: 0,
  },
  ctaText: {
    fontFamily: Fonts.sansBold,
    fontSize: 16,
    color: Colors.surface,
    letterSpacing: 0.2,
  },
  ctaTextDisabled: {
    color: Colors.text3,
  },
  legal: {
    fontFamily: Fonts.sans,
    fontSize: 11,
    lineHeight: 16,
    color: Colors.creamMuted,
    textAlign: 'center',
    paddingHorizontal: 16,
    marginTop: 8,
  },
  legalLink: {
    fontFamily: Fonts.sansSemibold,
    fontSize: 11,
    lineHeight: 16,
    color: Colors.creamHigh,
    textDecorationLine: 'underline',
  },
  ctaSecondary: {
    height: 56,
    borderRadius: 8,
    backgroundColor: 'transparent',
    borderWidth: 2.5,
    borderColor: Colors.creamHigh,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  ctaSecondaryText: {
    fontFamily: Fonts.sansBold,
    fontSize: 17,
    color: Colors.creamHigh,
    letterSpacing: 0.2,
  },
});
