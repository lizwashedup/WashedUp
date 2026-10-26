import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  LayoutAnimation,
  UIManager,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KEYBOARD_DONE_ACCESSORY_ID } from '../../../components/keyboard/KeyboardDoneBar';
import { StatusBar } from 'expo-status-bar';
import { router } from 'expo-router';
import { hapticLight } from '../../../lib/haptics';
import { BrandedAlert, type BrandedAlertButton } from '../../../components/BrandedAlert';
import { saveDraft, loadDraft, cancelPendingSave } from '../../../lib/onboardingDraft';
import { useOnboardingStepSave } from '../../../hooks/useOnboardingStepSave';
import { checkContent } from '../../../lib/contentFilter';
import Colors from '../../../constants/Colors';
import { Fonts } from '../../../constants/Typography';
import ProgressHead from '../../../components/onboarding/ProgressHead';

if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type Option = { label: string; value: string };

const OPTIONS: Option[] = [
  { label: 'facebook', value: 'facebook' },
  { label: 'reddit', value: 'reddit' },
  { label: 'instagram', value: 'instagram' },
  { label: 'threads', value: 'threads' },
  { label: 'tiktok', value: 'tiktok' },
  { label: 'bumble bff', value: 'bumble' },
  { label: 'nextdoor', value: 'nextdoor' },
  { label: 'google', value: 'google' },
  { label: 'ai (chatgpt, etc.)', value: 'ai' },
  { label: 'press', value: 'press' },
  // Label is lexicon-safe; the stored value keeps its original spelling for analytics continuity.
  { label: 'someone I know', value: 'friend' },
  { label: 'other', value: 'other' },
];

type ReferralDraft = { selected: string | null; otherText: string };

export default function OnboardingReferralScreen() {
  const [selected, setSelected] = useState<string | null>(null);
  const [otherText, setOtherText] = useState('');
  const [draftLoaded, setDraftLoaded] = useState(false);
  const { loading, saveError, clearSaveError, save, retire } = useOnboardingStepSave('referral');
  const [alertInfo, setAlertInfo] = useState<{
    title: string;
    message: string;
    buttons?: BrandedAlertButton[];
  } | null>(null);
  const otherInputRef = useRef<TextInput>(null);

  const isOther = selected === 'other';
  const canContinue =
    selected !== null && (!isOther || otherText.trim().length > 0);

  const handleSelect = (value: string) => {
    hapticLight();
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setSelected(value);
  };

  useEffect(() => {
    if (isOther) {
      const t = setTimeout(() => otherInputRef.current?.focus(), 120);
      return () => clearTimeout(t);
    }
  }, [isOther]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const draft = await loadDraft<ReferralDraft>('referral');
      if (!cancelled && draft) {
        // Validate against the real option list before trusting a value read
        // back from disk: `selected` skips content filtering for every value
        // except 'other' (see handleContinue), so an unrecognized restored
        // value must never reach that branch un-checked.
        if (draft.selected && OPTIONS.some((o) => o.value === draft.selected)) {
          setSelected(draft.selected);
        }
        if (draft.otherText) setOtherText(draft.otherText);
      }
      if (!cancelled) setDraftLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!draftLoaded) return;
    saveDraft<ReferralDraft>('referral', { selected, otherText });
    return () => cancelPendingSave('referral');
  }, [draftLoaded, selected, otherText]);

  const handleContinue = async () => {
    if (!canContinue || loading) return;
    let referralValue: string;
    if (isOther) {
      const trimmed = otherText.trim();
      const filter = checkContent(trimmed);
      if (!filter.ok) {
        setAlertInfo({ title: 'content not allowed', message: filter.reason ?? 'please try different wording.' });
        return;
      }
      referralValue = `other: ${trimmed}`;
    } else {
      referralValue = selected as string;
    }
    hapticLight();
    await save({ referral_source: referralValue, onboarding_status: 'photo' }, '/onboarding/photo');
  };

  // Real bug, found and fixed 2026-09-01: this screen used to render and accept
  // input immediately, with only the SAVE gated on draftLoaded. A slow auth
  // resolution meant loadDraft() could land well after the user had already
  // picked an option, and its setSelected/setOtherText calls silently
  // overwrote whatever they'd already chosen. Gating render itself on
  // draftLoaded closes that by construction: nothing can be picked before the
  // restore has already had its say. (basics.tsx solves the same problem a
  // different way -- it deliberately keeps its own watchdog-forced early
  // render, so it instead tracks whether the user has edited anything and
  // skips a late restore.)
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
        keyboardVerticalOffset={0}
      >
        <View style={styles.container}>
          <ProgressHead step={3} totalSteps={5} onBack={() => { retire(); router.replace('/onboarding/la-check'); }} />

          <ScrollView
            decelerationRate="normal"
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.gap20} />
            <Text style={styles.heading}>how’d you find us?</Text>
            <Text style={styles.subline}>this helps us know where to show up.</Text>

            <View style={styles.gap28} />

            <View style={styles.pillWrap}>
              {OPTIONS.map((opt) => {
                const active = selected === opt.value;
                return (
                  <TouchableOpacity
                    key={opt.value}
                    style={[styles.pill, active && styles.pillSelected]}
                    onPress={() => handleSelect(opt.value)}
                    activeOpacity={0.85}
                  >
                    <Text
                      style={[styles.pillText, active && styles.pillTextSelected]}
                    >
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {isOther && (
              <View style={styles.otherInputWrap}>
                <TextInput
                  ref={otherInputRef}
                  style={styles.otherInput}
                  placeholder="tell us more"
                  placeholderTextColor={Colors.text3}
                  value={otherText}
                  onChangeText={setOtherText}
                  editable={!loading}
                  returnKeyType="done"
                  onSubmitEditing={Keyboard.dismiss}
                  inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
                />
              </View>
            )}
          </ScrollView>

          <TouchableOpacity
            style={[styles.cta, (!canContinue || loading) && styles.ctaDisabled]}
            onPress={handleContinue}
            activeOpacity={0.9}
            disabled={!canContinue || loading}
          >
            {loading ? (
              <ActivityIndicator color={Colors.surface} />
            ) : (
              <Text style={[styles.ctaText, !canContinue && styles.ctaTextDisabled]}>
                continue
              </Text>
            )}
          </TouchableOpacity>
        </View>
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
  container: { flex: 1, paddingHorizontal: 28, paddingBottom: 16 },

  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 24 },
  gap20: { height: 20 },
  gap28: { height: 28 },

  heading: {
    fontFamily: Fonts.headline,
    fontSize: 32,
    lineHeight: 36,
    color: Colors.text1,
    marginTop: 16,
  },
  subline: {
    fontFamily: Fonts.sans,
    fontSize: 15,
    lineHeight: 22,
    color: Colors.text2,
    marginTop: 6,
  },

  pillWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  pill: {
    height: 40,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.borderWarm,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillSelected: {
    backgroundColor: Colors.brandSoft,
    borderColor: Colors.brand,
  },
  pillText: {
    fontFamily: Fonts.sansMedium,
    fontSize: 14,
    color: Colors.text1,
  },
  pillTextSelected: {
    fontFamily: Fonts.sansSemibold,
    color: Colors.brandDeep,
  },

  otherInputWrap: {
    marginTop: 20,
  },
  otherInput: {
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

  cta: {
    height: 52,
    borderRadius: 8,
    backgroundColor: Colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    shadowColor: Colors.brandDeep,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.45,
    shadowRadius: 28,
    elevation: 6,
  },
  ctaDisabled: {
    backgroundColor: Colors.borderWarm,
    shadowOpacity: 0,
    elevation: 0,
  },
  ctaText: {
    fontFamily: Fonts.sansBold,
    fontSize: 16,
    color: Colors.surface,
    letterSpacing: 0.2,
  },
  ctaTextDisabled: { color: Colors.text3 },
});
