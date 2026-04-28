import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ImageBackground,
  Image,
  Linking,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import Colors from '../../constants/Colors';
import { Fonts } from '../../constants/Typography';
import { supabase } from '../../lib/supabase';
import { hapticLight, hapticError } from '../../lib/haptics';
import { formatToE164, isValidUSPhone } from '../../lib/phoneFormat';
import PhoneInput from '../../components/auth/PhoneInput';

const HERO_PHOTO_URI =
  'https://images.unsplash.com/photo-1529333166437-7750a6dd5a70?w=900&q=80';

const TERMS_URL = 'https://washedup.app/terms';
const GUIDELINES_URL = 'https://washedup.app/community-guidelines';

export default function PhoneEntryScreen() {
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tenDigits = phone.length === 10;
  const valid = isValidUSPhone(phone);
  const canSubmit = tenDigits && valid && !submitting;

  const handleContinue = async () => {
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);
    try {
      const e164 = formatToE164(phone);
      const { error: otpError } = await supabase.auth.signInWithOtp({
        phone: e164,
      });
      if (otpError) throw otpError;
      hapticLight();
      // Cast removed in phase 4 once /verify-code is added to typed routes.
      router.push({
        pathname: '/verify-code' as never,
        params: { phone },
      });
    } catch (e: unknown) {
      hapticError();
      const status = (e as { status?: number } | null)?.status;
      const message = (e as { message?: string } | null)?.message ?? '';
      if (status === 429 || /rate.?limit/i.test(message)) {
        setError('too many attempts. try again in a few minutes.');
      } else if (/invalid.*phone/i.test(message)) {
        setError('that phone number doesn’t look right. double-check and try again.');
      } else {
        setError('something went wrong. try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ImageBackground
      source={{ uri: HERO_PHOTO_URI }}
      style={styles.bg}
      resizeMode="cover"
    >
      <StatusBar style="light" />
      <LinearGradient
        colors={[
          'rgba(181,82,46,0.18)',
          'rgba(181,82,46,0.10)',
          'rgba(110,45,23,0.40)',
        ]}
        locations={[0, 0.5, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <LinearGradient
        colors={['transparent', 'rgba(44,24,16,0.55)']}
        locations={[0.55, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.kav}
        >
          <View style={styles.topRow}>
            <Image
              source={require('../../assets/images/logo-wordmark.png')}
              style={styles.wordmark}
              resizeMode="contain"
            />
          </View>

          <View style={styles.heroWrap}>
            <Text style={styles.hero}>find people{'\n'}to go with</Text>
          </View>

          <View style={styles.bottomBlock}>
            <Text style={styles.label}>phone number</Text>
            <PhoneInput
              value={phone}
              onChangeText={(d) => {
                setError(null);
                setPhone(d);
              }}
              onSubmitEditing={handleContinue}
              error={error ?? undefined}
              autoFocus
              editable={!submitting}
            />

            <TouchableOpacity
              style={[styles.cta, !canSubmit && styles.ctaDisabled]}
              onPress={handleContinue}
              activeOpacity={0.9}
              disabled={!canSubmit}
            >
              <Text style={[styles.ctaText, !canSubmit && styles.ctaTextDisabled]}>
                continue
              </Text>
            </TouchableOpacity>

            <Text style={styles.legal}>
              by continuing you agree to our{' '}
              <Text
                style={styles.legalLink}
                onPress={() => Linking.openURL(TERMS_URL)}
              >
                terms
              </Text>
              {' '}&{' '}
              <Text
                style={styles.legalLink}
                onPress={() => Linking.openURL(GUIDELINES_URL)}
              >
                community guidelines
              </Text>
            </Text>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  bg: { flex: 1, backgroundColor: Colors.brandDeep },
  safe: { flex: 1 },
  kav: { flex: 1, paddingHorizontal: 28 },
  topRow: {
    paddingTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  wordmark: {
    width: 132,
    height: 28,
    tintColor: Colors.cream,
    opacity: 0.96,
  },
  heroWrap: {
    flex: 1,
    justifyContent: 'center',
    paddingTop: 8,
    paddingBottom: 24,
  },
  hero: {
    fontFamily: Fonts.displayBold,
    fontSize: 44,
    lineHeight: 48,
    color: Colors.cream,
    maxWidth: 280,
    textShadowColor: 'rgba(44,24,16,0.35)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 16,
  },
  bottomBlock: {
    paddingBottom: 12,
    gap: 12,
  },
  label: {
    fontFamily: Fonts.sansSemibold,
    fontSize: 13,
    color: 'rgba(250,245,236,0.92)',
    letterSpacing: 0.2,
    marginBottom: 2,
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
  ctaTextDisabled: {
    color: Colors.text3,
  },
  legal: {
    fontFamily: Fonts.sans,
    fontSize: 11,
    lineHeight: 16,
    color: 'rgba(250,245,236,0.78)',
    textAlign: 'center',
    paddingHorizontal: 16,
    marginTop: 8,
  },
  legalLink: {
    fontFamily: Fonts.sansSemibold,
    fontSize: 11,
    lineHeight: 16,
    color: 'rgba(250,245,236,0.96)',
    textDecorationLine: 'underline',
  },
});
