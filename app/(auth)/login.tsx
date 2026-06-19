import * as AppleAuthentication from 'expo-apple-authentication';
import { hapticLight, hapticMedium, hapticHeavy, hapticSelection, hapticSuccess, hapticWarning, hapticError } from '../../lib/haptics';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { Eye, EyeOff } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    ImageBackground,
    Keyboard,
    KeyboardAvoidingView,
    Modal,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    TouchableWithoutFeedback,
    View,
} from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KEYBOARD_DONE_ACCESSORY_ID } from '../../components/keyboard/KeyboardDoneBar';
import { BrandedAlert, type BrandedAlertButton } from '../../components/BrandedAlert';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { isAppleAuthAvailable, isGoogleAuthConfigured, signInWithApple, signInWithGoogle } from '../../lib/socialAuth';
import { friendlyAppleError, friendlyGoogleError } from '../../lib/socialAuthErrors';
import { supabase } from '../../lib/supabase';
import { PHONE_AUTH_ENABLED } from '../../constants/FeatureFlags';
import { postAuthTransitionRef } from '../../lib/navState';
import { WELCOME_HERO_URI } from '../../lib/onboardingAssets';

const SOCIAL_PROOF = '1500+ people in LA already joined';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState<'apple' | 'google' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [resetModalVisible, setResetModalVisible] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [alertInfo, setAlertInfo] = useState<{ title: string; message: string; buttons?: BrandedAlertButton[] } | null>(null);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [appleAvailable, setAppleAvailable] = useState(Platform.OS === 'ios');
  const showGoogle = isGoogleAuthConfigured();
  const passwordInputRef = useRef<TextInput>(null);

  useEffect(() => {
    isAppleAuthAvailable().then(setAppleAvailable);
  }, []);

  const handleAppleSignIn = async () => {
    setError(null);
    setSocialLoading('apple');
    try {
      await signInWithApple();
      // Plans tab consumes this on mount and shows the WelcomeLoading
      // transition over the skeleton — covers the login→tabs blink.
      postAuthTransitionRef.active = true;
    } catch (e: any) {
      if (e?.code !== 'ERR_REQUEST_CANCELED') {
        setError(friendlyAppleError(e));
      }
    } finally {
      setSocialLoading(null);
    }
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    setSocialLoading('google');
    try {
      await signInWithGoogle();
      postAuthTransitionRef.active = true;
    } catch (e: any) {
      if (e?.code !== 'SIGN_IN_CANCELLED') {
        setError(friendlyGoogleError(e));
      }
    } finally {
      setSocialLoading(null);
    }
  };

  const handleLogin = async () => {
    setError(null);
    if (!email.trim() || !password) {
      setError('enter your email and password.');
      return;
    }
    setLoading(true);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) {
        setError('wrong email or password');
        return;
      }
      postAuthTransitionRef.active = true;
      // Root layout handles redirect via onAuthStateChange
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = () => {
    hapticLight();
    setResetEmail('');
    setResetError(null);
    setResetModalVisible(true);
  };

  const handleSendResetLink = async () => {
    setResetError(null);
    const emailTrimmed = resetEmail.trim();
    if (!emailTrimmed) {
      setResetError('enter your email address.');
      return;
    }
    setResetLoading(true);
    try {
      const { error: err } = await supabase.auth.resetPasswordForEmail(emailTrimmed, {
        redirectTo: 'washedupapp://auth/callback',
      });
      if (err) {
        const msg = err.message?.toLowerCase() ?? '';
        if (msg.includes('rate') || msg.includes('60 seconds')) {
          setResetError('wait a minute before requesting another reset link.');
        } else {
          setResetError('something went wrong. check your email and try again.');
        }
        return;
      }
      setResetModalVisible(false);
      setAlertInfo({ title: 'check your email', message: 'we sent you a password reset link.' });
    } finally {
      setResetLoading(false);
    }
  };

  const closeResetModal = () => {
    setResetModalVisible(false);
    setResetError(null);
  };

  const handleSignUpPress = () => {
    hapticLight();
    router.replace('/signup');
  };

  const triggerHaptic = () => hapticLight();

  return (
    <ImageBackground
      source={{ uri: WELCOME_HERO_URI }}
      style={styles.bg}
      blurRadius={6}
      resizeMode="cover"
    >
      {/* Parchment overlay so the photo bleeds through at ~15% — keeps a
          cohesive transition from the phone-entry hero without competing
          with the form fields. */}
      <View style={styles.bgOverlay} pointerEvents="none" />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <StatusBar style="dark" />
        <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.container}>
            {/* Back affordance — only when /login is reached via the
                phone-entry escape hatch. Matches the chevron pattern used
                on verify-code and onboarding so it feels native to the
                rest of the app, in-flow rather than absolute so the
                Keyboard.dismiss wrapper doesn't swallow the tap. */}
            {PHONE_AUTH_ENABLED && (
              <View style={styles.topNavRow}>
                <TouchableOpacity
                  onPress={() => {
                    hapticLight();
                    if (router.canGoBack()) router.back();
                    else router.replace('/phone-entry');
                  }}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  style={styles.backHit}
                >
                  <Ionicons name="chevron-back" size={24} color={Colors.asphalt} />
                </TouchableOpacity>
              </View>
            )}
            {/* Top section ~40% */}
            <Animated.View
              entering={FadeIn.duration(400)}
              style={styles.topSection}
            >
              <Image source={require('../../assets/images/washedup-logo.png')} style={styles.logo} contentFit="contain" />
              <Text style={styles.tagline}>find people to go with.</Text>
              <Text style={styles.socialProof}>{SOCIAL_PROOF}</Text>
            </Animated.View>

            {/* Form */}
            <Animated.View
              entering={FadeIn.duration(400).delay(100)}
              style={styles.formSection}
            >
              <Text style={styles.formTitle}>welcome back</Text>
              <View style={styles.gap20} />

              <TextInput
                style={[
                  styles.input,
                  emailFocused && styles.inputFocused,
                ]}
                placeholder="email address"
                onFocus={() => setEmailFocused(true)}
                onBlur={() => setEmailFocused(false)}
                placeholderTextColor={Colors.textMedium}
                value={email}
                onChangeText={(t) => { setEmail(t); setError(null); }}
                keyboardType="email-address"
                textContentType="emailAddress"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
                onSubmitEditing={() => passwordInputRef.current?.focus()}
                editable={!loading}
                inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
              />
              <View style={styles.gap12} />

              <View style={styles.passwordWrap}>
                <TextInput
                  ref={passwordInputRef}
                  style={[
                    styles.input,
                    passwordFocused && styles.inputFocused,
                  ]}
                  placeholder="password"
                  onFocus={() => setPasswordFocused(true)}
                  onBlur={() => setPasswordFocused(false)}
                  placeholderTextColor={Colors.textMedium}
                  value={password}
                  onChangeText={(t) => { setPassword(t); setError(null); }}
                  secureTextEntry={!passwordVisible}
                  returnKeyType="done"
                  onSubmitEditing={handleLogin}
                  editable={!loading}
                  inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
                />
                <TouchableOpacity
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  onPress={() => { setPasswordVisible((v) => !v); triggerHaptic(); }}
                  style={styles.eyeButton}
                >
                  {passwordVisible ? (
                    <EyeOff size={22} color={Colors.textLight} />
                  ) : (
                    <Eye size={22} color={Colors.textLight} />
                  )}
                </TouchableOpacity>
              </View>

              <View style={styles.gap8} />
              <TouchableOpacity
                onPress={handleForgotPassword}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={styles.forgotWrap}
              >
                <Text style={styles.forgotText}>forgot password?</Text>
              </TouchableOpacity>
              <View style={styles.gap20} />

              <TouchableOpacity
                style={[styles.primaryButton, loading && styles.primaryButtonDisabled]}
                onPress={handleLogin}
                onPressIn={triggerHaptic}
                activeOpacity={0.9}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color={Colors.white} />
                ) : (
                  <Text style={styles.primaryButtonText}>log in</Text>
                )}
              </TouchableOpacity>

              {error ? (
                <Text style={styles.errorText}>{error}</Text>
              ) : (
                <View style={styles.errorPlaceholder} />
              )}
            </Animated.View>

            {/* Bottom section */}
            <Animated.View
              entering={FadeIn.duration(400).delay(200)}
              style={styles.bottomSection}
            >
              <View style={styles.orRow}>
                <View style={styles.orLine} />
                <View style={styles.orChip}>
                  <Text style={styles.orText}>or</Text>
                </View>
                <View style={styles.orLine} />
              </View>
              <View style={styles.gap16} />

              {appleAvailable && (
                <View pointerEvents={socialLoading ? 'none' : 'auto'} style={socialLoading ? { opacity: 0.5 } : undefined}>
                  <AppleAuthentication.AppleAuthenticationButton
                    buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
                    buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                    cornerRadius={14}
                    style={styles.appleButton}
                    onPress={handleAppleSignIn}
                  />
                </View>
              )}

              {showGoogle && (
                <>
                  <View style={styles.gap12} />
                  <TouchableOpacity
                    style={styles.googleButton}
                    onPress={handleGoogleSignIn}
                    onPressIn={triggerHaptic}
                    activeOpacity={0.9}
                    disabled={!!socialLoading}
                  >
                    {socialLoading === 'google' ? (
                      <ActivityIndicator color={Colors.asphalt} />
                    ) : (
                      <Text style={styles.googleButtonText}>continue with google</Text>
                    )}
                  </TouchableOpacity>
                </>
              )}

              {/* When phone auth is the primary entry, brand new users
                  shouldn't reach email signup from here. Existing users
                  arrived via the phone-entry escape hatch and only need
                  to sign in. */}
              {!PHONE_AUTH_ENABLED && (
                <>
                  <View style={styles.gap16} />
                  <View style={styles.signupRow}>
                    <Text style={styles.signupPrompt}>don&apos;t have an account? </Text>
                    <TouchableOpacity onPress={handleSignUpPress} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Text style={styles.signupLink}>sign up</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={styles.gap8} />
                </>
              )}
            </Animated.View>
          </View>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>

      {/* Reset Password Modal */}
      <Modal
        visible={resetModalVisible}
        transparent
        animationType="fade"
        onRequestClose={closeResetModal}
        statusBarTranslucent
      >
        <Pressable style={modalStyles.overlay} onPress={closeResetModal}>
          <Pressable style={modalStyles.content} onPress={(e) => e.stopPropagation()}>
            <Text style={modalStyles.title}>reset password</Text>
            <Text style={modalStyles.subtitle}>enter your email to receive a reset link.</Text>
            <TextInput
              style={[styles.input, modalStyles.input]}
              placeholder="email address"
              placeholderTextColor={Colors.textMedium}
              value={resetEmail}
              onChangeText={(t) => { setResetEmail(t); setResetError(null); }}
              keyboardType="email-address"
              textContentType="emailAddress"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!resetLoading}
              returnKeyType="done"
              onSubmitEditing={Keyboard.dismiss}
              inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
            />
            {resetError ? <Text style={modalStyles.errorText}>{resetError}</Text> : null}
            <TouchableOpacity
              style={[styles.primaryButton, resetLoading && styles.primaryButtonDisabled]}
              onPress={handleSendResetLink}
              onPressIn={triggerHaptic}
              activeOpacity={0.9}
              disabled={resetLoading}
            >
              {resetLoading ? (
                <ActivityIndicator color={Colors.white} />
              ) : (
                <Text style={styles.primaryButtonText}>send reset link</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity onPress={closeResetModal} style={modalStyles.cancelButton}>
              <Text style={modalStyles.cancelText}>cancel</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
        <BrandedAlert
          visible={!!alertInfo}
          title={alertInfo?.title ?? ''}
          message={alertInfo?.message}
          buttons={alertInfo?.buttons}
          onClose={() => setAlertInfo(null)}
        />
      </SafeAreaView>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  bg: {
    flex: 1,
    backgroundColor: Colors.parchment,
  },
  bgOverlay: {
    ...StyleSheet.absoluteFillObject,
    // Cream at 75% so the blurred sunset bleeds through at ~25%. Tuned by
    // eye on-device — 0.85 was nearly invisible, 0.75 keeps form text
    // readable while letting the warm gradient breathe.
    backgroundColor: 'rgba(248, 245, 240, 0.75)',
  },
  safe: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  keyboardView: {
    flex: 1,
  },
  container: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'space-between',
  },
  topNavRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 4,
    paddingHorizontal: 12,
    minHeight: 36,
  },
  backHit: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topSection: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 24,
    paddingTop: 56,
    minHeight: 160,
  },
  logo: {
    width: 260,
    height: 56,
  },
  tagline: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyLG,
    color: Colors.textMedium,
    marginTop: 4,
    textAlign: 'center',
  },
  socialProof: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.textLight,
    marginTop: 8,
    textAlign: 'center',
  },
  formSection: {
    flex: 1,
    justifyContent: 'flex-start',
    minHeight: 320,
  },
  formTitle: {
    fontFamily: Fonts.displayBold,
    fontSize: FontSizes.displayLG,
    color: Colors.asphalt,
  },
  gap20: { height: 20 },
  gap12: { height: 12 },
  gap8: { height: 8 },
  gap16: { height: 16 },
  input: {
    height: 52,
    backgroundColor: Colors.cardBg,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 14,
    paddingLeft: 16,
    paddingRight: 16,
    paddingVertical: 0,
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyLG,
    color: Colors.asphalt,
    textAlign: 'left',
  },
  inputFocused: {
    borderColor: Colors.terracotta,
    borderWidth: 1.5,
    shadowColor: Colors.terracotta,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  passwordWrap: {
    position: 'relative',
  },
  eyeButton: {
    position: 'absolute',
    right: 16,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  forgotWrap: {
    alignSelf: 'flex-end',
  },
  forgotText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.terracotta,
  },
  primaryButton: {
    height: 52,
    borderRadius: 14,
    backgroundColor: Colors.terracotta,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: Colors.terracotta,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  primaryButtonDisabled: {
    opacity: 0.9,
  },
  primaryButtonText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.displaySM,
    color: Colors.white,
  },
  errorText: {
    marginTop: 8,
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.errorRed,
  },
  errorPlaceholder: {
    height: 22,
    marginTop: 8,
  },
  bottomSection: {
    paddingBottom: 8,
  },
  orRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  orLine: {
    flex: 1,
    height: 1,
    backgroundColor: Colors.border,
  },
  orChip: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    backgroundColor: Colors.cardBg,
  },
  orText: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.textMedium,
  },
  signupRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  signupPrompt: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
  },
  signupLink: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: Colors.terracotta,
  },
  appleButton: {
    height: 52,
    width: '100%',
  },
  googleButton: {
    height: 52,
    borderRadius: 14,
    backgroundColor: Colors.cardBg,
    borderWidth: 1,
    borderColor: Colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
  },
  googleButtonText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyLG,
    color: Colors.asphalt,
  },
});

const modalStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: Colors.overlayDark,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  content: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: Colors.cardBg,
    borderRadius: 20,
    padding: 24,
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: FontSizes.displayMD,
    color: Colors.asphalt,
    marginBottom: 8,
  },
  subtitle: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyLG,
    color: Colors.textMedium,
    marginBottom: 20,
  },
  input: {
    marginBottom: 16,
  },
  errorText: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.errorRed,
    marginBottom: 12,
  },
  cancelButton: {
    marginTop: 16,
    alignItems: 'center',
  },
  cancelText: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.textMedium,
  },
});
