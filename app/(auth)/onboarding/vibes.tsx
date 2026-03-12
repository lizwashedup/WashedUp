import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { router, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { BrandedAlert, type BrandedAlertButton } from '../../../components/BrandedAlert';
import { PROFILE_PHOTO_KEY } from '../../../constants/QueryKeys';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import { ChevronLeft } from 'lucide-react-native';
import { supabase } from '../../../lib/supabase';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';

const VIBE_TAGS = [
  'Music', 'Art', 'Tech', 'Food', 'Fitness', 'Nightlife',
  'Outdoors', 'LGBTQ+', 'Gaming', 'Wellness', 'Books', 'Sports',
  'Comedy', 'Film',
];

export default function OnboardingVibesScreen() {
  const routerBack = useRouter();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [alertInfo, setAlertInfo] = useState<{ title: string; message: string; buttons?: BrandedAlertButton[] } | null>(null);

  const selectedCount = Object.keys(selected).filter(k => selected[k]).length;

  const toggle = (tag: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelected((prev) => {
      const next = { ...prev };
      if (next[tag]) delete next[tag];
      else next[tag] = true;
      return next;
    });
  };

  const canContinue = selectedCount >= 3;

  const handleLetsGo = async () => {
    if (!canContinue || loading) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setAlertInfo({ title: 'Session expired', message: 'Please sign in again.' });
        supabase.auth.signOut();
        return;
      }
      const tags = Object.keys(selected).filter(k => selected[k]);
      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          vibe_tags: tags,
          onboarding_status: 'complete',
        })
        .eq('id', user.id);
      if (updateError) {
        setAlertInfo({ title: 'Something went wrong', message: 'Could not save your vibes. Please try again.' });
        return;
      }

      // Invalidate and refetch profile-photo so it shows when user lands on Plans
      queryClient.invalidateQueries({ queryKey: PROFILE_PHOTO_KEY });
      await queryClient.refetchQueries({ queryKey: PROFILE_PHOTO_KEY });

      // Only request push permission if not already granted
      const { status } = await Notifications.getPermissionsAsync();
      if (status !== 'granted') {
        await Notifications.requestPermissionsAsync().catch(() => {});
      }

      router.replace('/(tabs)/plans');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <StatusBar style="dark" />
      <View style={styles.container}>
        <View style={styles.progressWrap}>
          <View style={[styles.progressBar, { width: '100%' }]} />
        </View>
        <View style={styles.headerRow}>
          <TouchableOpacity
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); routerBack.back(); }}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            style={styles.backButton}
          >
            <ChevronLeft size={28} color={Colors.asphalt} />
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.heading}>What are you into?</Text>
          <Text style={styles.subtext}>Pick at least 3</Text>
          <View style={styles.gap20} />

          <View style={styles.grid}>
            {VIBE_TAGS.map((tag) => {
              const isSelected = !!selected[tag];
              return (
                <TouchableOpacity
                  key={tag}
                  style={[styles.pill, isSelected && styles.pillSelected]}
                  onPress={() => toggle(tag)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.pillText, isSelected && styles.pillTextSelected]}>{tag}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.countText}>{selectedCount} selected</Text>
          <View style={styles.gap20} />
        </ScrollView>

        <TouchableOpacity
          style={[
            styles.primaryButton,
            (!canContinue || loading) && styles.primaryButtonDisabled,
          ]}
          onPress={handleLetsGo}
          onPressIn={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}
          activeOpacity={0.9}
          disabled={!canContinue || loading}
        >
          <Text style={styles.primaryButtonText}>Let&apos;s Go</Text>
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
  safe: { flex: 1, backgroundColor: Colors.parchment },
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
  subtext: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.textMedium, marginTop: 4 },
  gap20: { height: 20 },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  pill: {
    width: '31%',
    paddingVertical: 14,
    paddingHorizontal: 12,
    backgroundColor: Colors.cardBg,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 14,
  },
  pillSelected: { backgroundColor: Colors.terracotta, borderColor: Colors.terracotta },
  pillText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyLG, color: Colors.asphalt },
  pillTextSelected: { color: Colors.white, fontFamily: Fonts.sansBold },
  countText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.textLight, marginTop: 16 },
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
  primaryButtonDisabled: { opacity: 0.5 },
  primaryButtonText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.displaySM, color: Colors.white },
});
