import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Easing,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import Colors from '../../constants/Colors';
import { Fonts } from '../../constants/Typography';
import { supabase } from '../../lib/supabase';
import { hapticLight, hapticSuccess, hapticError } from '../../lib/haptics';
import { formatDisplay, formatToE164, isValidUSPhone } from '../../lib/phoneFormat';
import { onboardingDest } from '../../lib/authRouting';
import { verifyCodeSelfRoutingRef, postAuthTransitionRef, wasOtpRecentlySent, markOtpSent } from '../../lib/navState';
import { AUTH_PROFILE_KEY, type AuthProfile, invalidateAuthProfile } from '../../hooks/useProfile';
import OtpInput, { type OtpInputHandle } from '../../components/auth/OtpInput';
import { BrandedAlert } from '../../components/BrandedAlert';

const RESEND_COOLDOWN_S = 30;
const SUCCESS_HOLD_MS = 600;
const ERROR_HOLD_MS = 600;
const CODE_LEN = 6;

type Mode = 'signup' | 'migration';
type OtpState = 'idle' | 'success' | 'error';

export default function VerifyCodeScreen() {
  const params = useLocalSearchParams<{ phone?: string; mode?: string }>();
  const phone = (params.phone ?? '').replace(/\D/g, '').slice(0, 10);
  const mode: Mode = params.mode === 'migration' ? 'migration' : 'signup';
  const queryClient = useQueryClient();

  const [code, setCode] = useState('');
  const [otpState, setOtpState] = useState<OtpState>('idle');
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_S);
  const [microError, setMicroError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [syncFailedAlert, setSyncFailedAlert] = useState(false);

  const otpRef = useRef<OtpInputHandle>(null);
  const successAnim = useRef(new Animated.Value(0)).current;
  // Track the post-verify hold timer so we can cancel on unmount and avoid
  // setState-on-unmounted warnings if the user backs out mid-animation.
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirror state into refs so handleVerify/handleResend/handleCodeChange
  // can read latest values without listing state in their useCallback
  // deps. Avoids ~30 callback regenerations per resend cycle from the
  // cooldown ticker, and keeps OtpInput's prop identity stable.
  const verifyingRef = useRef(false);
  const cooldownRef = useRef(RESEND_COOLDOWN_S);
  const otpStateRef = useRef<OtpState>('idle');

  // Bail out if we landed here with no phone (e.g. someone deep-linked
  // /verify-code directly). Without a phone, verifyOtp would always fail
  // and the user would see the wrong "wrong code" error.
  useEffect(() => {
    if (!isValidUSPhone(phone)) {
      router.replace('/phone-entry');
    }
  }, [phone]);

  // Clear any pending hold timer when the screen unmounts. Also clear
  // the self-routing flag so a back-out mid-animation can't leave the
  // root auth listener permanently muted.
  useEffect(() => {
    return () => {
      if (holdTimerRef.current) {
        clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }
      verifyCodeSelfRoutingRef.current = false;
    };
  }, []);

  // Keep otpStateRef in sync so handleCodeChange can read it without
  // re-rendering OtpInput each time the state changes.
  useEffect(() => { otpStateRef.current = otpState; }, [otpState]);

  // Cooldown ticker
  useEffect(() => {
    cooldownRef.current = cooldown;
    if (cooldown <= 0) return;
    const t = setInterval(() => {
      setCooldown((c) => (c <= 1 ? 0 : c - 1));
    }, 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  const handleVerify = useCallback(
    async (token: string) => {
      if (verifyingRef.current || token.length !== CODE_LEN) return;
      verifyingRef.current = true;
      setVerifying(true);
      setMicroError(null);
      try {
        // 'sms' verifies a fresh signInWithOtp; 'phone_change' verifies an
        // updateUser({ phone }) call from the migration gate (existing user
        // adding a phone to their already-authenticated account).
        const verifyType = mode === 'migration' ? 'phone_change' : 'sms';
        const { error } = await supabase.auth.verifyOtp({
          phone: formatToE164(phone),
          token,
          type: verifyType,
        });
        if (error) throw error;
        // Tell the root auth listener to skip its SIGNED_IN auto-route —
        // we own routing for the next ~600ms while the success animation
        // plays. Cleared in finally.
        verifyCodeSelfRoutingRef.current = true;
        // Plans tab consumes this on mount to show WelcomeLoading over
        // the skeleton instead of a hard blink.
        postAuthTransitionRef.active = true;
        hapticSuccess();
        setOtpState('success');
        Animated.timing(successAnim, {
          toValue: 1,
          duration: 320,
          easing: Easing.bezier(0.22, 1, 0.36, 1),
          useNativeDriver: false,
        }).start();

        const e164 = formatToE164(phone);
        const { data: { user: verifiedUser } } = await supabase.auth.getUser();
        if (verifiedUser) {
          // Update the cached profile synchronously so the tabs guard reads
          // the new phone on the next mount instead of the stale cached null.
          // Without this, getAuthProfile returns the 60s-stale cache and
          // bounces the user to /migration-gate in an infinite loop.
          queryClient.setQueryData<AuthProfile | undefined>(
            AUTH_PROFILE_KEY(verifiedUser.id),
            (prev) => (prev ? { ...prev, phone_number: e164 } : prev),
          );
          // Migration mode only: phone_change verifyOtp updates auth.users.phone
          // but doesn't fire the handle_new_user trigger (that's INSERT-only),
          // so we manually sync to profiles. New signups are covered by the
          // trigger writing NULLIF(NEW.phone, '') on auth.users INSERT.
          //
          // We fire-and-forget the request to avoid blocking the 600ms success
          // animation, but on error we (a) cancel the pending navigation so the
          // alert is readable, (b) invalidate the optimistic cache so the next
          // read fetches truth from DB, and (c) surface the failure to the user
          // so they can retry instead of silently landing on tabs with a phone
          // that didn't actually save.
          if (mode === 'migration') {
            supabase
              .from('profiles')
              .update({ phone_number: e164 })
              .eq('id', verifiedUser.id)
              .then(({ error: syncError }) => {
                if (!syncError) return;
                console.warn('[phone-auth] profiles.phone_number sync failed:', syncError.message);
                if (holdTimerRef.current) {
                  clearTimeout(holdTimerRef.current);
                  holdTimerRef.current = null;
                }
                invalidateAuthProfile(queryClient, verifiedUser.id);
                setSyncFailedAlert(true);
              });
          }
        }

        // Decide destination after a brief celebratory hold.
        holdTimerRef.current = setTimeout(async () => {
          holdTimerRef.current = null;
          if (mode === 'migration') {
            router.replace('/(tabs)/plans');
            return;
          }
          if (!verifiedUser) {
            router.replace('/onboarding/basics');
            return;
          }
          const { data: profile } = await supabase
            .from('profiles')
            .select('onboarding_status, referral_source')
            .eq('id', verifiedUser.id)
            .maybeSingle();
          const next = onboardingDest(
            profile?.onboarding_status,
            profile?.referral_source,
          );
          router.replace(next as never);
        }, SUCCESS_HOLD_MS);
      } catch (e: unknown) {
        hapticError();
        setOtpState('error');
        const message = (e as { message?: string } | null)?.message ?? '';
        if (/expire/i.test(message)) {
          setMicroError('that code expired. tap resend.');
        } else {
          setMicroError('wrong code. try again.');
        }
        holdTimerRef.current = setTimeout(() => {
          holdTimerRef.current = null;
          setCode('');
          setOtpState('idle');
          setMicroError(null);
          otpRef.current?.focus();
        }, ERROR_HOLD_MS);
      } finally {
        verifyingRef.current = false;
        setVerifying(false);
      }
    },
    [phone, mode, successAnim],
  );

  // Hoisted so OtpInput's prop identity is stable across parent re-renders.
  const handleCodeChange = useCallback((c: string) => {
    if (otpStateRef.current !== 'idle') return;
    setCode(c);
    setMicroError(null);
  }, []);

  const handleResend = useCallback(async () => {
    if (cooldownRef.current > 0 || verifyingRef.current) return;
    setMicroError(null);
    const e164 = formatToE164(phone);
    // If a code was just sent to this number (e.g., the user came in from
    // phone-entry seconds ago), the prior OTP is still valid. Skip the API,
    // give the same haptic + cooldown reset so the tap registers, and let
    // the user verify the existing code.
    if (wasOtpRecentlySent(e164)) {
      hapticLight();
      setCooldown(RESEND_COOLDOWN_S);
      return;
    }
    try {
      // Migration mode's original OTP was sent via auth.updateUser (a
      // phone_change flow on an already-authenticated user). Resending
      // with signInWithOtp would create a separate signup OTP that
      // conflicts with the pending phone_change verification. Mirror
      // the original send call instead.
      const { error } = mode === 'migration'
        ? await supabase.auth.updateUser({ phone: e164 })
        : await supabase.auth.signInWithOtp({ phone: e164 });
      if (error) throw error;
      markOtpSent(e164);
      hapticLight();
      setCooldown(RESEND_COOLDOWN_S);
    } catch (e: unknown) {
      hapticError();
      const status = (e as { status?: number } | null)?.status;
      const message = (e as { message?: string } | null)?.message ?? '';
      if (status === 429 || /rate.?limit|too many/i.test(message)) {
        setMicroError('too many attempts. try again in a few minutes.');
      } else {
        setMicroError('couldn’t resend. try again in a sec.');
      }
    }
  }, [phone, mode]);

  const handleBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/phone-entry');
  };

  const cooldownLabel = `0:${String(cooldown).padStart(2, '0')}`;

  // Cream → terracotta background interpolation for success state
  const bgColor = successAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [Colors.cream, Colors.brand],
  });
  const titleColor = successAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [Colors.text1, Colors.surface],
  });
  const sublineColor = successAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [Colors.text2, Colors.whiteSoft],
  });

  return (
    <Animated.View style={[styles.root, { backgroundColor: bgColor }]}>
      <StatusBar style={otpState === 'success' ? 'light' : 'dark'} />

      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.kav}
        >
          <View style={styles.topRow}>
            <TouchableOpacity
              onPress={handleBack}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              style={styles.backHit}
              disabled={otpState === 'success'}
            >
              <Ionicons
                name="chevron-back"
                size={24}
                color={otpState === 'success' ? Colors.surface : Colors.text1}
              />
            </TouchableOpacity>
          </View>

          <View style={styles.centerCol}>
            <Animated.Text style={[styles.hero, { color: titleColor }]}>
              <Text style={styles.heroRegular}>let’s </Text>
              <Text style={styles.heroItalic}>go</Text>
            </Animated.Text>
            <Animated.Text style={[styles.subline, { color: sublineColor }]}>
              code sent to {formatDisplay(phone)}
            </Animated.Text>
            <TouchableOpacity
              onPress={handleBack}
              hitSlop={6}
              disabled={otpState === 'success'}
            >
              <Text style={styles.wrongNumber}>wrong number?</Text>
            </TouchableOpacity>

            <View style={styles.gap28} />

            <View
              style={
                otpState === 'success' ? styles.cellsCard : styles.cellsBare
              }
            >
              <OtpInput
                ref={otpRef}
                length={CODE_LEN}
                value={code}
                onChangeText={handleCodeChange}
                onComplete={handleVerify}
                state={otpState}
                autoFocus
                editable={otpState === 'idle' && !verifying}
              />
            </View>

            <View style={styles.microRow}>
              {otpState === 'success' ? (
                <View style={styles.successBadgeRow}>
                  <View style={styles.checkCircle}>
                    <Ionicons name="checkmark" size={18} color={Colors.gold} />
                  </View>
                  <Text style={styles.successBadgeText}>you’re in.</Text>
                </View>
              ) : microError ? (
                <Text style={styles.errorMicro}>{microError}</Text>
              ) : cooldown > 0 ? (
                <Text style={styles.cooldownMicro}>resend in {cooldownLabel}</Text>
              ) : (
                <TouchableOpacity onPress={handleResend} hitSlop={6}>
                  <Text style={styles.resendMicro}>
                    didn’t get it?{' '}
                    <Text style={styles.resendLink}>resend</Text>
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          <View style={styles.bottomSpacer} />
        </KeyboardAvoidingView>
      </SafeAreaView>
      <BrandedAlert
        visible={syncFailedAlert}
        title="couldn't save your number"
        message="we'll ask again next time you open the app."
        onClose={() => {
          setSyncFailedAlert(false);
          // User did verify the OTP — auth.users.phone is set correctly. Only
          // the profiles sync failed. Land them in the app; on the next cold
          // start checkAuth will read the DB truth (phone_number=null) and
          // route them back through migration-gate to retry.
          router.replace('/(tabs)/plans');
        }}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.cream },
  safe: { flex: 1 },
  kav: { flex: 1, paddingHorizontal: 28 },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 4,
  },
  backHit: { width: 32, height: 32, justifyContent: 'center' },
  centerCol: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 0,
  },
  hero: {
    fontSize: 56,
    lineHeight: 56,
    letterSpacing: -0.84,
    textAlign: 'center',
    color: Colors.text1,
  },
  heroRegular: {
    fontFamily: Fonts.displayBold,
  },
  heroItalic: {
    fontFamily: Fonts.displayItalic,
    fontStyle: 'italic',
  },
  subline: {
    fontFamily: Fonts.sans,
    fontSize: 14,
    lineHeight: 20,
    color: Colors.text2,
    marginTop: 12,
    textAlign: 'center',
  },
  wrongNumber: {
    fontFamily: Fonts.sansMedium,
    fontSize: 13,
    color: Colors.brand,
    marginTop: 6,
  },
  gap28: { height: 28 },
  cellsBare: {
    paddingVertical: 4,
  },
  cellsCard: {
    backgroundColor: Colors.cream,
    borderRadius: 16,
    paddingVertical: 18,
    paddingHorizontal: 18,
    shadowColor: Colors.brandDeep,
    shadowOffset: { width: 0, height: 24 },
    shadowOpacity: 0.28,
    shadowRadius: 48,
    elevation: 12,
  },
  microRow: {
    marginTop: 16,
    minHeight: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cooldownMicro: {
    fontFamily: Fonts.sans,
    fontSize: 13,
    color: Colors.text3,
  },
  resendMicro: {
    fontFamily: Fonts.sans,
    fontSize: 13,
    color: Colors.text2,
  },
  resendLink: {
    fontFamily: Fonts.sansSemibold,
    color: Colors.brand,
    textDecorationLine: 'underline',
  },
  errorMicro: {
    fontFamily: Fonts.sansSemibold,
    fontSize: 13,
    color: Colors.errorBrand,
  },
  successBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  checkCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.goldBadgeSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  successBadgeText: {
    fontFamily: Fonts.sansSemibold,
    fontSize: 14,
    color: Colors.gold,
  },
  bottomSpacer: { height: 32 },
});
