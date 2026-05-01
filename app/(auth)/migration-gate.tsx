import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Image,
  ScrollView,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { router } from 'expo-router';
import Colors from '../../constants/Colors';
import { Fonts } from '../../constants/Typography';
import { PHONE_MIGRATION_MANDATORY_AFTER } from '../../constants/FeatureFlags';
import { supabase } from '../../lib/supabase';
import { hapticLight, hapticError } from '../../lib/haptics';
import { formatToE164, isValidUSPhone } from '../../lib/phoneFormat';
import { snoozeMigrationGate } from '../../lib/migrationGateSnooze';
import PhoneInput from '../../components/auth/PhoneInput';

function isMandatoryToday(): boolean {
  const today = new Date().toISOString().slice(0, 10);
  return today >= PHONE_MIGRATION_MANDATORY_AFTER;
}

export default function MigrationGateScreen() {
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mandatory = isMandatoryToday();
  const canSubmit = isValidUSPhone(phone) && !submitting;

  const handleVerify = async () => {
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);
    try {
      const e164 = formatToE164(phone);
      // updateUser sends an OTP to the new phone for verification of the
      // already-authenticated user's phone change. Confirmed on the
      // verify-code screen with verifyOtp({ type: 'phone_change' }).
      const { error: updateError } = await supabase.auth.updateUser({
        phone: e164,
      });
      if (updateError) throw updateError;
      hapticLight();
      router.push({
        pathname: '/verify-code',
        params: { phone, mode: 'migration' },
      });
    } catch (e: unknown) {
      hapticError();
      const status = (e as { status?: number } | null)?.status;
      const message = (e as { message?: string } | null)?.message ?? '';
      if (status === 429 || /rate.?limit/i.test(message)) {
        setError('too many attempts. try again in a few minutes.');
      } else if (/already.*registered|already.*in use|taken/i.test(message)) {
        setError('that number is linked to another account.');
      } else if (/invalid.*phone/i.test(message)) {
        setError('that phone number doesn’t look right. double-check and try again.');
      } else {
        setError('something went wrong. try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleSkip = () => {
    if (mandatory) return;
    snoozeMigrationGate();
    router.replace('/(tabs)/plans');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.kav}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.brandRow}>
            <Image
              source={require('../../assets/images/w-logo-waves.png')}
              style={styles.wMark}
              resizeMode="contain"
            />
          </View>

          <View style={styles.callout}>
            <Text style={styles.calloutTag}>heads up</Text>
            <Text style={styles.calloutBody}>
              we’re moving to phone numbers for everyone. takes 30 seconds.
            </Text>
          </View>

          <Text style={styles.headline}>
            <Text style={styles.headlineSans}>add your </Text>
            <Text style={styles.headlineItalic}>number</Text>
          </Text>
          <Text style={styles.subline}>
            keeps your account safe + helps friends find you on washedup.
          </Text>

          <View style={styles.timeline}>
            <View style={styles.timelineRow}>
              <View style={styles.timelineColLeft}>
                <View style={styles.dotActiveHalo}>
                  <View style={styles.dotActive} />
                </View>
                <View style={styles.timelineLine} />
              </View>
              <View style={styles.timelineColRight}>
                <Text style={styles.timelineLabel}>now</Text>
                <Text style={styles.timelineBody}>
                  add your number, takes 30 seconds.
                </Text>
              </View>
            </View>

            <View style={styles.timelineRow}>
              <View style={styles.timelineColLeft}>
                <View style={styles.dotFuture} />
              </View>
              <View style={styles.timelineColRight}>
                <Text style={[styles.timelineLabel, styles.timelineLabelMuted]}>
                  starting june 1
                </Text>
                <Text style={[styles.timelineBody, styles.timelineBodyMuted]}>
                  you’ll sign in with your phone instead of a password.
                </Text>
              </View>
            </View>
          </View>

          <PhoneInput
            value={phone}
            onChangeText={(d) => {
              setError(null);
              setPhone(d);
            }}
            onSubmitEditing={handleVerify}
            error={error ?? undefined}
            editable={!submitting}
          />

          <TouchableOpacity
            style={[styles.cta, !canSubmit && styles.ctaDisabled]}
            onPress={handleVerify}
            activeOpacity={0.9}
            disabled={!canSubmit}
          >
            <Text style={[styles.ctaText, !canSubmit && styles.ctaTextDisabled]}>
              verify my number
            </Text>
          </TouchableOpacity>

          {mandatory ? null : (
            <TouchableOpacity
              style={styles.skipButton}
              onPress={handleSkip}
              activeOpacity={0.7}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={styles.skipText}>i’ll do this later</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.cream },
  kav: { flex: 1 },
  scroll: {
    paddingHorizontal: 28,
    paddingTop: 8,
    paddingBottom: 32,
    gap: 22,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  wMark: { width: 28, height: 28, tintColor: Colors.brandPressed },

  callout: {
    backgroundColor: Colors.brandSoft,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 4,
  },
  calloutTag: {
    fontFamily: Fonts.sansSemibold,
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: Colors.brandDeep,
  },
  calloutBody: {
    fontFamily: Fonts.sans,
    fontSize: 14,
    lineHeight: 20,
    color: Colors.text1,
  },

  headline: {
    fontSize: 32,
    lineHeight: 36,
    color: Colors.text1,
    marginTop: 4,
  },
  headlineSans: {
    fontFamily: Fonts.headline,
  },
  headlineItalic: {
    fontFamily: Fonts.displayItalic,
    fontStyle: 'italic',
    color: Colors.brand,
    textDecorationLine: 'underline',
    textDecorationColor: Colors.brand,
  },
  subline: {
    fontFamily: Fonts.sans,
    fontSize: 15,
    lineHeight: 22,
    color: Colors.text2,
  },

  timeline: {
    paddingTop: 4,
    paddingBottom: 4,
  },
  timelineRow: {
    flexDirection: 'row',
    minHeight: 60,
  },
  timelineColLeft: {
    width: 28,
    alignItems: 'center',
    paddingTop: 4,
  },
  timelineColRight: {
    flex: 1,
    paddingLeft: 12,
    paddingBottom: 12,
  },
  dotActiveHalo: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: Colors.cream,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotActive: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: Colors.brand,
  },
  dotFuture: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: Colors.brandSoft,
    borderWidth: 2,
    borderColor: Colors.brandBorderSoft,
    marginTop: 1,
  },
  timelineLine: {
    width: 2,
    flex: 1,
    backgroundColor: Colors.brandSoft,
    marginTop: 4,
  },
  timelineLabel: {
    fontFamily: Fonts.sansSemibold,
    fontSize: 13,
    color: Colors.text1,
    marginBottom: 4,
  },
  timelineLabelMuted: {
    color: Colors.text2,
  },
  timelineBody: {
    fontFamily: Fonts.sans,
    fontSize: 14,
    lineHeight: 20,
    color: Colors.text1,
  },
  timelineBodyMuted: {
    color: Colors.text2,
  },

  cta: {
    height: 52,
    borderRadius: 8,
    backgroundColor: Colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    shadowColor: Colors.brandDeep,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.45,
    shadowRadius: 28,
    elevation: 6,
  },
  ctaDisabled: {
    opacity: 0.45,
    shadowOpacity: 0,
    elevation: 0,
  },
  ctaText: {
    fontFamily: Fonts.sansBold,
    fontSize: 16,
    color: Colors.surface,
    letterSpacing: 0.2,
  },
  ctaTextDisabled: { color: Colors.surface },

  skipButton: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  skipText: {
    fontFamily: Fonts.sans,
    fontSize: 13,
    color: Colors.text3,
  },
});
