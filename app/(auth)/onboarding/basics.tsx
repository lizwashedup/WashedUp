import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Modal,
  ScrollView,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { supabase } from '../../../lib/supabase';
import Colors from '../../../constants/Colors';

const GENDERS = ['Woman', 'Man', 'Non-binary'] as const;
type Gender = (typeof GENDERS)[number];

// Map UI labels to profiles.gender_type enum values (lowercase/snake_case in DB)
const GENDER_TO_ENUM: Record<Gender, string> = {
  Woman: 'woman',
  Man: 'man',
  'Non-binary': 'non_binary',
};

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function getYears() {
  const currentYear = new Date().getFullYear();
  const years: number[] = [];
  for (let y = currentYear - 18; y >= currentYear - 100; y--) years.push(y);
  return years;
}

function is18Plus(birthday: Date): boolean {
  const today = new Date();
  let age = today.getFullYear() - birthday.getFullYear();
  const m = today.getMonth() - birthday.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthday.getDate())) age--;
  return age >= 18;
}

export default function OnboardingBasicsScreen() {
  const [birthday, setBirthday] = useState<Date | null>(null);
  const [gender, setGender] = useState<Gender | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [dateError, setDateError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const years = getYears();
  const [tempMonth, setTempMonth] = useState(0);
  const [tempDay, setTempDay] = useState(1);
  const [tempYear, setTempYear] = useState(years[0]);

  const canContinue = birthday && gender && !dateError;

  const openDatePicker = () => {
    if (birthday) {
      setTempYear(birthday.getFullYear());
      setTempMonth(birthday.getMonth());
      setTempDay(birthday.getDate());
    }
    setShowDatePicker(true);
    setDateError(null);
  };

  const confirmDate = () => {
    const d = new Date(tempYear, tempMonth, tempDay);
    setBirthday(d);
    if (!is18Plus(d)) {
      setDateError('You must be 18 or older to use WashedUp');
    } else {
      setDateError(null);
    }
    setShowDatePicker(false);
  };

  const formatBirthday = (d: Date | null) => {
    if (!d) return 'Select your birthday';
    return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  };

  const handleContinue = async () => {
    if (!canContinue || !birthday || !gender) return;
    setSaveError(null);
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setSaveError('Please sign in again.');
        return;
      }
      const y = birthday.getFullYear();
      const m = String(birthday.getMonth() + 1).padStart(2, '0');
      const d = String(birthday.getDate()).padStart(2, '0');
      const isoBirthday = `${y}-${m}-${d}`;
      const { error } = await supabase
        .from('profiles')
        .update({
          birthday: isoBirthday,
          gender: GENDER_TO_ENUM[gender],
        })
        .eq('id', user.id);
      if (error) throw error;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      router.push('/onboarding/la-check');
    } catch (e: unknown) {
      const message = e && typeof e === 'object' && 'message' in e ? String((e as { message: string }).message) : 'Something went wrong. Please try again.';
      setSaveError(message);
    } finally {
      setLoading(false);
    }
  };

  const selectGender = (g: Gender) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setGender(g);
  };

  const daysInMonth = new Date(tempYear, tempMonth + 1, 0).getDate();
  const safeDay = Math.min(tempDay, daysInMonth);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <StatusBar style="dark" />
      <View style={styles.container}>
        <View style={styles.topRow}>
          <View style={styles.progressWrap}>
            <View style={[styles.progressBar, { width: '25%' }]} />
          </View>
          <TouchableOpacity onPress={handleSignOut} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Text style={styles.signOutLink}>Sign out</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.stepText}>Step 1 of 4</Text>

        <Text style={styles.heading}>Tell us about yourself</Text>
        <View style={styles.gap24} />

        <TouchableOpacity
          style={[styles.input, dateError ? styles.inputError : null]}
          onPress={openDatePicker}
          activeOpacity={0.8}
        >
          <Text style={[styles.inputText, !birthday && styles.placeholder]}>
            {formatBirthday(birthday)}
          </Text>
        </TouchableOpacity>
        {dateError ? <Text style={styles.errorText}>{dateError}</Text> : <View style={styles.errorPlaceholder} />}
        <View style={styles.gap20} />

        <Text style={styles.label}>Gender</Text>
        <View style={styles.gap12} />
        <View style={styles.pillRow}>
          {GENDERS.map((g) => (
            <TouchableOpacity
              key={g}
              style={[styles.pill, gender === g && styles.pillSelected]}
              onPress={() => selectGender(g)}
              activeOpacity={0.8}
            >
              <Text style={[styles.pillText, gender === g && styles.pillTextSelected]}>{g}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.spacer} />
        <TouchableOpacity
          style={[styles.primaryButton, (!canContinue || loading) && styles.primaryButtonDisabled]}
          onPress={handleContinue}
          onPressIn={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}
          activeOpacity={0.9}
          disabled={!canContinue || loading}
        >
          <Text style={styles.primaryButtonText}>Continue</Text>
        </TouchableOpacity>
        {saveError ? <Text style={[styles.errorText, { marginTop: 8 }]}>{saveError}</Text> : <View style={styles.errorPlaceholder} />}
      </View>

      <Modal visible={showDatePicker} transparent animationType="slide">
        <Pressable style={styles.modalOverlay} onPress={() => setShowDatePicker(false)}>
          <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>Select birthday</Text>
            <View style={styles.pickerRow}>
              <ScrollView style={styles.pickerScroll} showsVerticalScrollIndicator={false}>
                {MONTHS.map((m, i) => (
                  <Pressable
                    key={m}
                    style={[styles.pickerItem, tempMonth === i && styles.pickerItemSelected]}
                    onPress={() => setTempMonth(i)}
                  >
                    <Text style={[styles.pickerItemText, tempMonth === i && styles.pickerItemTextSelected]}>{m}</Text>
                  </Pressable>
                ))}
              </ScrollView>
              <ScrollView style={styles.pickerScroll} showsVerticalScrollIndicator={false}>
                {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => (
                  <Pressable
                    key={day}
                    style={[styles.pickerItem, safeDay === day && styles.pickerItemSelected]}
                    onPress={() => setTempDay(day)}
                  >
                    <Text style={[styles.pickerItemText, safeDay === day && styles.pickerItemTextSelected]}>{day}</Text>
                  </Pressable>
                ))}
              </ScrollView>
              <ScrollView style={styles.pickerScroll} showsVerticalScrollIndicator={false}>
                {years.map((y) => (
                  <Pressable
                    key={y}
                    style={[styles.pickerItem, tempYear === y && styles.pickerItemSelected]}
                    onPress={() => setTempYear(y)}
                  >
                    <Text style={[styles.pickerItemText, tempYear === y && styles.pickerItemTextSelected]}>{y}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
            <TouchableOpacity style={styles.modalButton} onPress={confirmDate}>
              <Text style={styles.primaryButtonText}>Done</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.backgroundCream },
  container: { flex: 1, paddingHorizontal: 24 },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  progressWrap: {
    flex: 1,
    height: 4,
    backgroundColor: Colors.border,
    borderRadius: 2,
    overflow: 'hidden',
    marginRight: 12,
  },
  signOutLink: {
    fontSize: 14,
    color: Colors.textLight,
  },
  progressBar: {
    height: '100%',
    backgroundColor: Colors.primaryOrange,
    borderRadius: 2,
  },
  stepText: { fontSize: 13, color: Colors.textLight, marginBottom: 24 },
  heading: { fontSize: 22, fontWeight: '700', color: Colors.textDark },
  gap24: { height: 24 },
  gap20: { height: 20 },
  gap12: { height: 12 },
  input: {
    height: 52,
    backgroundColor: Colors.cardBackground,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 14,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  inputError: { borderColor: Colors.errorRed, borderWidth: 1.5 },
  inputText: { fontSize: 16, color: Colors.textDark },
  placeholder: { color: Colors.textLight },
  errorText: { fontSize: 14, color: Colors.errorRed, marginTop: 4 },
  errorPlaceholder: { height: 22, marginTop: 4 },
  label: { fontSize: 16, color: Colors.textDark, fontWeight: '500' },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  pill: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    backgroundColor: Colors.cardBackground,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 14,
  },
  pillSelected: { backgroundColor: Colors.primaryOrange, borderColor: Colors.primaryOrange },
  pillText: { fontSize: 16, color: Colors.textDark },
  pillTextSelected: { color: '#FFFFFF', fontWeight: '600' },
  spacer: { flex: 1 },
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
  primaryButtonDisabled: { opacity: 0.5 },
  primaryButtonText: { fontSize: 17, fontWeight: '700', color: '#FFFFFF' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: Colors.backgroundCream,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: Colors.textDark, marginBottom: 16 },
  pickerRow: { flexDirection: 'row', gap: 12, maxHeight: 200, marginBottom: 20 },
  pickerScroll: { flex: 1 },
  pickerItem: {
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  pickerItemSelected: { backgroundColor: Colors.primaryOrange, borderRadius: 8 },
  pickerItemText: { fontSize: 16, color: Colors.textDark },
  pickerItemTextSelected: { color: '#FFFFFF' },
  modalButton: {
    height: 52,
    borderRadius: 14,
    backgroundColor: Colors.primaryOrange,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
