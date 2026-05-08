import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Modal,
  ScrollView,
  Pressable,
  KeyboardAvoidingView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KEYBOARD_DONE_ACCESSORY_ID } from '../../../components/keyboard/KeyboardDoneBar';
import { StatusBar } from 'expo-status-bar';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { hapticLight } from '../../../lib/haptics';
import { supabase } from '../../../lib/supabase';
import { unauthedRoute } from '../../../lib/authRouting';
import { useSubmitGuard } from '../../../hooks/useSubmitGuard';
import Colors from '../../../constants/Colors';
import { Fonts } from '../../../constants/Typography';
import ProgressHead from '../../../components/onboarding/ProgressHead';

const GENDERS = ['woman', 'man', 'non-binary'] as const;
type Gender = (typeof GENDERS)[number];

const GENDER_TO_ENUM: Record<Gender, string> = {
  woman: 'woman',
  man: 'man',
  'non-binary': 'non_binary',
};

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
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
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [birthday, setBirthday] = useState<Date | null>(null);
  const [gender, setGender] = useState<Gender | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [dateError, setDateError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(true);

  const years = getYears();
  const [tempMonth, setTempMonth] = useState<number | null>(null);
  const [tempDay, setTempDay] = useState<number | null>(null);
  const [tempYear, setTempYear] = useState<number | null>(null);

  const daysInMonth = (tempYear !== null && tempMonth !== null)
    ? new Date(tempYear, tempMonth + 1, 0).getDate()
    : 31;
  const safeDay = tempDay !== null ? Math.min(tempDay, daysInMonth) : null;

  // Decide whether to collect first/last name. Phone-auth users land here
  // with empty names; email/OAuth users already have them from signup.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          setBootstrapping(false);
          return;
        }
        const { data: profile } = await supabase
          .from('profiles')
          .select('first_name_display, last_name, birthday, gender, email, marketing_opt_in')
          .eq('id', user.id)
          .maybeSingle();
        if (cancelled) return;
        if (profile?.first_name_display) setFirstName(profile.first_name_display);
        if (profile?.last_name) setLastName(profile.last_name);
        if (profile?.email) setEmail(profile.email);
        if (profile?.marketing_opt_in) setMarketingOptIn(true);
        if (profile?.birthday) {
          const [y, m, d] = profile.birthday.split('-').map(Number);
          if (y && m && d) setBirthday(new Date(y, m - 1, d));
        }
        if (profile?.gender) {
          const reverseGender: Record<string, Gender> = {
            woman: 'woman',
            man: 'man',
            non_binary: 'non-binary',
          };
          const mapped = reverseGender[profile.gender];
          if (mapped) setGender(mapped);
        }
      } finally {
        if (!cancelled) setBootstrapping(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const namesValid = firstName.trim().length > 0 && lastName.trim().length > 0;
  const canContinue = !!birthday && !!gender && !dateError && namesValid;

  const openDatePicker = () => {
    if (birthday) {
      setTempYear(birthday.getFullYear());
      setTempMonth(birthday.getMonth());
      setTempDay(birthday.getDate());
    } else {
      setTempYear(null);
      setTempMonth(null);
      setTempDay(null);
    }
    setShowDatePicker(true);
    setDateError(null);
  };

  const confirmDate = () => {
    if (tempYear === null || tempMonth === null || tempDay === null) return;
    const d = new Date(tempYear, tempMonth, Math.min(tempDay, daysInMonth));
    setBirthday(d);
    setDateError(!is18Plus(d) ? 'you must be 18 or older to use washedup.' : null);
    setShowDatePicker(false);
  };

  const formatBirthday = (d: Date | null) => {
    if (!d) return 'select your birthday';
    return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  };

  const submit = useSubmitGuard();

  const handleContinue = async () => {
    if (!canContinue || !birthday || !gender || loading) return;
    if (!submit.tryAcquire()) return;
    setSaveError(null);
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        setSaveError('session expired. signing you out…');
        setTimeout(() => supabase.auth.signOut(), 1500);
        return;
      }
      const y = birthday.getFullYear();
      const m = String(birthday.getMonth() + 1).padStart(2, '0');
      const d = String(birthday.getDate()).padStart(2, '0');
      const isoBirthday = `${y}-${m}-${d}`;
      type ProfileUpdate = {
        birthday: string;
        gender: string;
        onboarding_status: string;
        first_name_display?: string;
        last_name?: string;
        email: string | null;
        marketing_opt_in: boolean;
      };
      const trimmedEmail = email.trim();
      const updates: ProfileUpdate = {
        birthday: isoBirthday,
        gender: GENDER_TO_ENUM[gender],
        onboarding_status: 'la_check',
        first_name_display: firstName.trim(),
        last_name: lastName.trim(),
        email: trimmedEmail || null,
        marketing_opt_in: marketingOptIn,
      };
      const { error } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', user.id);
      if (error) throw error;
      // Fire-and-forget Resend audience sync. The column is the source of
      // truth; if this fails the address is still persisted and a future
      // settings-page sync (or retry on next submit) can pick it up.
      if (marketingOptIn && trimmedEmail) {
        supabase.functions
          .invoke('add-to-resend-audience')
          .catch((err: unknown) => {
            console.warn('[basics] add-to-resend-audience failed:', err);
          });
      }
      hapticLight();
      router.replace('/onboarding/la-check');
    } catch (e: unknown) {
      const message = e && typeof e === 'object' && 'message' in e
        ? String((e as { message: string }).message)
        : 'something went wrong. try again.';
      setSaveError(message);
    } finally {
      submit.release();
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

  const [escapeError, setEscapeError] = useState<string | null>(null);
  const escapingRef = useRef(false);

  const handleEscapeToLogin = async () => {
    if (escapingRef.current) return;
    escapingRef.current = true;
    setEscapeError(null);
    try {
      const { data, error } = await supabase.functions.invoke('delete-ghost-account');
      if (error || !data?.success) {
        setEscapeError('Hmm, something went wrong. Contact support.');
        escapingRef.current = false;
        return;
      }
      await supabase.auth.signOut();
      router.replace(unauthedRoute() as never);
    } catch {
      setEscapeError('Hmm, something went wrong. Contact support.');
      escapingRef.current = false;
    }
  };

  if (bootstrapping) {
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
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.kav}
      >
        <View style={styles.container}>
          <ProgressHead step={1} totalSteps={4} />

          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={styles.scrollContent}
          >
            <View style={styles.gap20} />
            <Text style={styles.heading}>
              <Text style={styles.headingSans}>tell us about </Text>
              <Text style={styles.headingItalic}>you</Text>
            </Text>
            <Text style={styles.subline}>just the basics.</Text>

            <View style={styles.gap28} />

            <View style={styles.nameRow}>
              <View style={styles.nameCol}>
                <Text style={styles.label}>first name</Text>
                <TextInput
                  style={styles.input}
                  value={firstName}
                  onChangeText={setFirstName}
                  placeholder="first name"
                  placeholderTextColor={Colors.text3}
                  autoCapitalize="words"
                  textContentType="givenName"
                  returnKeyType="next"
                  inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
                />
              </View>
              <View style={styles.nameCol}>
                <Text style={styles.label}>last name</Text>
                <TextInput
                  style={styles.input}
                  value={lastName}
                  onChangeText={setLastName}
                  placeholder="last name"
                  placeholderTextColor={Colors.text3}
                  autoCapitalize="words"
                  textContentType="familyName"
                  returnKeyType="next"
                  inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
                />
              </View>
            </View>
            <View style={styles.gap16} />

            <Text style={styles.label}>
              email <Text style={styles.labelHint}>(optional)</Text>
            </Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={Colors.text3}
              keyboardType="email-address"
              textContentType="emailAddress"
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="next"
              inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
            />
            <View style={styles.gap16} />

            <Pressable
              style={styles.optInRow}
              onPress={() => {
                hapticLight();
                setMarketingOptIn((v) => !v);
              }}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: marketingOptIn }}
              accessibilityLabel="keep me updated on plans and events near me"
            >
              <View style={[styles.checkbox, marketingOptIn && styles.checkboxChecked]}>
                {marketingOptIn && (
                  <Ionicons name="checkmark" size={14} color={Colors.surface} />
                )}
              </View>
              <Text style={styles.optInLabel}>
                keep me updated on plans and events near me
              </Text>
            </Pressable>
            <View style={styles.gap20} />

            <Text style={styles.label}>birthday</Text>
            <TouchableOpacity
              style={[styles.input, styles.inputRow, dateError ? styles.inputError : null]}
              onPress={openDatePicker}
              activeOpacity={0.85}
            >
              <Text style={[styles.inputText, !birthday && styles.placeholder]}>
                {formatBirthday(birthday)}
              </Text>
              <Ionicons name="calendar-outline" size={20} color={Colors.text3} />
            </TouchableOpacity>
            {dateError ? (
              <Text style={styles.fieldError}>{dateError}</Text>
            ) : null}

            <View style={styles.gap20} />

            <Text style={styles.label}>i identify as</Text>
            <View style={styles.pillRow}>
              {GENDERS.map((g) => {
                const selected = gender === g;
                return (
                  <TouchableOpacity
                    key={g}
                    style={[styles.pill, selected && styles.pillSelected]}
                    onPress={() => {
                      hapticLight();
                      setGender(g);
                    }}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.pillText, selected && styles.pillTextSelected]}>
                      {g}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>

          <View style={styles.footer}>
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
            {saveError ? <Text style={styles.fieldError}>{saveError}</Text> : null}
            <TouchableOpacity
              style={styles.signOutHit}
              onPress={handleSignOut}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={styles.signOutText}>sign out</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.escapeHit}
              onPress={handleEscapeToLogin}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={styles.escapeText}>Already on WashedUp? Log in here</Text>
            </TouchableOpacity>
            {escapeError ? (
              <Text style={styles.escapeError}>{escapeError}</Text>
            ) : null}
          </View>
        </View>
      </KeyboardAvoidingView>

      <Modal
        visible={showDatePicker}
        transparent
        animationType="slide"
        statusBarTranslucent
        onRequestClose={() => setShowDatePicker(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setShowDatePicker(false)}>
          <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>select birthday</Text>
            <View style={styles.pickerRow}>
              <ScrollView decelerationRate="normal" style={styles.pickerScroll} showsVerticalScrollIndicator={false}>
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
              <ScrollView decelerationRate="normal" style={styles.pickerScroll} showsVerticalScrollIndicator={false}>
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
              <ScrollView decelerationRate="normal" style={styles.pickerScroll} showsVerticalScrollIndicator={false}>
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
            <TouchableOpacity
              style={[styles.modalButton, (tempYear === null || tempMonth === null || tempDay === null) && styles.ctaDisabled]}
              onPress={confirmDate}
              disabled={tempYear === null || tempMonth === null || tempDay === null}
            >
              <Text style={styles.ctaText}>done</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.cream },
  kav: { flex: 1 },
  container: { flex: 1, paddingHorizontal: 28 },
  bootstrapWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  scrollContent: { paddingBottom: 16 },
  gap16: { height: 16 },
  gap20: { height: 20 },
  gap28: { height: 28 },

  heading: {
    fontSize: 32,
    lineHeight: 44,
    color: Colors.text1,
    marginTop: 16,
  },
  headingSans: { fontFamily: Fonts.headline },
  headingItalic: { fontFamily: Fonts.displayItalic, fontStyle: 'italic', fontSize: 40 },

  subline: {
    fontFamily: Fonts.sans,
    fontSize: 15,
    lineHeight: 22,
    color: Colors.text2,
    marginTop: 6,
  },

  label: {
    fontFamily: Fonts.sansSemibold,
    fontSize: 12,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: Colors.text2,
    marginBottom: 8,
  },
  labelHint: {
    fontFamily: Fonts.sans,
    fontSize: 11,
    letterSpacing: 0.2,
    textTransform: 'none',
    color: Colors.text3,
  },
  nameRow: {
    flexDirection: 'row',
    gap: 12,
  },
  nameCol: {
    flex: 1,
  },
  optInRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 4,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: Colors.borderWarm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface,
  },
  checkboxChecked: {
    backgroundColor: Colors.brand,
    borderColor: Colors.brand,
  },
  optInLabel: {
    flex: 1,
    fontFamily: Fonts.sansMedium,
    fontSize: 14,
    lineHeight: 20,
    color: Colors.text1,
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
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  inputText: {
    fontFamily: Fonts.sansMedium,
    fontSize: 16,
    color: Colors.text1,
  },
  inputError: {
    borderColor: Colors.errorBrand,
    borderWidth: 1.5,
  },
  placeholder: { color: Colors.text3 },
  fieldError: {
    fontFamily: Fonts.sansSemibold,
    fontSize: 13,
    color: Colors.errorBrand,
    marginTop: 8,
  },

  pillRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  pill: {
    flex: 1,
    height: 40,
    borderRadius: 8,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderWarm,
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

  footer: {
    paddingTop: 12,
    paddingBottom: 8,
    gap: 12,
  },
  cta: {
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
  signOutHit: { alignSelf: 'center', paddingVertical: 4 },
  signOutText: {
    fontFamily: Fonts.sans,
    fontSize: 13,
    color: Colors.text3,
  },
  escapeHit: { alignSelf: 'center', paddingVertical: 6, marginTop: 4 },
  escapeText: {
    fontFamily: Fonts.sans,
    fontSize: 13,
    color: Colors.text3,
    textDecorationLine: 'underline',
  },
  escapeError: {
    fontFamily: Fonts.sansMedium,
    fontSize: 12,
    color: Colors.text2,
    textAlign: 'center',
    marginTop: 6,
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: Colors.overlayDark,
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: Colors.cream,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
  },
  modalTitle: {
    fontFamily: Fonts.headline,
    fontSize: 20,
    color: Colors.text1,
    marginBottom: 16,
  },
  pickerRow: { flexDirection: 'row', gap: 12, maxHeight: 220, marginBottom: 20 },
  pickerScroll: { flex: 1 },
  pickerItem: {
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: 'center',
    borderRadius: 8,
  },
  pickerItemSelected: { backgroundColor: Colors.brandSoft },
  pickerItemText: {
    fontFamily: Fonts.sansMedium,
    fontSize: 16,
    color: Colors.text1,
  },
  pickerItemTextSelected: {
    fontFamily: Fonts.sansSemibold,
    color: Colors.brandDeep,
  },
  modalButton: {
    height: 52,
    borderRadius: 8,
    backgroundColor: Colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
