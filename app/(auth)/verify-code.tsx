import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Animated,
  Easing,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import Colors from '../../constants/Colors';
import { Fonts } from '../../constants/Typography';
import { supabase } from '../../lib/supabase';
import { hapticLight, hapticSuccess, hapticError } from '../../lib/haptics';
import { formatDisplay, formatToE164, isValidUSPhone } from '../../lib/phoneFormat';
import { onboardingDest } from '../../lib/authRouting';
import OtpInput, { type OtpInputHandle } from '../../components/auth/OtpInput';

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

  const [code, setCode] = useState('');
  const [otpState, setOtpState] = useState<OtpState>('idle');
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_S);
  const [microError, setMicroError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  const otpRef = useRef<OtpInputHandle>(null);
  const successAnim = useRef(new Animated.Value(0)).current;
  // Track the post-verify hold timer so we can cancel on unmount and avoid
  // setState-on-unmounted warnings if the user backs out mid-animation.
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Bail out if we landed here with no phone (e.g. someone deep-linked
  // /verify-code directly). Without a phone, verifyOtp would always fail
  // and the user would see the wrong "wrong code" error.
  useEffect(() => {
    if (!isValidUSPhone(phone)) {
      router.replace('/phone-entry');
    }
  }, [phone]);

  // Clear any pending hold timer when the screen unmounts.
  useEffect(() => {
    return () => {
      if (holdTimerRef.current) {
        clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }
    };
  }, []);

  // Cooldown ticker
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => {
      setCooldown((c) => (c <= 1 ? 0 : c - 1));
    }, 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  const handleVerify = useCallback(
    async (token: string) => {
      if (verifying || token.length !== CODE_LEN) return;
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
        hapticSuccess();
        setOtpState('success');
        Animated.timing(successAnim, {
          toValue: 1,
          duration: 320,
          easing: Easing.bezier(0.22, 1, 0.36, 1),
          useNativeDriver: false,
        }).start();

        // Mirror the verified phone onto profiles.phone_number. Supabase
        // sets auth.users.phone automatically, but the profiles table is
        // a separate row and isn't auto-synced. Without this write, a
        // phone-auth user would have profiles.phone_number=null forever,
        // which (a) bounces them back to /migration-gate on the next
        // cold start, and (b) inflates their bot-detection score. Best-
        // effort — swallow the error and keep navigating.
        const e164 = formatToE164(phone);
        const { data: { user: verifiedUser } } = await supabase.auth.getUser();
        if (verifiedUser) {
          supabase
            .from('profiles')
            .update({ phone_number: e164 })
            .eq('id', verifiedUser.id)
            .then(({ error: syncError }) => {
              if (syncError) {
                console.warn('[phone-auth] profiles.phone_number sync failed:', syncError.message);
              }
            });
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
        setVerifying(false);
      }
    },
    [phone, mode, verifying, successAnim],
  );

  const handleResend = useCallback(async () => {
    if (cooldown > 0 || verifying) return;
    setMicroError(null);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        phone: formatToE164(phone),
      });
      if (error) throw error;
      hapticLight();
      setCooldown(RESEND_COOLDOWN_S);
    } catch {
      setMicroError('couldn’t resend. try again in a sec.');
    }
  }, [phone, cooldown, verifying]);

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
    outputRange: [Colors.text2, 'rgba(255,255,255,0.86)'],
  });

  return (
    <Animated.View style={[styles.root, { backgroundColor: bgColor }]}>
      <StatusBar style={otpState === 'success' ? 'light' : 'dark'} />

      {/* Success-state decorations: warm radial-ish glow + W watermark */}
      {otpState === 'success' && (
        <>
          <LinearGradient
            colors={['rgba(255,220,180,0.22)', 'transparent']}
            locations={[0, 0.55]}
            style={[StyleSheet.absoluteFill, { height: '60%' }]}
            pointerEvents="none"
          />
          <View style={styles.watermarkWrap} pointerEvents="none">
            <Image
              source={require('../../assets/images/w-logo.png')}
              style={styles.watermark}
              resizeMode="contain"
            />
          </View>
        </>
      )}

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
            <Image
              source={require('../../assets/images/logo-wordmark.png')}
              style={[
                styles.wordmark,
                otpState === 'success' && styles.wordmarkOnSuccess,
              ]}
              resizeMode="contain"
            />
            <View style={styles.backHit} />
          </View>

          <View style={styles.centerCol}>
            <Animated.Text style={[styles.hero, { color: titleColor }]}>
              <Text style={styles.heroRegular}>let’s </Text>
              <Text style={styles.heroItalic}>go</Text>
            </Animated.Text>
            <Animated.Text style={[styles.subline, { color: sublineColor }]}>
              code sent to {formatDisplay(phone)}
            </Animated.Text>

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
                onChangeText={(c) => {
                  if (otpState !== 'idle') return;
                  setCode(c);
                  setMicroError(null);
                }}
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
  wordmark: { width: 92, height: 22, tintColor: Colors.text1, opacity: 0.92 },
  wordmarkOnSuccess: { tintColor: Colors.surface, opacity: 0.96 },
  watermarkWrap: {
    position: 'absolute',
    right: -100,
    top: 80,
    width: 460,
    height: 460,
  },
  watermark: {
    width: '100%',
    height: '100%',
    tintColor: Colors.cream,
    opacity: 0.18,
  },
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
    backgroundColor: 'rgba(197,165,90,0.18)',
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
