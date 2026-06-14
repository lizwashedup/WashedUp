import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Image,
  ImageBackground,
  ScrollView,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { router } from 'expo-router';
import Colors from '../../constants/Colors';
import { Fonts } from '../../constants/Typography';
import { supabase } from '../../lib/supabase';
import { hapticLight, hapticError } from '../../lib/haptics';
import { formatToE164, isValidUSPhone } from '../../lib/phoneFormat';
import { WELCOME_HERO_URI } from '../../lib/onboardingAssets';
import PhoneInput from '../../components/auth/PhoneInput';
import { useSubmitGuard } from '../../hooks/useSubmitGuard';
import { PHONE_CANONICAL_ENABLED } from '../../constants/FeatureFlags';
import { reconcileAccountByPhone } from '../../lib/reconcileAccount';
import { unauthedRoute } from '../../lib/authRouting';
import { lastUnauthRedirectAt } from '../../lib/navState';

export default function MigrationGateScreen() {
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = isValidUSPhone(phone) && !submitting;
  const submit = useSubmitGuard();

  const handleVerify = async () => {
    if (!canSubmit) return;
    if (!submit.tryAcquire()) return;
    setError(null);
    setSubmitting(true);
    try {
      const e164 = formatToE164(phone);

      // Phone-canonical reconciliation: if this phone already belongs to a
      // DIFFERENT account (the user's real one, e.g. they signed up with phone
      // on web, then tapped Sign in with Apple here), don't dead-end with
      // "linked to another account." Sign them into that account instead. The
      // phone is unique, so a fresh sign-in OTP resolves to the canonical
      // account; the empty Apple shell is swept out-of-band, we never delete
      // inside the session swap. Flag-gated until the swap is device-tested.
      if (PHONE_CANONICAL_ENABLED) {
        const decision = await reconcileAccountByPhone(e164);
        if (decision.isDup) {
          // H-1: sign the empty Apple shell OUT before swapping to the canonical
          // account, so a failed OTP send/verify can never strand the user in a
          // half-signed-in limbo. We stamp lastUnauthRedirectAt first so the root
          // SIGNED_OUT listener does not auto-bounce us to the unauthed landing;
          // navigation here is deterministic and owned by this flow.
          lastUnauthRedirectAt.ts = Date.now();
          await supabase.auth.signOut();
          const { error: otpError } = await supabase.auth.signInWithOtp({ phone: e164 });
          if (otpError) {
            // Shell is already signed out -> a clean signed-out state, no limbo.
            // Land on the unauthed entry (not this authed-only gate) and surface
            // the error there rather than stranding the user here.
            hapticError();
            router.replace(unauthedRoute() as never);
            return;
          }
          hapticLight();
          // replace (not push): the shell session is gone, so there is no valid
          // gate to return to; verify-code (reconcile) signs into the canonical
          // account via the sms OTP.
          router.replace({
            pathname: '/verify-code',
            params: { phone, mode: 'reconcile' },
          });
          return;
        }
        // Not a dup (or shell has content) -> fall through to the normal
        // phone-attach flow below.
      }

      // updateUser sends an OTP to the new phone for verification of the
      // already-authenticated user's phone change. Confirmed on the
      // verify-code screen with verifyOtp({ type: 'phone_change' }).
      const { error: updateError } = await supabase.auth.updateUser({
        phone: e164,
      });
      if (updateError) throw updateError;
      hapticLight();
      router.push({
        pathname: '/verify-code',
        params: { phone, mode: 'migration' },
      });
    } catch (e: unknown) {
      hapticError();
      const status = (e as { status?: number } | null)?.status;
      const message = (e as { message?: string } | null)?.message ?? '';
      if (status === 429 || /rate.?limit/i.test(message)) {
        setError('too many attempts. try again in a few minutes.');
      } else if (/already.*registered|already.*in use|taken/i.test(message)) {
        setError('that number is linked to another account.');
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
      blurRadius={14}
      resizeMode="cover"
    >
      {/* Cream overlay at ~85% so the blurred sunset bleeds through at ~15%,
          matching login + phone-entry. */}
      <View style={styles.bgOverlay} pointerEvents="none" />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <StatusBar style="dark" />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.kav}
        >
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.brandRow}>
            <Image
              source={require('../../assets/images/w-logo-waves.png')}
              style={styles.wMark}
              resizeMode="contain"
            />
          </View>

          <View style={styles.callout}>
            <Text style={styles.calloutTag}>heads up</Text>
            <Text style={styles.calloutBody}>
              we’re moving to phone numbers for everyone. takes 30 seconds.
            </Text>
          </View>

          <Text style={styles.headline}>
            <Text style={styles.headlineSans}>add your </Text>
            <Text style={styles.headlineItalic}>number</Text>
          </Text>
          <Text style={styles.subline}>
            keeps your account safe + helps people find you on washedup.
          </Text>

          <View style={styles.timeline}>
            <View style={styles.timelineRow}>
              <View style={styles.timelineColLeft}>
                <View style={styles.dotActiveHalo}>
                  <View style={styles.dotActive} />
                </View>
                <View style={styles.timelineLine} />
              </View>
              <View style={styles.timelineColRight}>
                <Text style={styles.timelineLabel}>now</Text>
                <Text style={styles.timelineBody}>
                  add your number, takes 30 seconds.
                </Text>
              </View>
            </View>

            <View style={styles.timelineRow}>
              <View style={styles.timelineColLeft}>
                <View style={styles.dotFuture} />
              </View>
              <View style={styles.timelineColRight}>
                <Text style={[styles.timelineLabel, styles.timelineLabelMuted]}>
                  starting june 1
                </Text>
                <Text style={[styles.timelineBody, styles.timelineBodyMuted]}>
                  you’ll sign in with your phone instead of a password.
                </Text>
              </View>
            </View>
          </View>

          <PhoneInput
            value={phone}
            onChangeText={(d) => {
              setError(null);
              setPhone(d);
            }}
            onSubmitEditing={handleVerify}
            error={error ?? undefined}
            editable={!submitting}
          />

          <TouchableOpacity
            style={[styles.cta, !canSubmit && styles.ctaDisabled]}
            onPress={handleVerify}
            activeOpacity={0.9}
            disabled={!canSubmit}
          >
            <Text style={[styles.ctaText, !canSubmit && styles.ctaTextDisabled]}>
              verify my number
            </Text>
          </TouchableOpacity>

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  bg: { flex: 1, backgroundColor: Colors.parchment },
  bgOverlay: {
    ...StyleSheet.absoluteFillObject,
    // Match login.tsx — cream at 75% lets the blurred sunset bleed at ~25%.
    backgroundColor: 'rgba(248, 245, 240, 0.75)',
  },
  safe: { flex: 1, backgroundColor: 'transparent' },
  kav: { flex: 1 },
  // react-native-web only makes a ScrollView scrollable when the scroll
  // viewport itself is bounded (flex:1); without this the tall content
  // overflows and the "i'll do this later" button below the fold is
  // unreachable on short mobile-web viewports. No-op on native.
  scrollView: { flex: 1 },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 28,
    paddingTop: 8,
    paddingBottom: 32,
    gap: 22,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  wMark: { width: 28, height: 28, tintColor: Colors.brandPressed },

  callout: {
    backgroundColor: Colors.brandSoft,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 4,
  },
  calloutTag: {
    fontFamily: Fonts.sansSemibold,
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: Colors.brandDeep,
  },
  calloutBody: {
    fontFamily: Fonts.sans,
    fontSize: 14,
    lineHeight: 20,
    color: Colors.text1,
  },

  headline: {
    fontSize: 32,
    lineHeight: 36,
    color: Colors.text1,
    marginTop: 4,
  },
  headlineSans: {
    fontFamily: Fonts.headline,
  },
  headlineItalic: {
    fontFamily: Fonts.displayItalic,
    fontStyle: 'italic',
    color: Colors.brand,
    textDecorationLine: 'underline',
    textDecorationColor: Colors.brand,
  },
  subline: {
    fontFamily: Fonts.sans,
    fontSize: 15,
    lineHeight: 22,
    color: Colors.text2,
  },

  timeline: {
    paddingTop: 4,
    paddingBottom: 4,
  },
  timelineRow: {
    flexDirection: 'row',
    minHeight: 60,
  },
  timelineColLeft: {
    width: 28,
    alignItems: 'center',
    paddingTop: 4,
  },
  timelineColRight: {
    flex: 1,
    paddingLeft: 12,
    paddingBottom: 12,
  },
  dotActiveHalo: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: Colors.cream,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotActive: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: Colors.brand,
  },
  dotFuture: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: Colors.brandSoft,
    borderWidth: 2,
    borderColor: Colors.brandBorderSoft,
    marginTop: 1,
  },
  timelineLine: {
    width: 2,
    flex: 1,
    backgroundColor: Colors.brandSoft,
    marginTop: 4,
  },
  timelineLabel: {
    fontFamily: Fonts.sansSemibold,
    fontSize: 13,
    color: Colors.text1,
    marginBottom: 4,
  },
  timelineLabelMuted: {
    color: Colors.text2,
  },
  timelineBody: {
    fontFamily: Fonts.sans,
    fontSize: 14,
    lineHeight: 20,
    color: Colors.text1,
  },
  timelineBodyMuted: {
    color: Colors.text2,
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
    opacity: 0.45,
    shadowOpacity: 0,
    elevation: 0,
  },
  ctaText: {
    fontFamily: Fonts.sansBold,
    fontSize: 16,
    color: Colors.surface,
    letterSpacing: 0.2,
  },
  ctaTextDisabled: { color: Colors.surface },
});
