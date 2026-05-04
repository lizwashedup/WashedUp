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
import PhoneInput from '../../components/auth/PhoneInput';

const HERO_PHOTO_URI =
  'https://images.unsplash.com/photo-1529333166437-7750a6dd5a70?w=900&q=80';

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
      // Sign out any active session BEFORE initiating a new OTP. Otherwise
      // signInWithOtp creates a fresh auth.users row for the new phone but
      // leaves the client's session pointing at the old user — onboarding
      // writes then silently land on the old account and the new one becomes
      // an orphan with no profile data. (Discovered while testing 2026-05-03.)
      const { data: { session: existingSession } } = await supabase.auth.getSession();
      if (existingSession) {
        await supabase.auth.signOut().catch(() => {
          // Don't block the user if signOut fails — the next signInWithOtp
          // will replace the session anyway. Worst case is a stale ghost
          // session that gets overwritten on verifyOtp success.
        });
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
      console.log('[phone-entry] signInWithOtp error:', e);
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
      source={{ uri: HERO_PHOTO_URI }}
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
              autoFocus
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
                entering their phone above. */}
            <TouchableOpacity
              onPress={() => router.push('/login')}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={styles.existingHit}
            >
              <Text style={styles.existingText}>
                already on washedup?{' '}
                <Text style={styles.existingLink}>sign in here</Text>
              </Text>
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
  existingHit: {
    alignSelf: 'center',
    marginTop: 14,
  },
  existingText: {
    fontFamily: Fonts.sans,
    fontSize: 13,
    lineHeight: 18,
    color: Colors.creamMuted,
    textAlign: 'center',
  },
  existingLink: {
    fontFamily: Fonts.sansSemibold,
    color: Colors.creamHigh,
    textDecorationLine: 'underline',
  },
});
