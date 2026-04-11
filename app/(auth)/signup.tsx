import * as AppleAuthentication from 'expo-apple-authentication';
import { hapticLight, hapticMedium, hapticHeavy, hapticSelection, hapticSuccess, hapticWarning, hapticError } from '../../lib/haptics';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Eye, EyeOff } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Keyboard,
    KeyboardAvoidingView,
    Linking,
    Platform,
    ScrollView,
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
import { checkContent } from '../../lib/contentFilter';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SignupScreen() {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationTouched, setValidationTouched] = useState(false);
  const [alertInfo, setAlertInfo] = useState<{ title: string; message: string; buttons?: BrandedAlertButton[] } | null>(null);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const lastNameInputRef = useRef<TextInput>(null);
  const emailInputRef = useRef<TextInput>(null);
  const passwordInputRef = useRef<TextInput>(null);

  const firstNameInvalid = validationTouched && !firstName.trim();
  const lastNameInvalid = validationTouched && !lastName.trim();
  const emailInvalid = validationTouched && (!email.trim() || !EMAIL_REGEX.test(email.trim()));
  const passwordInvalid = validationTouched && (password.length < 6 || !password);

  const inputBorder = (invalid: boolean, focused: boolean) => {
    if (invalid) return styles.inputError;
    if (focused) return styles.inputFocused;
    return null;
  };

  const handleSignUp = async () => {
    setError(null);
    setValidationTouched(true);

    const trimmedFirst = firstName.trim();
    const trimmedLast = lastName.trim();
    const trimmedEmail = email.trim();
    if (!trimmedFirst) {
      setError('Please enter your first name.');
      return;
    }
    if (!trimmedLast) {
      setError('Please enter your last name.');
      return;
    }
    if (!trimmedEmail) {
      setError('Please enter your email address.');
      return;
    }
    if (!EMAIL_REGEX.test(trimmedEmail)) {
      setError('Please enter a valid email address.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (!agreedToTerms) {
      setError('Please agree to the Terms of Service, Privacy Policy, and Community Guidelines.');
      return;
    }
    const firstFilter = checkContent(trimmedFirst);
    if (!firstFilter.ok) {
      setError(firstFilter.reason ?? 'That name is not allowed. Please try a different one.');
      return;
    }
    const lastFilter = checkContent(trimmedLast);
    if (!lastFilter.ok) {
      setError(lastFilter.reason ?? 'That name is not allowed. Please try a different one.');
      return;
    }

    setLoading(true);
    try {
      const { data: authData, error: signUpError } = await supabase.auth.signUp({
        email: trimmedEmail,
        password,
      });
      if (signUpError) {
        const msg = signUpError.message?.toLowerCase() ?? '';
        if (msg.includes('already registered') || msg.includes('already exists')) {
          setError('An account with this email already exists.');
        } else if (msg.includes('password') && (msg.includes('weak') || msg.includes('short') || msg.includes('least'))) {
          setError('Password is too weak. Please use at least 6 characters.');
        } else if (msg.includes('rate') || msg.includes('too many')) {
          setError('Too many attempts. Please wait a moment and try again.');
        } else if (msg.includes('valid') && msg.includes('email')) {
          setError('Please enter a valid email address.');
        } else {
          setError('Something went wrong. Please try again.');
        }
        return;
      }

      const user = authData?.user;
      if (user) {
        for (let attempt = 0; attempt < 2; attempt++) {
          const { error: nameErr } = await supabase
            .from('profiles')
            .update({ first_name_display: trimmedFirst, last_name: trimmedLast })
            .eq('id', user.id);
          if (!nameErr) break;
          if (attempt === 0) await new Promise(r => setTimeout(r, 800));
        }
      }

      if (!authData?.session) {
        setAlertInfo({
          title: 'Check your email',
          message: 'We sent you a confirmation link. Please verify your email to continue.',
        });
      }
      // Auth listener in root layout handles navigation when session exists
    } catch (e: any) {
      setError(e?.message ?? 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleLogInPress = () => {
    hapticLight();
    router.replace('/login');
  };

  const triggerHaptic = () => hapticLight();

  const [firstNameFocused, setFirstNameFocused] = useState(false);
  const [lastNameFocused, setLastNameFocused] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [socialLoading, setSocialLoading] = useState<'apple' | 'google' | null>(null);
  const [appleAvailable, setAppleAvailable] = useState(Platform.OS === 'ios');
  const showGoogle = isGoogleAuthConfigured();

  useEffect(() => {
    isAppleAuthAvailable().then(setAppleAvailable);
  }, []);

  const handleAppleSignIn = async () => {
    if (!agreedToTerms) {
      setError('Please agree to the Terms of Service, Privacy Policy, and Community Guidelines first.');
      return;
    }
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
    if (!agreedToTerms) {
      setError('Please agree to the Terms of Service, Privacy Policy, and Community Guidelines first.');
      return;
    }
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

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <StatusBar style="light" />
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.container}>
            {/* Top section */}
            <Animated.View
              entering={FadeIn.duration(400)}
              style={styles.topSection}
            >
              <Image source={require('../../assets/images/washedup-logo.png')} style={styles.logo} contentFit="contain" />
              <Text style={styles.tagline}>Find People to Go With.</Text>
            </Animated.View>

            {/* Form */}
            <Animated.View
              entering={FadeIn.duration(400).delay(100)}
              style={styles.formSection}
            >
              <Text style={styles.formTitle}>Join washedup</Text>
              <Text style={styles.formSubtitle}>Takes 30 seconds. No, really.</Text>
              <View style={styles.gap20} />

              <View style={styles.nameRow}>
                <TextInput
                  style={[
                    styles.input,
                    styles.nameInput,
                    inputBorder(firstNameInvalid, firstNameFocused),
                  ]}
                  placeholder="First name"
                  placeholderTextColor={Colors.textMedium}
                  value={firstName}
                  onChangeText={(t) => { setFirstName(t); setError(null); setValidationTouched(false); }}
                  onFocus={() => setFirstNameFocused(true)}
                  onBlur={() => setFirstNameFocused(false)}
                  autoCapitalize="words"
                  returnKeyType="next"
                  onSubmitEditing={() => lastNameInputRef.current?.focus()}
                  editable={!loading}
                />
                <TextInput
                  ref={lastNameInputRef}
                  style={[
                    styles.input,
                    styles.nameInput,
                    inputBorder(lastNameInvalid, lastNameFocused),
                  ]}
                  placeholder="Last name"
                  placeholderTextColor={Colors.textMedium}
                  value={lastName}
                  onChangeText={(t) => { setLastName(t); setError(null); setValidationTouched(false); }}
                  onFocus={() => setLastNameFocused(true)}
                  onBlur={() => setLastNameFocused(false)}
                  autoCapitalize="words"
                  returnKeyType="next"
                  onSubmitEditing={() => emailInputRef.current?.focus()}
                  editable={!loading}
                />
              </View>
              <View style={styles.gap12} />

              <TextInput
                ref={emailInputRef}
                style={[
                  styles.input,
                  inputBorder(emailInvalid, emailFocused),
                ]}
                placeholder="Email address"
                placeholderTextColor={Colors.textMedium}
                value={email}
                onChangeText={(t) => { setEmail(t); setError(null); setValidationTouched(false); }}
                onFocus={() => setEmailFocused(true)}
                onBlur={() => setEmailFocused(false)}
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
                    inputBorder(passwordInvalid, passwordFocused),
                  ]}
                  placeholder="Create a password"
                  placeholderTextColor={Colors.textMedium}
                  value={password}
                  onChangeText={(t) => { setPassword(t); setError(null); setValidationTouched(false); }}
                  onFocus={() => setPasswordFocused(true)}
                  onBlur={() => setPasswordFocused(false)}
                  secureTextEntry={!passwordVisible}
                  returnKeyType="done"
                  onSubmitEditing={handleSignUp}
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
              <View style={styles.gap4} />
              <Text style={styles.helperText}>At least 6 characters</Text>
              <View style={styles.gap20} />

              <View style={styles.agreementRow}>
                <TouchableOpacity
                  onPress={() => { setAgreedToTerms((v) => !v); triggerHaptic(); }}
                  activeOpacity={0.7}
                  disabled={loading}
                  style={styles.checkboxTouch}
                >
                  <View style={[styles.checkbox, agreedToTerms && styles.checkboxChecked]}>
                    {agreedToTerms && <Text style={styles.checkmark}>✓</Text>}
                  </View>
                </TouchableOpacity>
                <View style={styles.agreementTextWrap}>
                  <Text style={styles.agreementText}>By creating an account, you agree to our </Text>
                  <TouchableOpacity onPress={() => { Linking.openURL('https://washedup.app/terms'); triggerHaptic(); }} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
                    <Text style={styles.agreementLink}>Terms of Service</Text>
                  </TouchableOpacity>
                  <Text style={styles.agreementText}>, </Text>
                  <TouchableOpacity onPress={() => { Linking.openURL('https://washedup.app/privacy'); triggerHaptic(); }} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
                    <Text style={styles.agreementLink}>Privacy Policy</Text>
                  </TouchableOpacity>
                  <Text style={styles.agreementText}>, and </Text>
                  <TouchableOpacity onPress={() => { Linking.openURL('https://washedup.app/guidelines'); triggerHaptic(); }} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
                    <Text style={styles.agreementLink}>Community Guidelines</Text>
                  </TouchableOpacity>
                  <Text style={styles.agreementText}>.</Text>
                </View>
              </View>
              {error ? (
                <Text style={[styles.errorText, { marginBottom: 8 }]}>{error}</Text>
              ) : (
                <View style={{ height: 8 }} />
              )}

              <TouchableOpacity
                style={[styles.primaryButton, loading && styles.primaryButtonDisabled]}
                onPress={handleSignUp}
                onPressIn={triggerHaptic}
                activeOpacity={0.9}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color={Colors.white} />
                ) : (
                  <Text style={styles.primaryButtonText}>Sign Up</Text>
                )}
              </TouchableOpacity>
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
                <View style={!agreedToTerms && styles.socialDisabled}>
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
                    style={[styles.googleButton, !agreedToTerms && styles.socialDisabled]}
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
                <Text style={styles.signupPrompt}>Already have an account? </Text>
                <TouchableOpacity onPress={handleLogInPress} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={styles.signupLink}>Log in</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.gap8} />
            </Animated.View>
          </View>
        </TouchableWithoutFeedback>
        </ScrollView>
      </KeyboardAvoidingView>
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
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    justifyContent: 'space-between',
  },
  container: {
    flexGrow: 1,
    justifyContent: 'space-between',
  },
  topSection: {
    paddingTop: 56,
    alignItems: 'center',
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
  formSection: {
    flex: 1,
    justifyContent: 'flex-start',
    minHeight: 380,
    paddingTop: 32,
  },
  formTitle: {
    fontFamily: Fonts.displayBold,
    fontSize: FontSizes.displayLG,
    color: Colors.asphalt,
  },
  formSubtitle: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.textMedium,
    marginTop: 4,
  },
  gap20: { height: 20 },
  gap16: { height: 16 },
  gap12: { height: 12 },
  gap4: { height: 4 },
  gap8: { height: 8 },
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
  nameRow: {
    flexDirection: 'row',
    gap: 12,
  },
  nameInput: {
    flex: 1,
    minWidth: 0,
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
  inputError: {
    borderColor: Colors.errorRed,
    borderWidth: 1.5,
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
  helperText: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.caption,
    color: Colors.textLight,
  },
  agreementRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  checkboxTouch: {
    paddingTop: 2,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: Colors.terracotta,
    borderColor: Colors.terracotta,
  },
  checkmark: {
    color: Colors.white,
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodySM,
  },
  agreementTextWrap: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  agreementText: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
    lineHeight: 20,
  },
  agreementLink: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyMD,
    color: Colors.terracotta,
    textDecorationLine: 'underline',
    lineHeight: 20,
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
    opacity: 0.5,
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
  bottomSection: {
    paddingBottom: 8,
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
  socialDisabled: {
    opacity: 0.4,
  },
});
