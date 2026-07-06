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
import { supabase } from '../../../lib/supabase';
import { getUserBounded } from '../../../lib/authGate';
import { useSubmitGuard } from '../../../hooks/useSubmitGuard';
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

export default function OnboardingReferralScreen() {
  const [selected, setSelected] = useState<string | null>(null);
  const [otherText, setOtherText] = useState('');
  const [loading, setLoading] = useState(false);
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

  const submit = useSubmitGuard();

  const handleContinue = async () => {
    if (!canContinue || loading) return;
    if (!submit.tryAcquire()) return;
    hapticLight();
    setLoading(true);
    try {
      const { user, resolved } = await getUserBounded();
      if (!user) {
        if (!resolved) {
          // Transient (timeout/network): do NOT sign out a valid session.
          setAlertInfo({
            title: 'something went wrong',
            message: "couldn't reach the server. try again.",
          });
          return;
        }
        setAlertInfo({
          title: 'session expired',
          message: 'please sign in again.',
        });
        await supabase.auth.signOut();
        return;
      }
      let referralValue: string;
      if (isOther) {
        const trimmed = otherText.trim();
        const filter = checkContent(trimmed);
        if (!filter.ok) {
          setAlertInfo({
            title: 'content not allowed',
            message: filter.reason ?? 'please try different wording.',
          });
          return;
        }
        referralValue = `other: ${trimmed}`;
      } else {
        referralValue = selected as string;
      }
      // Smart-advance preserves status if a mid-flow user was bounced
      // back here from photo (older clients skipped referral).
      const { data: existing } = await supabase
        .from('profiles')
        .select('onboarding_status')
        .eq('id', user.id)
        .single();
      const currentStatus = existing?.onboarding_status ?? 'referral';
      const nextStatus =
        currentStatus === 'photo'
          ? currentStatus
          : 'photo';
      const { error } = await supabase
        .from('profiles')
        .update({
          referral_source: referralValue,
          onboarding_status: nextStatus,
        })
        .eq('id', user.id);
      if (error) {
        setAlertInfo({
          title: 'something went wrong',
          message: 'could not save. please try again.',
        });
        return;
      }
      router.replace('/onboarding/photo');
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
        keyboardVerticalOffset={0}
      >
        <View style={styles.container}>
          <ProgressHead step={3} totalSteps={4} onBack={() => router.replace('/onboarding/la-check')} />

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
