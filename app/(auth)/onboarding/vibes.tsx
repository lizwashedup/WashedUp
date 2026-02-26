import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { router, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import { ChevronLeft } from 'lucide-react-native';
import { supabase } from '../../../lib/supabase';
import Colors from '../../../constants/Colors';

const VIBE_TAGS = [
  'Music', 'Art', 'Tech', 'Food', 'Fitness', 'Nightlife',
  'Outdoors', 'LGBTQ+', 'Gaming', 'Wellness', 'Books', 'Sports',
  'Comedy', 'Film',
];

export default function OnboardingVibesScreen() {
  const routerBack = useRouter();
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);

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
      if (!user) return;
      const tags = Object.keys(selected).filter(k => selected[k]);
      await supabase
        .from('profiles')
        .update({
          vibe_tags: tags,
          onboarding_status: 'complete',
        })
        .eq('id', user.id);

      // Ask for push permission at the natural completion moment.
      // Fire-and-forget — onboarding proceeds regardless of the user's answer.
      // The actual token is registered and saved via usePushNotifications on next launch.
      Notifications.requestPermissionsAsync().catch(() => {});

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
            <ChevronLeft size={28} color={Colors.textDark} />
          </TouchableOpacity>
        </View>

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

        <View style={styles.spacer} />
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.backgroundCream },
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
  subtext: { fontSize: 14, color: Colors.textMedium, marginTop: 4 },
  gap20: { height: 20 },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  pill: {
    width: '31%',
    paddingVertical: 14,
    paddingHorizontal: 12,
    backgroundColor: Colors.cardBackground,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 14,
  },
  pillSelected: { backgroundColor: Colors.primaryOrange, borderColor: Colors.primaryOrange },
  pillText: { fontSize: 16, color: Colors.textDark },
  pillTextSelected: { color: '#FFFFFF', fontWeight: '600' },
  countText: { fontSize: 14, color: Colors.textLight, marginTop: 16 },
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
});
