import React, { useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react-native';
import { supabase } from '../lib/supabase';
import { fetchPlans, Plan } from '../lib/fetchPlans';
import { PlanCard } from '../components/plans/PlanCard';
import Colors from '../constants/Colors';
import { Fonts } from '../constants/Typography';

// Map Plan (from fetchPlans) to PlanCard shape
function toPlanCardPlan(plan: Plan) {
  return {
    id: plan.id,
    title: plan.title,
    host_message: plan.host_message ?? null,
    start_time: plan.start_time,
    location_text: plan.location_text ?? null,
    category: plan.category ?? null,
    max_invites: plan.max_invites ?? 0,
    member_count: plan.member_count ?? 0,
    creator: {
      first_name_display: plan.creator?.first_name ?? 'Creator',
      profile_photo_url: plan.creator?.avatar_url ?? null,
    },
    attendees: [],
  };
}

export default function PlansSectionScreen() {
  const router = useRouter();
  const { title, from, to } = useLocalSearchParams<{ title: string; from: string; to: string }>();

  const fromDate = useMemo(() => (from ? new Date(from) : new Date(0)), [from]);
  const toDate = useMemo(() => (to ? new Date(to) : new Date(9999, 0, 1)), [to]);

  const [userId, setUserId] = React.useState<string | null>(null);
  React.useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  // Read from the same cache as the feed — no extra network request
  const { data: allPlans = [], isLoading } = useQuery({
    queryKey: ['events', 'feed', userId],
    queryFn: () => fetchPlans(userId!),
    enabled: !!userId,
    staleTime: 60_000,
  });

  const sectionPlans = useMemo(
    () => allPlans.filter((p: Plan) => {
      const t = new Date(p.start_time);
      return t >= fromDate && t <= toDate;
    }),
    [allPlans, fromDate, toDate],
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <ArrowLeft size={22} color={Colors.asphalt} strokeWidth={2.5} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{title ?? 'Plans'}</Text>
        <View style={styles.backButton} />
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.terracotta} />
        </View>
      ) : (
        <FlatList
          data={sectionPlans}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <PlanCard plan={toPlanCardPlan(item)} isMember={false} />
          )}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No plans for this period.</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.displaySM,
    color: Colors.asphalt,
    letterSpacing: -0.3,
  },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 20, gap: 16 },
  empty: { alignItems: 'center', paddingTop: 80 },
  emptyText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyLG, color: Colors.textLight },
});
