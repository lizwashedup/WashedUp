import { useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Animated, { FadeIn } from 'react-native-reanimated';
import { Image } from 'expo-image';
import { Eye, EyeOff } from 'lucide-react-native';
import { supabase } from '../../lib/supabase';
import Colors from '../../constants/Colors';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SignupScreen() {
  const [firstName, setFirstName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationTouched, setValidationTouched] = useState(false);
  const emailInputRef = useRef<TextInput>(null);
  const passwordInputRef = useRef<TextInput>(null);

  const firstNameInvalid = validationTouched && !firstName.trim();
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
    const trimmedEmail = email.trim();
    if (!trimmedFirst) {
      setError('Please enter your first name.');
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

    setLoading(true);
    try {
      const { data: authData, error: signUpError } = await supabase.auth.signUp({
        email: trimmedEmail,
        password,
      });
      if (signUpError) {
        setError(signUpError.message === 'User already registered' ? 'An account with this email already exists.' : signUpError.message);
        return;
      }
      const user = authData?.user;
      if (user) {
        await supabase
          .from('profiles')
          .update({ first_name_display: trimmedFirst })
          .eq('id', user.id);
      }
      // Root layout will redirect to onboarding/basics when session exists and onboarding not complete
    } finally {
      setLoading(false);
    }
  };

  const handleLogInPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.replace('/login');
  };

  const triggerHaptic = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

  const [firstNameFocused, setFirstNameFocused] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <StatusBar style="light" />
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
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
              <Text style={styles.formTitle}>Join WashedUp</Text>
              <Text style={styles.formSubtitle}>Takes 30 seconds. No, really.</Text>
              <View style={styles.gap20} />

              <TextInput
                style={[
                  styles.input,
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
                onSubmitEditing={() => emailInputRef.current?.focus()}
                editable={!loading}
              />
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

              <TouchableOpacity
                style={[styles.primaryButton, loading && styles.primaryButtonDisabled]}
                onPress={handleSignUp}
                onPressIn={triggerHaptic}
                activeOpacity={0.9}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.primaryButtonText}>Sign Up</Text>
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
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.backgroundCream,
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
    paddingTop: 24,
    alignItems: 'center',
  },
  logo: {
    width: 260,
    height: 56,
  },
  tagline: {
    fontSize: 16,
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
    fontFamily: 'DMSerifDisplay_400Regular',
    fontSize: 28,
    color: Colors.textDark,
  },
  formSubtitle: {
    fontSize: 14,
    color: Colors.textMedium,
    marginTop: 4,
  },
  gap20: { height: 20 },
  gap12: { height: 12 },
  gap4: { height: 4 },
  gap8: { height: 8 },
  input: {
    height: 52,
    backgroundColor: Colors.cardBackground,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 14,
    paddingLeft: 16,
    paddingRight: 16,
    paddingVertical: 0,
    fontSize: 16,
    fontWeight: '400',
    color: Colors.textDark,
    textAlign: 'left',
  },
  inputFocused: {
    borderColor: Colors.primaryOrange,
    borderWidth: 1.5,
    shadowColor: Colors.primaryOrange,
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
    fontSize: 12,
    color: Colors.textLight,
  },
  primaryButton: {
    height: 52,
    borderRadius: 14,
    backgroundColor: '#C4652A', // WashedUp orange — matches logo
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#C4652A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  primaryButtonDisabled: {
    opacity: 0.9,
  },
  primaryButtonText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  errorText: {
    marginTop: 8,
    fontSize: 14,
    color: Colors.errorRed,
  },
  errorPlaceholder: {
    height: 22,
    marginTop: 8,
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
    fontSize: 15,
    color: Colors.textDark,
  },
  signupLink: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.primaryOrange,
  },
});
