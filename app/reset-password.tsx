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
import { Image } from 'expo-image';
import { Eye, EyeOff } from 'lucide-react-native';
import { supabase } from '../lib/supabase';
import Colors from '../constants/Colors';
import { Fonts, FontSizes } from '../constants/Typography';

const MIN_PASSWORD_LENGTH = 8;

export default function ResetPasswordScreen() {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [newPasswordVisible, setNewPasswordVisible] = useState(false);
  const [confirmPasswordVisible, setConfirmPasswordVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newPasswordFocused, setNewPasswordFocused] = useState(false);
  const [confirmPasswordFocused, setConfirmPasswordFocused] = useState(false);
  const confirmInputRef = useRef<TextInput>(null);

  const triggerHaptic = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

  const handleSubmit = async () => {
    setError(null);
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(`Your new password must be at least ${MIN_PASSWORD_LENGTH} characters long.`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) {
        setError(updateError.message);
        return;
      }
      Alert.alert('Success', 'Your password has been updated.', [
        {
          text: 'OK',
          onPress: async () => {
            await supabase.auth.signOut();
            router.replace('/login');
          },
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

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
            <Image source={require('../assets/images/washedup-logo.png')} style={styles.logo} contentFit="contain" />
            <Text style={styles.title}>Create a new password</Text>
            <Text style={styles.subtitle}>Your new password must be at least 8 characters long.</Text>

            <View style={styles.gap20} />

            <View style={styles.passwordWrap}>
              <TextInput
                style={[styles.input, newPasswordFocused && styles.inputFocused]}
                placeholder="New password"
                placeholderTextColor={Colors.textMedium}
                value={newPassword}
                onChangeText={(t) => { setNewPassword(t); setError(null); }}
                onFocus={() => setNewPasswordFocused(true)}
                onBlur={() => setNewPasswordFocused(false)}
                secureTextEntry={!newPasswordVisible}
                returnKeyType="next"
                onSubmitEditing={() => confirmInputRef.current?.focus()}
                editable={!loading}
              />
              <TouchableOpacity
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                onPress={() => { setNewPasswordVisible((v) => !v); triggerHaptic(); }}
                style={styles.eyeButton}
              >
                {newPasswordVisible ? (
                  <EyeOff size={22} color={Colors.textLight} />
                ) : (
                  <Eye size={22} color={Colors.textLight} />
                )}
              </TouchableOpacity>
            </View>

            <View style={styles.gap12} />

            <View style={styles.passwordWrap}>
              <TextInput
                ref={confirmInputRef}
                style={[styles.input, confirmPasswordFocused && styles.inputFocused]}
                placeholder="Confirm new password"
                placeholderTextColor={Colors.textMedium}
                value={confirmPassword}
                onChangeText={(t) => { setConfirmPassword(t); setError(null); }}
                onFocus={() => setConfirmPasswordFocused(true)}
                onBlur={() => setConfirmPasswordFocused(false)}
                secureTextEntry={!confirmPasswordVisible}
                returnKeyType="done"
                onSubmitEditing={handleSubmit}
                editable={!loading}
              />
              <TouchableOpacity
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                onPress={() => { setConfirmPasswordVisible((v) => !v); triggerHaptic(); }}
                style={styles.eyeButton}
              >
                {confirmPasswordVisible ? (
                  <EyeOff size={22} color={Colors.textLight} />
                ) : (
                  <Eye size={22} color={Colors.textLight} />
                )}
              </TouchableOpacity>
            </View>

            <View style={styles.gap20} />

            <TouchableOpacity
              style={[styles.primaryButton, loading && styles.primaryButtonDisabled]}
              onPress={handleSubmit}
              onPressIn={triggerHaptic}
              activeOpacity={0.9}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.primaryButtonText}>Update Password</Text>
              )}
            </TouchableOpacity>

            {error ? (
              <Text style={styles.errorText}>{error}</Text>
            ) : (
              <View style={styles.errorPlaceholder} />
            )}
          </View>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
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
    paddingTop: 40,
  },
  logo: {
    width: 260,
    height: 56,
    alignSelf: 'center',
    marginBottom: 32,
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
    marginBottom: 8,
  },
  gap20: { height: 20 },
  gap12: { height: 12 },
  input: {
    height: 52,
    backgroundColor: Colors.cardBg,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 14,
    paddingLeft: 16,
    paddingRight: 48,
    paddingVertical: 0,
    fontSize: 16,
    color: Colors.asphalt,
    textAlign: 'left',
  },
  inputFocused: {
    borderColor: Colors.terracotta,
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
  primaryButton: {
    height: 52,
    borderRadius: 14,
    backgroundColor: Colors.terracotta,
    justifyContent: 'center',
    alignItems: 'center',
  },
  primaryButtonDisabled: {
    opacity: 0.9,
  },
  primaryButtonText: {
    fontFamily: Fonts.sansBold,
    fontSize: 17,
    color: Colors.white,
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
});
