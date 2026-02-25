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
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react-native';
import { supabase } from '../lib/supabase';
import { fetchPlans, Plan } from '../lib/fetchPlans';
import { PlanCard } from '../components/plans/PlanCard';

export default function PlansSectionScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
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

  const { data: wishlistIds = [] } = useQuery<string[]>({
    queryKey: ['wishlists', userId],
    queryFn: async () => {
      if (!userId) return [];
      const { data } = await supabase.from('wishlists').select('event_id').eq('user_id', userId);
      return (data ?? []).map((r: any) => r.event_id as string);
    },
    enabled: !!userId,
    staleTime: 30_000,
  });

  const wishlistedSet = useMemo(() => new Set(wishlistIds), [wishlistIds]);

  const wishlistMutation = useMutation({
    mutationFn: async ({ planId, isCurrentlyWishlisted }: { planId: string; isCurrentlyWishlisted: boolean }) => {
      if (!userId) return;
      if (isCurrentlyWishlisted) {
        await supabase.from('wishlists').delete().eq('user_id', userId).eq('event_id', planId);
      } else {
        await supabase.from('wishlists').insert({ user_id: userId, event_id: planId });
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['wishlists', userId] }),
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
          <ArrowLeft size={22} color="#1A1A1A" strokeWidth={2.5} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{title ?? 'Plans'}</Text>
        <View style={styles.backButton} />
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#C4652A" />
        </View>
      ) : (
        <FlatList
          data={sectionPlans}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <PlanCard
              plan={item}
              isWishlisted={wishlistedSet.has(item.id)}
              onWishlist={(planId, current) => wishlistMutation.mutate({ planId, isCurrentlyWishlisted: current })}
              variant="full"
            />
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
  container: { flex: 1, backgroundColor: '#FFF8F0' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F0E6D3',
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#1A1A1A',
    letterSpacing: -0.3,
  },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 20, gap: 16 },
  empty: { alignItems: 'center', paddingTop: 80 },
  emptyText: { fontSize: 16, color: '#999999' },
});
