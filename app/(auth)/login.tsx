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
  Alert,
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

const SOCIAL_PROOF = '700+ people in LA already joined';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const passwordInputRef = useRef<TextInput>(null);

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
    Alert.alert('Forgot password?', 'Check your email');
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
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
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
                  <ActivityIndicator color="#FFFFFF" />
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
    fontSize: 16,
    color: Colors.textMedium,
    marginTop: 4,
    textAlign: 'center',
  },
  socialProof: {
    fontSize: 13,
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
    fontFamily: 'DMSerifDisplay_400Regular',
    fontSize: 28,
    color: Colors.textDark,
  },
  gap20: { height: 20 },
  gap12: { height: 12 },
  gap8: { height: 8 },
  gap16: { height: 16 },
  input: {
    height: 52,
    backgroundColor: Colors.cardBackground,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 14,
    paddingHorizontal: 16,
    fontSize: 16,
    fontWeight: '400',
    color: Colors.textDark,
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
    fontSize: 13,
    color: Colors.primaryOrange,
    fontWeight: '600',
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
    backgroundColor: Colors.cardBackground,
  },
  orText: {
    fontSize: 13,
    color: Colors.textMedium,
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
