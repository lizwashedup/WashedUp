import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { BrandedAlert, type BrandedAlertButton } from '../../../components/BrandedAlert';
import { PROFILE_PHOTO_KEY } from '../../../constants/QueryKeys';
import { hapticLight } from '../../../lib/haptics';
import { supabase } from '../../../lib/supabase';
import { registerForPushNotifications } from '../../../hooks/usePushNotifications';
import Colors, { INTEREST_COLORS } from '../../../constants/Colors';
import { Fonts } from '../../../constants/Typography';
import ProgressHead from '../../../components/onboarding/ProgressHead';

// DB column profiles.vibe_tags stores capitalized strings ("Music", "Art")
// — kept that way so existing rows match the new writes. UI labels are
// lowercased on render. Colors looked up by lowercase key.
const INTEREST_OPTIONS = [
  'Music', 'Art', 'Tech', 'Food', 'Fitness', 'Nightlife',
  'Outdoors', 'LGBTQ+', 'Gaming', 'Wellness', 'Books', 'Sports',
  'Comedy', 'Film',
] as const;

const MIN_SELECT = 3;

function colorFor(tag: string): string | null {
  const key = tag.toLowerCase() as keyof typeof INTEREST_COLORS;
  return (INTEREST_COLORS as Record<string, string>)[key] ?? null;
}

export default function OnboardingInterestsScreen() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [alertInfo, setAlertInfo] = useState<{
    title: string;
    message: string;
    buttons?: BrandedAlertButton[];
  } | null>(null);

  const selectedCount = Object.keys(selected).filter((k) => selected[k]).length;
  const canContinue = selectedCount >= MIN_SELECT;

  const toggle = (tag: string) => {
    hapticLight();
    setSelected((prev) => {
      const next = { ...prev };
      if (next[tag]) delete next[tag];
      else next[tag] = true;
      return next;
    });
  };

  const handleLetsGo = async () => {
    if (!canContinue || loading) return;
    hapticLight();
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setAlertInfo({ title: 'session expired', message: 'please sign in again.' });
        supabase.auth.signOut();
        return;
      }
      const tags = Object.keys(selected).filter((k) => selected[k]);
      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          vibe_tags: tags,
          onboarding_status: 'complete',
        })
        .eq('id', user.id);
      if (updateError) {
        setAlertInfo({
          title: 'something went wrong',
          message: 'could not save. try again.',
        });
        return;
      }

      queryClient.invalidateQueries({ queryKey: PROFILE_PHOTO_KEY });
      await queryClient.refetchQueries({ queryKey: PROFILE_PHOTO_KEY });

      // Push permission prompt — kept here intentionally so users see it
      // after engagement, not at cold-start. registerForPushNotifications
      // saves the token to profiles.expo_push_token if granted.
      await registerForPushNotifications({ prompt: true }).catch(() => {});

      router.replace('/(tabs)/plans');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <StatusBar style="dark" />
      <View style={styles.container}>
        <ProgressHead step={4} totalSteps={4} onBack={() => router.back()} />

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.gap20} />
          <Text style={styles.heading}>what are you into?</Text>
          <Text style={styles.subline}>pick at least {MIN_SELECT}</Text>

          <View style={styles.gap28} />

          <View style={styles.grid}>
            {INTEREST_OPTIONS.map((tag) => {
              const isSelected = !!selected[tag];
              const accent = colorFor(tag);
              const selectedStyle = accent
                ? { backgroundColor: accent, borderColor: accent }
                : { backgroundColor: Colors.brandSoft, borderColor: Colors.brand };
              return (
                <TouchableOpacity
                  key={tag}
                  style={[styles.pill, isSelected && selectedStyle]}
                  onPress={() => toggle(tag)}
                  activeOpacity={0.85}
                >
                  <Text
                    style={[
                      styles.pillText,
                      isSelected && styles.pillTextSelected,
                      isSelected && !accent && { color: Colors.brandDeep },
                    ]}
                  >
                    {tag.toLowerCase()}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.countText}>
            {selectedCount} of {INTEREST_OPTIONS.length} selected
          </Text>
          <View style={styles.gap20} />
        </ScrollView>

        <TouchableOpacity
          style={[styles.cta, (!canContinue || loading) && styles.ctaDisabled]}
          onPress={handleLetsGo}
          activeOpacity={0.9}
          disabled={!canContinue || loading}
        >
          {loading ? (
            <ActivityIndicator color={Colors.surface} />
          ) : (
            <Text style={[styles.ctaText, !canContinue && styles.ctaTextDisabled]}>
              let’s go
            </Text>
          )}
        </TouchableOpacity>
      </View>
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
  container: { flex: 1, paddingHorizontal: 28, paddingBottom: 12 },

  gap20: { height: 20 },
  gap28: { height: 28 },

  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingBottom: 24 },

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

  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  pill: {
    height: 40,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderWarm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillText: {
    fontFamily: Fonts.sansMedium,
    fontSize: 14,
    color: Colors.text1,
  },
  pillTextSelected: {
    fontFamily: Fonts.sansSemibold,
    color: Colors.surface,
  },

  countText: {
    fontFamily: Fonts.sansMedium,
    fontSize: 13,
    color: Colors.text2,
    marginTop: 16,
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
});
