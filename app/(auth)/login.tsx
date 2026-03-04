import * as AppleAuthentication from 'expo-apple-authentication';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Eye, EyeOff } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
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
import { BrandedAlert, type BrandedAlertButton } from '../../components/BrandedAlert';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { isAppleAuthAvailable, isGoogleAuthConfigured, signInWithApple, signInWithGoogle } from '../../lib/socialAuth';
import { supabase } from '../../lib/supabase';

const SOCIAL_PROOF = '700+ people in LA already joined';

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
    } catch (e: any) {
      if (e?.code !== 'ERR_REQUEST_CANCELED') {
        setError(e?.message ?? 'Apple sign-in failed. Please try again.');
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
    } catch (e: any) {
      if (e?.code !== 'SIGN_IN_CANCELLED') {
        setError(e?.message ?? 'Google sign-in failed. Please try again.');
      }
    } finally {
      setSocialLoading(null);
    }
  };

  const handleLogin = async () => {
    setError(null);
    if (!email.trim() || !password) {
      setError('Please enter your email and password.');
      return;
    }
    setLoading(true);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) {
        setError('Wrong email or password');
        return;
      }
      // Root layout handles redirect via onAuthStateChange
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setResetEmail('');
    setResetError(null);
    setResetModalVisible(true);
  };

  const handleSendResetLink = async () => {
    setResetError(null);
    const emailTrimmed = resetEmail.trim();
    if (!emailTrimmed) {
      setResetError('Please enter your email address.');
      return;
    }
    setResetLoading(true);
    try {
      const { error: err } = await supabase.auth.resetPasswordForEmail(emailTrimmed, {
        redirectTo: 'washedupapp://auth/callback',
      });
      if (err) {
        setResetError(err.message);
        return;
      }
      setResetModalVisible(false);
      setAlertInfo({ title: 'Check your email', message: 'Check your email for a password reset link.' });
    } finally {
      setResetLoading(false);
    }
  };

  const closeResetModal = () => {
    setResetModalVisible(false);
    setResetError(null);
  };

  const handleSignUpPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.replace('/signup');
  };

  const triggerHaptic = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.container}>
            {/* Top section ~40% */}
            <Animated.View
              entering={FadeIn.duration(400)}
              style={styles.topSection}
            >
              <Image source={require('../../assets/images/washedup-logo.png')} style={styles.logo} contentFit="contain" />
              <Text style={styles.tagline}>Find People to Go With.</Text>
              <Text style={styles.socialProof}>{SOCIAL_PROOF}</Text>
            </Animated.View>

            {/* Form */}
            <Animated.View
              entering={FadeIn.duration(400).delay(100)}
              style={styles.formSection}
            >
              <Text style={styles.formTitle}>Welcome back</Text>
              <View style={styles.gap20} />

              <TextInput
                style={[
                  styles.input,
                  emailFocused && styles.inputFocused,
                ]}
                placeholder="Email address"
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
              />
              <View style={styles.gap12} />

              <View style={styles.passwordWrap}>
                <TextInput
                  ref={passwordInputRef}
                  style={[
                    styles.input,
                    passwordFocused && styles.inputFocused,
                  ]}
                  placeholder="Password"
                  onFocus={() => setPasswordFocused(true)}
                  onBlur={() => setPasswordFocused(false)}
                  placeholderTextColor={Colors.textMedium}
                  value={password}
                  onChangeText={(t) => { setPassword(t); setError(null); }}
                  secureTextEntry={!passwordVisible}
                  returnKeyType="done"
                  onSubmitEditing={handleLogin}
                  editable={!loading}
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
                <Text style={styles.forgotText}>Forgot password?</Text>
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
                  <Text style={styles.primaryButtonText}>Log In</Text>
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
                      <Text style={styles.googleButtonText}>Continue with Google</Text>
                    )}
                  </TouchableOpacity>
                </>
              )}

              <View style={styles.gap16} />
              <View style={styles.signupRow}>
                <Text style={styles.signupPrompt}>Don&apos;t have an account? </Text>
                <TouchableOpacity onPress={handleSignUpPress} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={styles.signupLink}>Sign up</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.gap8} />
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
      >
        <Pressable style={modalStyles.overlay} onPress={closeResetModal}>
          <Pressable style={modalStyles.content} onPress={(e) => e.stopPropagation()}>
            <Text style={modalStyles.title}>Reset Password</Text>
            <Text style={modalStyles.subtitle}>Enter your email to receive a reset link.</Text>
            <TextInput
              style={[styles.input, modalStyles.input]}
              placeholder="Email address"
              placeholderTextColor={Colors.textMedium}
              value={resetEmail}
              onChangeText={(t) => { setResetEmail(t); setResetError(null); }}
              keyboardType="email-address"
              textContentType="emailAddress"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!resetLoading}
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
                <Text style={styles.primaryButtonText}>Send Reset Link</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity onPress={closeResetModal} style={modalStyles.cancelButton}>
              <Text style={modalStyles.cancelText}>Cancel</Text>
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
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.parchment,
  },
  keyboardView: {
    flex: 1,
  },
  container: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'space-between',
  },
  topSection: {
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingBottom: 24,
    paddingTop: 16,
    minHeight: 100,
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
