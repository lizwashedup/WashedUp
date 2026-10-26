import { useEffect, useState } from 'react';
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
import { saveDraft, loadDraft, cancelPendingSave } from '../../../lib/onboardingDraft';
import { useOnboardingStepSave } from '../../../hooks/useOnboardingStepSave';
import { checkContent } from '../../../lib/contentFilter';
import Colors from '../../../constants/Colors';
import { Fonts } from '../../../constants/Typography';
import ProgressHead from '../../../components/onboarding/ProgressHead';

type LACheckDraft = { choseNo: boolean; city: string };

export default function OnboardingLACheckScreen() {
  const [choseNo, setChoseNo] = useState(false);
  const [city, setCity] = useState('');
  const [draftLoaded, setDraftLoaded] = useState(false);
  const { loading, saveError, clearSaveError, save, retire } = useOnboardingStepSave('laCheck');
  const [alertInfo, setAlertInfo] = useState<{
    title: string;
    message: string;
    buttons?: BrandedAlertButton[];
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const draft = await loadDraft<LACheckDraft>('laCheck');
      if (!cancelled && draft) {
        if (draft.choseNo) setChoseNo(true);
        if (draft.city) setCity(draft.city);
      }
      if (!cancelled) setDraftLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!draftLoaded) return;
    saveDraft<LACheckDraft>('laCheck', { choseNo, city });
    return () => cancelPendingSave('laCheck');
  }, [draftLoaded, choseNo, city]);

  const handleLA = async (isVisitor: boolean) => {
    hapticLight();
    await save({ city: 'Los Angeles', is_visitor: isVisitor, onboarding_status: 'referral' }, '/onboarding/referral');
  };

  const handleNo = () => {
    hapticLight();
    setChoseNo(true);
  };

  const handleContinueFromNo = async () => {
    if (loading) return;
    const trimmedCity = city.trim() || 'Other';
    const cityFilter = checkContent(trimmedCity);
    if (!cityFilter.ok) {
      setAlertInfo({ title: 'content not allowed', message: cityFilter.reason ?? 'please try a different city name.' });
      return;
    }
    hapticLight();
    await save({ city: trimmedCity, onboarding_status: 'waitlisted' }, '/onboarding/waitlisted');
  };

  // Real bug, found and fixed 2026-09-01: this screen used to render and accept
  // input immediately, with only the SAVE gated on draftLoaded. A slow auth
  // resolution meant loadDraft() could land well after the user had already
  // started answering, and its setChoseNo/setCity calls silently overwrote
  // whatever they'd already typed. Gating render itself on draftLoaded closes
  // that by construction: nothing can be typed before the restore has already
  // had its say. (basics.tsx solves the same problem a different way -- it
  // deliberately keeps its own watchdog-forced early render, so it instead
  // tracks whether the user has edited anything and skips a late restore.)
  if (!draftLoaded) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <StatusBar style="dark" />
        <View style={styles.bootstrapWrap}>
          <ActivityIndicator color={Colors.brand} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView
        style={styles.kav}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <View style={styles.container}>
            <ProgressHead
              step={2}
              totalSteps={5}
              onBack={() => {
                retire();
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
                    accessibilityRole="button"
                    style={styles.primaryButton}
                    onPress={() => handleLA(false)}
                    activeOpacity={0.9}
                    disabled={loading}
                  >
                    <Text numberOfLines={1} style={styles.primaryButtonText}>i live here</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    accessibilityRole="button"
                    style={styles.secondaryButton}
                    onPress={() => handleLA(true)}
                    activeOpacity={0.85}
                    disabled={loading}
                  >
                    <Text numberOfLines={1} style={styles.secondaryButtonText}>visiting LA</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    accessibilityRole="button"
                    style={styles.secondaryButton}
                    onPress={handleNo}
                    activeOpacity={0.85}
                    disabled={loading}
                  >
                    <Text numberOfLines={1} style={styles.secondaryButtonText}>
                      another city
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
                    accessibilityLabel="Your city"
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
                    accessibilityRole="button"
                    accessibilityLabel="Join waitlist"
                    style={[styles.primaryButton, loading && styles.primaryButtonDisabled]}
                    onPress={handleContinueFromNo}
                    activeOpacity={0.9}
                    disabled={loading}
                  >
                    {loading ? (
                      <ActivityIndicator color={Colors.surface} />
                    ) : (
                      <Text numberOfLines={1} style={styles.primaryButtonText}>join waitlist</Text>
                    )}
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </View>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
      <BrandedAlert
        visible={!!alertInfo || !!saveError}
        title={alertInfo?.title ?? 'something went wrong'}
        message={alertInfo?.message ?? saveError ?? undefined}
        buttons={alertInfo?.buttons}
        onClose={() => { setAlertInfo(null); clearSaveError(); }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.cream },
  kav: { flex: 1 },
  bootstrapWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
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
