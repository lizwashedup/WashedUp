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
import { StatusBar } from 'expo-status-bar';
import { router, useRouter } from 'expo-router';
import { hapticLight } from '../../../lib/haptics';
import { ChevronLeft } from 'lucide-react-native';
import { BrandedAlert, type BrandedAlertButton } from '../../../components/BrandedAlert';
import { supabase } from '../../../lib/supabase';
import { checkContent } from '../../../lib/contentFilter';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';

if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type Option = { label: string; value: string };

const OPTIONS: Option[] = [
  { label: 'Facebook', value: 'facebook' },
  { label: 'Reddit', value: 'reddit' },
  { label: 'Instagram', value: 'instagram' },
  { label: 'Threads', value: 'threads' },
  { label: 'TikTok', value: 'tiktok' },
  { label: 'Bumble BFF', value: 'bumble' },
  { label: 'Nextdoor', value: 'nextdoor' },
  { label: 'Google', value: 'google' },
  { label: 'AI (ChatGPT, etc.)', value: 'ai' },
  { label: 'Press', value: 'press' },
  { label: 'Friend', value: 'friend' },
  { label: 'Other', value: 'other' },
];

export default function OnboardingReferralScreen() {
  const routerBack = useRouter();
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

  const handleContinue = async () => {
    if (!canContinue || loading) return;
    hapticLight();
    setLoading(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setAlertInfo({
          title: 'Session expired',
          message: 'Please sign in again.',
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
            title: 'Content not allowed',
            message: filter.reason ?? 'Please try different wording.',
          });
          return;
        }
        referralValue = `other: ${trimmed}`;
      } else {
        referralValue = selected as string;
      }
      // Smart-advance: in the normal flow the user arrives here with
      // status='referral' and we advance to 'photo'. When the routing
      // backstop bounced a mid-flow user here from 'photo' or 'vibes'
      // (because their older client skipped the referral step), we
      // preserve their existing status and resume at that step instead
      // of regressing them.
      const { data: existing } = await supabase
        .from('profiles')
        .select('onboarding_status')
        .eq('id', user.id)
        .single();
      const currentStatus = existing?.onboarding_status ?? 'referral';
      const nextStatus =
        currentStatus === 'photo' || currentStatus === 'vibes'
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
          title: 'Something went wrong',
          message: 'Could not save. Please try again.',
        });
        return;
      }
      const destPath =
        nextStatus === 'vibes' ? '/onboarding/vibes' : '/onboarding/photo';
      router.push(destPath);
    } finally {
      setLoading(false);
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
        <View style={styles.container}>
          <View style={styles.progressWrap}>
            <View style={[styles.progressBar, { width: '60%' }]} />
          </View>
          <View style={styles.headerRow}>
            <TouchableOpacity
              onPress={() => {
                hapticLight();
                routerBack.back();
              }}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              style={styles.backButton}
            >
              <ChevronLeft size={28} color={Colors.asphalt} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.heading}>how did you hear about us?</Text>
            <Text style={styles.subtext}>
              this helps us know where to show up
            </Text>

            <View style={styles.gap32} />

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
                      style={[
                        styles.pillText,
                        active && styles.pillTextSelected,
                      ]}
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
                  placeholderTextColor={Colors.warmGray}
                  value={otherText}
                  onChangeText={setOtherText}
                  editable={!loading}
                  returnKeyType="done"
                  onSubmitEditing={Keyboard.dismiss}
                />
              </View>
            )}
          </ScrollView>

          <TouchableOpacity
            style={[
              styles.primaryButton,
              (!canContinue || loading) && styles.primaryButtonDisabled,
            ]}
            onPress={handleContinue}
            onPressIn={() => {
              if (canContinue) hapticLight();
            }}
            activeOpacity={0.9}
            disabled={!canContinue || loading}
          >
            {loading ? (
              <ActivityIndicator color={Colors.white} />
            ) : (
              <Text style={styles.primaryButtonText}>Continue</Text>
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
  safe: { flex: 1, backgroundColor: Colors.parchment },
  keyboardView: { flex: 1 },
  container: { flex: 1, paddingHorizontal: 24, paddingBottom: 16 },
  progressWrap: {
    height: 4,
    backgroundColor: Colors.border,
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressBar: {
    height: '100%',
    backgroundColor: Colors.terracotta,
    borderRadius: 2,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  backButton: { padding: 4 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 24 },
  heading: {
    fontFamily: Fonts.displayItalic,
    fontSize: FontSizes.displayMD,
    color: Colors.asphalt,
  },
  subtext: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.warmGray,
    marginTop: 6,
    lineHeight: 20,
  },
  gap32: { height: 32 },
  pillWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  pill: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: Colors.terracotta,
    backgroundColor: Colors.white,
  },
  pillSelected: {
    backgroundColor: Colors.terracotta,
  },
  pillText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyMD,
    color: Colors.terracotta,
  },
  pillTextSelected: {
    color: Colors.white,
  },
  otherInputWrap: {
    marginTop: 24,
  },
  otherInput: {
    height: 44,
    borderBottomWidth: 1.5,
    borderBottomColor: Colors.terracotta,
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyLG,
    color: Colors.asphalt,
    paddingHorizontal: 0,
    paddingVertical: 8,
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
    marginTop: 8,
  },
  primaryButtonDisabled: { opacity: 0.5 },
  primaryButtonText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.displaySM,
    color: Colors.white,
  },
});
