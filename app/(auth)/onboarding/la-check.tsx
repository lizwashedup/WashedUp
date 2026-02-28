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
import * as Haptics from 'expo-haptics';
import { ChevronLeft } from 'lucide-react-native';
import { supabase } from '../../../lib/supabase';
import Colors from '../../../constants/Colors';

export default function OnboardingLACheckScreen() {
  const routerBack = useRouter();
  const [choseNo, setChoseNo] = useState(false);
  const [city, setCity] = useState('');
  const [loading, setLoading] = useState(false);

  const handleYes = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      await supabase.from('profiles').update({ city: 'Los Angeles' }).eq('id', user.id);
      router.push('/onboarding/photo');
    } finally {
      setLoading(false);
    }
  };

  const handleNo = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setChoseNo(true);
  };

  const handleContinueFromNo = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      await supabase.from('profiles').update({ city: city.trim() || 'Other' }).eq('id', user.id);
      router.push('/onboarding/photo');
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
            <View style={styles.progressWrap}>
              <View style={[styles.progressBar, { width: '50%' }]} />
            </View>
            <View style={styles.headerRow}>
              <TouchableOpacity
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); routerBack.back(); }}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                style={styles.backButton}
              >
                <ChevronLeft size={28} color={Colors.textDark} />
              </TouchableOpacity>
            </View>

            <Text style={styles.heading}>Are you in the greater Los Angeles area?</Text>
            <View style={styles.gap32} />

            {!choseNo ? (
              <>
                <TouchableOpacity
                  style={styles.primaryButton}
                  onPress={handleYes}
                  onPressIn={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}
                  activeOpacity={0.9}
                  disabled={loading}
                >
                  <Text style={styles.primaryButtonText}>Yes, I&apos;m in LA</Text>
                </TouchableOpacity>
                <View style={styles.gap16} />
                <TouchableOpacity
                  style={styles.secondaryButton}
                  onPress={handleNo}
                  onPressIn={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}
                  activeOpacity={0.9}
                  disabled={loading}
                >
                  <Text style={styles.secondaryButtonText}>Not yet</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={styles.notLaText}>
                  WashedUp is LA only for now. We&apos;ll let you know when we expand.
                </Text>
                <View style={styles.gap20} />
                <Text style={styles.label}>What city are you in?</Text>
                <View style={styles.gap8} />
                <TextInput
                  style={styles.input}
                  placeholder="City name"
                  placeholderTextColor={Colors.textMedium}
                  value={city}
                  onChangeText={setCity}
                  autoCapitalize="words"
                  editable={!loading}
                />
                <View style={styles.gap24} />
                <TouchableOpacity
                  style={styles.primaryButton}
                  onPress={handleContinueFromNo}
                  onPressIn={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}
                  activeOpacity={0.9}
                  disabled={loading}
                >
                  <Text style={styles.primaryButtonText}>Continue</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.backgroundCream },
  keyboardView: { flex: 1 },
  container: { flex: 1, paddingHorizontal: 24 },
  progressWrap: {
    height: 4,
    backgroundColor: Colors.border,
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressBar: { height: '100%', backgroundColor: Colors.primaryOrange, borderRadius: 2 },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 24 },
  backButton: { padding: 4 },
  heading: { fontSize: 22, fontWeight: '700', color: Colors.textDark },
  gap32: { height: 32 },
  gap24: { height: 24 },
  gap20: { height: 20 },
  gap16: { height: 16 },
  gap8: { height: 8 },
  primaryButton: {
    height: 52,
    borderRadius: 14,
    backgroundColor: Colors.primaryOrange,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: Colors.primaryOrange,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  primaryButtonText: { fontSize: 17, fontWeight: '700', color: '#FFFFFF' },
  secondaryButton: {
    height: 52,
    borderRadius: 14,
    backgroundColor: Colors.cardBackground,
    borderWidth: 1,
    borderColor: Colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  secondaryButtonText: { fontSize: 17, fontWeight: '600', color: Colors.textDark },
  notLaText: { fontSize: 16, color: Colors.textDark, lineHeight: 24 },
  label: { fontSize: 16, color: Colors.textDark, fontWeight: '500' },
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
});
