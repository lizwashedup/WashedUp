import { useCallback, useEffect, useRef, useState } from 'react';
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
import { useFocusEffect } from 'expo-router';
import { useObservedUser } from '../hooks/useObservedUser';
import { deliberateSignOutAt } from '../lib/navState';
import { hapticLight } from '../lib/haptics';
import { Image } from 'expo-image';
import { Eye, EyeOff } from 'lucide-react-native';
import { BrandedAlert, type BrandedAlertButton } from '../components/BrandedAlert';
import { supabase } from '../lib/supabase';
import Colors from '../constants/Colors';
import { Fonts, FontSizes } from '../constants/Typography';
import { KEYBOARD_DONE_ACCESSORY_ID } from '../components/keyboard/KeyboardDoneBar';

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
  const [alertInfo, setAlertInfo] = useState<{ title: string; message: string; buttons?: BrandedAlertButton[] } | null>(null);
  const confirmInputRef = useRef<TextInput>(null);

  const account = useObservedUser();
  const firstOwner = useRef<{ id: string; epoch: number } | null>(null);
  if (!firstOwner.current && account.viewerId) firstOwner.current = { id: account.viewerId, epoch: account.epoch };
  const ownerMatches = !!account.viewerId && firstOwner.current?.id === account.viewerId && firstOwner.current?.epoch === account.epoch;
  const visit = useRef<object | null>(null);
  const [renderVisit, setRenderVisit] = useState<object | null>(null);
  const pending = useRef<object | null>(null);
  const [saved, setSaved] = useState(false);
  const savedRef = useRef(false);
  const exit = useRef<{ current: () => boolean; started: boolean } | null>(null);
  const alertDismissed = useRef(true);
  const [exitRevision, setExitRevision] = useState(0);
  useFocusEffect(useCallback(() => {
    const currentVisit = {}; visit.current = currentVisit; setRenderVisit(currentVisit);
    exit.current = null; savedRef.current = false; alertDismissed.current = true;
    setLoading(!!pending.current); setSaved(false); setAlertInfo(null); setError(null);
    setNewPassword(''); setConfirmPassword(''); setNewPasswordVisible(false); setConfirmPasswordVisible(false);
    return () => { if (visit.current === currentVisit) visit.current = null; exit.current = null; };
  }, [account.viewerId, account.epoch]));
  const canUse = () => !!renderVisit && visit.current === renderVisit && ownerMatches && !account.isLoading && !account.error && account.isCurrent();
  const scope = () => { const currentVisit = visit.current; return () => visit.current === currentVisit && canUse(); };
  const finishExit = async () => {
    const action = exit.current;
    if (!action || action.started || !alertDismissed.current || !action.current()) return;
    action.started = true; setLoading(true);
    try {
      deliberateSignOutAt.ts = Date.now();
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) throw signOutError;
      // Root owns the confirmed SIGNED_OUT route. Do not race it with another replace.
    } catch {
      if (action.current()) setError('Your password was saved. Please try signing out again.');
    } finally {
      if (exit.current === action) { exit.current = null; if (action.current()) setLoading(false); }
    }
  };
  const requestExit = (current: () => boolean) => {
    if (!current() || !savedRef.current || exit.current) return;
    exit.current = { current, started: false };
    setAlertInfo(null); setExitRevision(value => value + 1);
  };
  useEffect(() => {
    if (Platform.OS !== 'ios' && !alertInfo) alertDismissed.current = true;
    if (!alertInfo) void finishExit();
  }, [alertInfo, exitRevision]);
  const dismissVisit = visit.current;
  const onAlertDismiss = () => {
    if (!dismissVisit || visit.current !== dismissVisit) return;
    alertDismissed.current = true; void finishExit();
  };
  const triggerHaptic = () => hapticLight();

  const handleSubmit = async () => {
    if (!canUse() || pending.current || savedRef.current) return;
    setError(null);
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(`Your new password must be at least ${MIN_PASSWORD_LENGTH} characters long.`);
      return;
    }
    if (newPassword !== confirmPassword) { setError('Passwords do not match.'); return; }
    const attempt = {}; pending.current = attempt;
    const current = scope();
    setLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (!current()) return;
      if (updateError) throw updateError;
      savedRef.current = true; setSaved(true); setNewPassword(''); setConfirmPassword('');
      alertDismissed.current = false;
      setAlertInfo({ title: 'Success', message: 'Your password has been updated.',
        buttons: [{ text: 'OK', onPress: () => requestExit(current) }] });
    } catch {
      if (current()) setError('Could not update your password. Please try again.');
    } finally {
      if (pending.current === attempt) { pending.current = null; if (visit.current && account.isCurrent()) setLoading(false); }
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <View style={styles.container}>
            <Image source={require('../assets/images/washedup-logo.png')} style={styles.logo} contentFit="contain" />
            <Text style={styles.title}>Create a new password</Text>
            <Text style={styles.subtitle}>Your new password must be at least 8 characters long.</Text>

            <View style={styles.gap20} />

            <View style={styles.passwordWrap}>
              <TextInput
                style={[styles.input, newPasswordFocused && styles.inputFocused]}
                accessibilityLabel="New password"
                placeholder="New password"
                placeholderTextColor={Colors.textMedium}
                value={newPassword}
                onChangeText={(t) => { setNewPassword(t); setError(null); }}
                onFocus={() => setNewPasswordFocused(true)}
                onBlur={() => setNewPasswordFocused(false)}
                secureTextEntry={!newPasswordVisible}
                returnKeyType="next"
                onSubmitEditing={() => confirmInputRef.current?.focus()}
                editable={!loading && !saved && ownerMatches && !account.isLoading && !account.error}
                inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
              />
              <TouchableOpacity
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                accessibilityRole="button"
                accessibilityLabel={newPasswordVisible ? "Hide password" : "Show password"}
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
                accessibilityLabel="Confirm new password"
                placeholder="Confirm new password"
                placeholderTextColor={Colors.textMedium}
                value={confirmPassword}
                onChangeText={(t) => { setConfirmPassword(t); setError(null); }}
                onFocus={() => setConfirmPasswordFocused(true)}
                onBlur={() => setConfirmPasswordFocused(false)}
                secureTextEntry={!confirmPasswordVisible}
                returnKeyType="done"
                onSubmitEditing={handleSubmit}
                editable={!loading && !saved && ownerMatches && !account.isLoading && !account.error}
                inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
              />
              <TouchableOpacity
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                accessibilityRole="button"
                accessibilityLabel={confirmPasswordVisible ? "Hide confirmation" : "Show confirmation"}
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
              accessibilityRole="button"
              accessibilityLabel={saved ? "Sign in" : "Update password"}
              onPress={saved ? () => requestExit(scope()) : handleSubmit}
              onPressIn={triggerHaptic}
              activeOpacity={0.9}
              disabled={loading || !ownerMatches || account.isLoading || !!account.error}
            >
              {loading ? (
                <ActivityIndicator color={Colors.white} />
              ) : (
                <Text style={styles.primaryButtonText}>{saved ? 'Sign in' : 'Update Password'}</Text>
              )}
            </TouchableOpacity>

            {account.isLoading ? <Text style={styles.errorText}>Checking your reset session…</Text> :
              (!ownerMatches || account.error) ? <Text style={styles.errorText}>Please reopen your password reset link to continue.</Text> : null}
            {account.error && <TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry session check" onPress={() => { void account.retry(); }}>
              <Text style={styles.errorText}>Try again</Text>
            </TouchableOpacity>}
            {error ? (
              <Text style={styles.errorText}>{error}</Text>
            ) : (
              <View style={styles.errorPlaceholder} />
            )}
          </View>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
      <BrandedAlert
        visible={!!alertInfo}
        title={alertInfo?.title ?? ''}
        message={alertInfo?.message}
        buttons={alertInfo?.buttons}
        onClose={() => setAlertInfo(null)}
        onDismiss={onAlertDismiss}
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
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyLG,
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
});
