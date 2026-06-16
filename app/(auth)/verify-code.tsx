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
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import Colors from '../../constants/Colors';
import { Fonts } from '../../constants/Typography';
import { supabase } from '../../lib/supabase';
import { withTimeout } from '../../lib/withTimeout';
import { hapticLight, hapticSuccess, hapticError } from '../../lib/haptics';
import { formatDisplay, formatToE164, isValidUSPhone } from '../../lib/phoneFormat';
import { authedDest } from '../../lib/authRouting';
import { verifyCodeSelfRoutingRef, postAuthTransitionRef, wasOtpRecentlySent, markOtpSent } from '../../lib/navState';
import { AUTH_PROFILE_KEY, type AuthProfile, invalidateAuthProfile } from '../../hooks/useProfile';
import OtpInput, { type OtpInputHandle } from '../../components/auth/OtpInput';
import { BrandedAlert } from '../../components/BrandedAlert';

const RESEND_COOLDOWN_S = 30;
const SUCCESS_HOLD_MS = 600;
const ERROR_HOLD_MS = 600;
const CODE_LEN = 6;

// 'reconcile' = a phone-canonical sign-in: an Apple shell whose entered phone
// already belongs to their real account, so we sign them INTO that account.
// It uses the same sms / signInWithOtp path as 'signup' (non-migration), and
// skips the migration-only phone_change assertions, handled by the existing
// `mode === 'migration' ? ... : ...` branches throughout this screen.
type Mode = 'signup' | 'migration' | 'reconcile';
type OtpState = 'idle' | 'success' | 'error';

export default function VerifyCodeScreen() {
  const params = useLocalSearchParams<{ phone?: string; mode?: string }>();
  const phone = (params.phone ?? '').replace(/\D/g, '').slice(0, 10);
  const mode: Mode =
    params.mode === 'migration'
      ? 'migration'
      : params.mode === 'reconcile'
        ? 'reconcile'
        : 'signup';
  const queryClient = useQueryClient();

  const [code, setCode] = useState('');
  const [otpState, setOtpState] = useState<OtpState>('idle');
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_S);
  const [microError, setMicroError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [syncFailedAlert, setSyncFailedAlert] = useState(false);

  const otpRef = useRef<OtpInputHandle>(null);
  const scrollRef = useRef<ScrollView>(null);
  const successAnim = useRef(new Animated.Value(0)).current;

  const scrollToBottomOnFocus = useCallback(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 250);
  }, []);
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
  const isMountedRef = useRef(true);

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
      isMountedRef.current = false;
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

  // Mode-aware OTP send. Migration mode's original OTP was sent via
  // auth.updateUser (a phone_change flow on an already-authenticated user).
  // Resending with signInWithOtp would create a separate signup OTP that
  // conflicts with the pending phone_change verification. Mirror the original
  // send call instead.
  const sendOtpForCurrentMode = useCallback(
    async (e164: string): Promise<{ ok: boolean; rateLimited: boolean }> => {
      const { error } = mode === 'migration'
        ? await supabase.auth.updateUser({ phone: e164 })
        : await supabase.auth.signInWithOtp({ phone: e164 });
      if (!error) return { ok: true, rateLimited: false };
      const status = (error as { status?: number }).status;
      const message = error.message ?? '';
      const rateLimited = status === 429 || /rate.?limit|too many/i.test(message);
      return { ok: false, rateLimited };
    },
    [mode],
  );

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

        const e164 = formatToE164(phone);
        const { data: { user: verifiedUser } } = await supabase.auth.getUser();

        // Post-commit assertion (migration only): verifyOtp can return
        // success while Supabase fails to actually attach the phone to
        // auth.users / auth.identities. If we then write profiles.phone_number
        // anyway, the two stores drift — the next signInWithOtp won't match
        // the user and creates an orphan account that steals the phone. Catch
        // the half-commit here before doing anything else.
        if (mode === 'migration') {
          const expectedDigits = e164.replace(/\D/g, '');
          const actualDigits = (verifiedUser?.phone ?? '').replace(/\D/g, '');
          if (!verifiedUser || actualDigits !== expectedDigits) {
            throw new Error('PHONE_NOT_COMMITTED');
          }
        }

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
                invalidateAuthProfile(queryClient, verifiedUser.id);
                if (!isMountedRef.current) return;
                if (holdTimerRef.current) {
                  clearTimeout(holdTimerRef.current);
                  holdTimerRef.current = null;
                }
                setSyncFailedAlert(true);
              });
          }
        }

        // Decide destination after a brief celebratory hold, single-sourced
        // through authedDest (the same decision cold-start + the listener use).
        // The user just verified a phone (migration) or logged in with one
        // (sms), so they have a confirmed phone: needs_phone_migration is
        // definitively false, and a 'complete' user lands on /(tabs)/plans while
        // an onboarding-incomplete user resumes at the correct step.
        holdTimerRef.current = setTimeout(async () => {
          holdTimerRef.current = null;
          if (!verifiedUser) {
            router.replace('/onboarding/basics');
            return;
          }
          // Bounded so a stalled read can't strand the user on the success
          // screen: on timeout, profile is null and authedDest falls back to
          // the onboarding resume path, so navigation always happens.
          const { data: profile } = await withTimeout(
            supabase
              .from('profiles')
              .select('onboarding_status, referral_source')
              .eq('id', verifiedUser.id)
              .maybeSingle(),
            4000,
            { data: null } as any,
          );
          const next = authedDest({
            onboarding_status: profile?.onboarding_status,
            referral_source: profile?.referral_source,
            needs_phone_migration: false,
          });
          router.replace(next as never);
        }, SUCCESS_HOLD_MS);
      } catch (e: unknown) {
        hapticError();
        setOtpState('error');
        const status = (e as { status?: number } | null)?.status;
        const message = (e as { message?: string } | null)?.message ?? '';
        const isRateLimit = status === 429 || /rate.?limit|too many/i.test(message);

        if (isRateLimit) {
          setMicroError('too many attempts. try again in a few minutes.');
        } else if (message === 'PHONE_NOT_COMMITTED') {
          // verifyOtp returned success but auth.users.phone didn't actually
          // get set. Tell the user to retry from the migration gate so a
          // fresh updateUser→verifyOtp pair runs. Don't write to profiles.
          setMicroError("couldn't save your number. tap 'wrong number?' to try again.");
        } else {
          // Supabase returns the same "Token has expired or is invalid"
          // message for both wrong codes and truly expired ones — we can't
          // tell them apart from the message. Default to "try again" which
          // is right for the common case (typo). If the code is truly dead,
          // the next attempt will fail the same way and the user can tap
          // the Resend button below to get a fresh SMS.
          setMicroError('wrong code. try again.');
        }

        // Hold the error state briefly, then clear the input + refocus.
        // Focus must be deferred to the next frame so React commits the
        // setOtpState('idle') first — otherwise the input is still
        // editable=false when focus() fires and iOS rejects it (no keyboard).
        holdTimerRef.current = setTimeout(() => {
          holdTimerRef.current = null;
          setCode('');
          setOtpState('idle');
          setMicroError(null);
          requestAnimationFrame(() => otpRef.current?.focus());
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
    // Defensive: if the input lost focus during a re-render, grab focus
    // back so subsequent keystrokes land in the input.
    otpRef.current?.focus();
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
    const result = await sendOtpForCurrentMode(e164);
    if (result.ok) {
      markOtpSent(e164);
      hapticLight();
      setCooldown(RESEND_COOLDOWN_S);
      return;
    }
    hapticError();
    if (result.rateLimited) {
      setMicroError('too many attempts. try again in a few minutes.');
    } else {
      setMicroError('couldn’t send a new code. try again in a sec.');
    }
  }, [phone, sendOtpForCurrentMode]);

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
          // Android: edgeToEdgeEnabled makes windowSoftInputMode=adjustResize
          // ineffective, so a bare KAV (behavior=undefined) left the OTP cells
          // under the keyboard (worse here: OtpInput autoFocuses on mount).
          // 'height' shrinks the KAV by the IME height so the cells stay visible.
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.kav}
        >
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}
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
                onFocus={scrollToBottomOnFocus}
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
          </ScrollView>
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
  scrollContent: { flexGrow: 1 },
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
    paddingVertical: 14,
    paddingHorizontal: 10,
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
