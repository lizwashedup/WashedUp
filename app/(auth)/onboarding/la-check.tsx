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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { router, useRouter } from 'expo-router';
import { hapticLight, hapticMedium, hapticHeavy, hapticSelection, hapticSuccess, hapticWarning, hapticError } from '../../../lib/haptics';
import { ChevronLeft } from 'lucide-react-native';
import { BrandedAlert, type BrandedAlertButton } from '../../../components/BrandedAlert';
import { supabase } from '../../../lib/supabase';
import { checkContent } from '../../../lib/contentFilter';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';

export default function OnboardingLACheckScreen() {
  const routerBack = useRouter();
  const [choseNo, setChoseNo] = useState(false);
  const [city, setCity] = useState('');
  const [loading, setLoading] = useState(false);
  const [alertInfo, setAlertInfo] = useState<{ title: string; message: string; buttons?: BrandedAlertButton[] } | null>(null);

  const handleYes = async () => {
    hapticLight();
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setAlertInfo({ title: 'Session expired', message: 'Please sign in again.' });
        await supabase.auth.signOut();
        return;
      }
      const { error } = await supabase.from('profiles').update({ city: 'Los Angeles', onboarding_status: 'referral' }).eq('id', user.id);
      if (error) { setAlertInfo({ title: 'Something went wrong', message: 'Could not save. Please try again.' }); return; }
      router.push('/onboarding/referral');
    } finally {
      setLoading(false);
    }
  };

  const handleNo = () => {
    hapticLight();
    setChoseNo(true);
  };

  const handleContinueFromNo = async () => {
    hapticLight();
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setAlertInfo({ title: 'Session expired', message: 'Please sign in again.' });
        await supabase.auth.signOut();
        return;
      }
      const trimmedCity = city.trim() || 'Other';
      const cityFilter = checkContent(trimmedCity);
      if (!cityFilter.ok) {
        setAlertInfo({ title: 'Content not allowed', message: cityFilter.reason ?? 'Please try a different city name.' });
        return;
      }
      const { error } = await supabase.from('profiles').update({ city: trimmedCity, onboarding_status: 'waitlisted' }).eq('id', user.id);
      if (error) { setAlertInfo({ title: 'Something went wrong', message: 'Could not save. Please try again.' }); return; }
      router.push('/onboarding/waitlisted');
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
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.container}>
            <View style={styles.progressWrap}>
              <View style={[styles.progressBar, { width: '50%' }]} />
            </View>
            <View style={styles.headerRow}>
              <TouchableOpacity
                onPress={() => { hapticLight(); routerBack.back(); }}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                style={styles.backButton}
              >
                <ChevronLeft size={28} color={Colors.asphalt} />
              </TouchableOpacity>
            </View>

            <Text style={styles.heading}>Are you in the greater Los Angeles area?</Text>
            <View style={styles.gap32} />

            {!choseNo ? (
              <>
                <TouchableOpacity
                  style={styles.primaryButton}
                  onPress={handleYes}
                  onPressIn={() => hapticLight()}
                  activeOpacity={0.9}
                  disabled={loading}
                >
                  <Text style={styles.primaryButtonText}>Yes, I&apos;m in LA</Text>
                </TouchableOpacity>
                <View style={styles.gap16} />
                <TouchableOpacity
                  style={styles.secondaryButton}
                  onPress={handleNo}
                  onPressIn={() => hapticLight()}
                  activeOpacity={0.9}
                  disabled={loading}
                >
                  <Text style={styles.secondaryButtonText}>No, somewhere else</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={styles.waitlistHeading}>washedup is only in LA right now.</Text>
                <View style={styles.gap16} />
                <Text style={styles.notLaText}>
                  We&apos;re expanding as fast as we can. If you&apos;d like washedup in your city, add it below to be added to the waitlist!
                </Text>
                <View style={styles.gap24} />
                <TextInput
                  style={styles.input}
                  placeholder="Your city"
                  placeholderTextColor={Colors.textLight}
                  value={city}
                  onChangeText={setCity}
                  autoCapitalize="words"
                  editable={!loading}
                />
                <View style={styles.gap24} />
                <TouchableOpacity
                  style={styles.primaryButton}
                  onPress={handleContinueFromNo}
                  onPressIn={() => hapticLight()}
                  activeOpacity={0.9}
                  disabled={loading}
                >
                  <Text style={styles.primaryButtonText}>Join Waitlist</Text>
                </TouchableOpacity>
              </>
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
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.parchment },
  keyboardView: { flex: 1 },
  container: { flex: 1, paddingHorizontal: 24 },
  progressWrap: {
    height: 4,
    backgroundColor: Colors.border,
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressBar: { height: '100%', backgroundColor: Colors.terracotta, borderRadius: 2 },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 24 },
  backButton: { padding: 4 },
  heading: { fontFamily: Fonts.sansBold, fontSize: FontSizes.displayMD, color: Colors.asphalt },
  gap32: { height: 32 },
  gap24: { height: 24 },
  gap20: { height: 20 },
  gap16: { height: 16 },
  gap8: { height: 8 },
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
  primaryButtonText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.displaySM, color: Colors.white },
  secondaryButton: {
    height: 52,
    borderRadius: 14,
    backgroundColor: Colors.cardBg,
    borderWidth: 1,
    borderColor: Colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  secondaryButtonText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.displaySM, color: Colors.asphalt },
  waitlistHeading: { fontFamily: Fonts.displayBold, fontSize: FontSizes.displayMD, color: Colors.asphalt },
  notLaText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyLG, color: Colors.textMedium, lineHeight: 24 },
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
});
