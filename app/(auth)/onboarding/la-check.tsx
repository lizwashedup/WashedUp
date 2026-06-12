import { useState } from 'react';
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
import { KEYBOARD_DONE_ACCESSORY_ID } from '../../../components/keyboard/KeyboardDoneBar';
import { router } from 'expo-router';
import { hapticLight } from '../../../lib/haptics';
import { BrandedAlert, type BrandedAlertButton } from '../../../components/BrandedAlert';
import { supabase } from '../../../lib/supabase';
import { getUserBounded } from '../../../lib/authGate';
import { useSubmitGuard } from '../../../hooks/useSubmitGuard';
import { checkContent } from '../../../lib/contentFilter';
import Colors from '../../../constants/Colors';
import { Fonts } from '../../../constants/Typography';
import ProgressHead from '../../../components/onboarding/ProgressHead';

export default function OnboardingLACheckScreen() {
  const [choseNo, setChoseNo] = useState(false);
  const [city, setCity] = useState('');
  const [loading, setLoading] = useState(false);
  const [alertInfo, setAlertInfo] = useState<{
    title: string;
    message: string;
    buttons?: BrandedAlertButton[];
  } | null>(null);

  const submit = useSubmitGuard();

  const handleLA = async (isVisitor: boolean) => {
    if (loading) return;
    if (!submit.tryAcquire()) return;
    hapticLight();
    setLoading(true);
    try {
      const { user, resolved } = await getUserBounded();
      if (!user) {
        if (!resolved) {
          // Transient (timeout/network): do NOT sign out a valid session.
          setAlertInfo({ title: 'something went wrong', message: "couldn't reach the server. try again." });
          return;
        }
        setAlertInfo({ title: 'session expired', message: 'please sign in again.' });
        await supabase.auth.signOut();
        return;
      }
      const { error } = await supabase
        .from('profiles')
        .update({
          city: 'Los Angeles',
          is_visitor: isVisitor,
          onboarding_status: 'referral',
        })
        .eq('id', user.id);
      if (error) {
        setAlertInfo({ title: 'something went wrong', message: 'could not save. try again.' });
        return;
      }
      router.replace('/onboarding/referral');
    } finally {
      submit.release();
      setLoading(false);
    }
  };

  const handleNo = () => {
    hapticLight();
    setChoseNo(true);
  };

  const handleContinueFromNo = async () => {
    if (loading) return;
    if (!submit.tryAcquire()) return;
    hapticLight();
    setLoading(true);
    try {
      const { user, resolved } = await getUserBounded();
      if (!user) {
        if (!resolved) {
          // Transient (timeout/network): do NOT sign out a valid session.
          setAlertInfo({ title: 'something went wrong', message: "couldn't reach the server. try again." });
          return;
        }
        setAlertInfo({ title: 'session expired', message: 'please sign in again.' });
        await supabase.auth.signOut();
        return;
      }
      const trimmedCity = city.trim() || 'Other';
      const cityFilter = checkContent(trimmedCity);
      if (!cityFilter.ok) {
        setAlertInfo({
          title: 'content not allowed',
          message: cityFilter.reason ?? 'please try a different city name.',
        });
        return;
      }
      const { error } = await supabase
        .from('profiles')
        .update({ city: trimmedCity, onboarding_status: 'waitlisted' })
        .eq('id', user.id);
      if (error) {
        setAlertInfo({ title: 'something went wrong', message: 'could not save. try again.' });
        return;
      }
      router.replace('/onboarding/waitlisted');
    } finally {
      submit.release();
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView
        style={styles.kav}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.container}>
            <ProgressHead
              step={2}
              totalSteps={4}
              onBack={() => {
                hapticLight();
                router.replace('/onboarding/basics');
              }}
            />

            <View style={styles.body}>
              <Text style={styles.heading}>
                are you in the greater los angeles area?
              </Text>

              {!choseNo ? (
                <View style={styles.choices}>
                  <TouchableOpacity
                    style={styles.primaryButton}
                    onPress={() => handleLA(false)}
                    activeOpacity={0.9}
                    disabled={loading}
                  >
                    <Text style={styles.primaryButtonText}>yes, i live here</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.secondaryButton}
                    onPress={() => handleLA(true)}
                    activeOpacity={0.85}
                    disabled={loading}
                  >
                    <Text style={styles.secondaryButtonText}>i’m visiting LA</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.secondaryButton}
                    onPress={handleNo}
                    activeOpacity={0.85}
                    disabled={loading}
                  >
                    <Text style={styles.secondaryButtonText}>
                      no, bring washedup to my city
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.noBlock}>
                  <Text style={styles.notHereHeading}>
                    washedup is only in la right now.
                  </Text>
                  <Text style={styles.notHereBody}>
                    we’re expanding as fast as we can. add your city below and
                    we’ll let you know when we land.
                  </Text>

                  <TextInput
                    style={styles.input}
                    placeholder="your city"
                    placeholderTextColor={Colors.text3}
                    value={city}
                    onChangeText={setCity}
                    autoCapitalize="words"
                    editable={!loading}
                    returnKeyType="done"
                    onSubmitEditing={Keyboard.dismiss}
                    inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
                  />

                  <TouchableOpacity
                    style={[styles.primaryButton, loading && styles.primaryButtonDisabled]}
                    onPress={handleContinueFromNo}
                    activeOpacity={0.9}
                    disabled={loading}
                  >
                    {loading ? (
                      <ActivityIndicator color={Colors.surface} />
                    ) : (
                      <Text style={styles.primaryButtonText}>join waitlist</Text>
                    )}
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </View>
        </TouchableWithoutFeedback>
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
  safe: { flex: 1, backgroundColor: Colors.cream },
  kav: { flex: 1 },
  container: { flex: 1, paddingHorizontal: 28, paddingTop: 4, paddingBottom: 16 },

  body: {
    flex: 1,
    justifyContent: 'center',
  },

  heading: {
    fontFamily: Fonts.headline,
    fontSize: 28,
    lineHeight: 34,
    color: Colors.text1,
    marginBottom: 28,
  },

  choices: {
    gap: 14,
  },

  primaryButton: {
    height: 52,
    borderRadius: 8,
    backgroundColor: Colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.brandDeep,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.45,
    shadowRadius: 28,
    elevation: 6,
  },
  primaryButtonDisabled: {
    backgroundColor: Colors.borderWarm,
    shadowOpacity: 0,
    elevation: 0,
  },
  primaryButtonText: {
    fontFamily: Fonts.sansBold,
    fontSize: 16,
    color: Colors.surface,
    letterSpacing: 0.2,
  },

  secondaryButton: {
    height: 52,
    borderRadius: 8,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderWarm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    fontFamily: Fonts.sansMedium,
    fontSize: 15,
    color: Colors.text1,
  },

  noBlock: {
    gap: 16,
  },
  notHereHeading: {
    fontFamily: Fonts.headline,
    fontSize: 24,
    lineHeight: 30,
    color: Colors.text1,
  },
  notHereBody: {
    fontFamily: Fonts.sans,
    fontSize: 15,
    lineHeight: 22,
    color: Colors.text2,
  },
  input: {
    height: 56,
    backgroundColor: Colors.inputBg,
    borderWidth: 1,
    borderColor: Colors.borderWarm,
    borderRadius: 10,
    paddingHorizontal: 16,
    fontFamily: Fonts.sansMedium,
    fontSize: 16,
    color: Colors.text1,
  },
});
