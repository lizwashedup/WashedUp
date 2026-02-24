// ─────────────────────────────────────────────────────────────────────────────
// FILE: app/(tabs)/plans/index.tsx
// INSTRUCTIONS: Replace the ENTIRE contents of this file with everything below.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Animated,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Plus } from 'lucide-react-native';
import { supabase } from '../../../lib/supabase';
import { PlanCard } from '../../../components/plans/PlanCard';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ─── Types ───────────────────────────────────────────────────────────────────

interface Plan {
  id: string;
  title: string;
  start_time: string;
  location_text: string | null;
  image_url: string | null;
  category: string | null;
  gender_preference: string | null;
  age_range: string | null;
  max_invites: number | null;
  min_invites: number | null;
  primary_vibe: string | null;
  host: {
    id: string;
    first_name: string | null;
    avatar_url: string | null;
  } | null;
  member_count: number;
}

type SubTab = 'plans' | 'my-plans' | 'wishlist';

// ─── Profile & Filter Helpers ─────────────────────────────────────────────────

interface UserProfile {
  gender_type: string | null;
  birthday: string | null;
}

function calculateAge(birthday: string | null): number | null {
  if (!birthday) return null;
  const dob = new Date(birthday);
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
  return age;
}

function matchesAgeRange(planAgeRange: string | null, userAge: number | null): boolean {
  if (!planAgeRange || planAgeRange === 'All Ages') return true;
  if (userAge === null) return true;
  if (planAgeRange === '21+') return userAge >= 21;
  if (planAgeRange === '20s') return userAge >= 20 && userAge < 30;
  if (planAgeRange === '30s') return userAge >= 30 && userAge < 40;
  if (planAgeRange === '40s') return userAge >= 40 && userAge < 50;
  if (planAgeRange === '50+') return userAge >= 50;
  return true;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isTonight(dateString: string): boolean {
  const date = new Date(dateString);
  const now = new Date();
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  return date >= now && date <= todayEnd;
}

function isThisWeekend(dateString: string): boolean {
  const date = new Date(dateString);
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);

  // Find next Sunday
  const dayOfWeek = now.getDay();
  const daysUntilSunday = dayOfWeek === 0 ? 7 : 7 - dayOfWeek;
  const sunday = new Date(now);
  sunday.setDate(sunday.getDate() + daysUntilSunday);
  sunday.setHours(23, 59, 59, 999);

  return date >= tomorrow && date <= sunday;
}

// ─── Data Fetching ────────────────────────────────────────────────────────────

async function fetchPlans(): Promise<Plan[]> {
  // Fetch current user's profile for server-side gender filter + client-side age filter
  let userProfile: UserProfile | null = null;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('gender_type, birthday')
        .eq('id', user.id)
        .single();
      userProfile = profile;
    }
  } catch {
    // Proceed without profile — will show mixed plans only
  }

  // Build query with server-side gender filter
  let query = supabase
    .from('events')
    .select(`
      id,
      title,
      start_time,
      location_text,
      image_url,
      category,
      gender_preference,
      age_range,
      max_invites,
      min_invites,
      primary_vibe,
      host:profiles!events_host_id_fkey(id, first_name, avatar_url),
      event_members(count)
    `)
    .eq('status', 'active')
    .gte('start_time', new Date().toISOString())
    .order('start_time', { ascending: true })
    .limit(100);

  // Server-side gender filter — users never receive plans they shouldn't see
  if (userProfile?.gender_type === 'woman') {
    query = query.or('gender_preference.eq.mixed,gender_preference.is.null,gender_preference.eq.women_only');
  } else if (userProfile?.gender_type === 'man') {
    query = query.or('gender_preference.eq.mixed,gender_preference.is.null,gender_preference.eq.men_only');
  } else {
    // Unknown gender: mixed and null only
    query = query.or('gender_preference.eq.mixed,gender_preference.is.null');
  }

  const { data, error } = await query;
  if (error) throw error;

  let plans: Plan[] = (data ?? []).map((item: any) => ({
    ...item,
    member_count: item.event_members?.[0]?.count ?? 0,
    host: Array.isArray(item.host) ? item.host[0] ?? null : item.host ?? null,
  }));

  // Client-side age filter (requires calculating age from birthday)
  const userAge = calculateAge(userProfile?.birthday ?? null);
  plans = plans.filter((p) => matchesAgeRange(p.age_range, userAge));

  return plans;
}

async function fetchMyPlans(userId: string): Promise<Plan[]> {
  const { data, error } = await supabase
    .from('event_members')
    .select(`
      events(
        id,
        title,
        start_time,
        location_text,
        image_url,
        category,
        gender_preference,
        max_invites,
        min_invites,
        primary_vibe,
        host:profiles!events_host_id_fkey(id, first_name, avatar_url)
      )
    `)
    .eq('user_id', userId)
    .eq('status', 'joined')
    .order('joined_at', { ascending: false });

  if (error) throw error;

  const plans: Plan[] = [];
  for (const row of data ?? []) {
    const event = (row as any).events;
    if (!event) continue;
    // Get member count for this event
    const { count } = await supabase
      .from('event_members')
      .select('*', { count: 'exact', head: true })
      .eq('event_id', event.id)
      .eq('status', 'joined');

    plans.push({
      ...event,
      member_count: count ?? 0,
      host: Array.isArray(event.host) ? event.host[0] ?? null : event.host ?? null,
    });
  }
  return plans;
}

async function fetchWishlist(userId: string): Promise<Plan[]> {
  const { data, error } = await supabase
    .from('wishlists')
    .select(`
      events(
        id,
        title,
        start_time,
        location_text,
        image_url,
        category,
        gender_preference,
        max_invites,
        min_invites,
        primary_vibe,
        host:profiles!events_host_id_fkey(id, first_name, avatar_url)
      )
    `)
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    // wishlists table might not exist yet
    if (error.code === '42P01') return [];
    throw error;
  }

  const plans: Plan[] = [];
  for (const row of data ?? []) {
    const event = (row as any).events;
    if (!event) continue;
    const { count } = await supabase
      .from('event_members')
      .select('*', { count: 'exact', head: true })
      .eq('event_id', event.id)
      .eq('status', 'joined');

    plans.push({
      ...event,
      member_count: count ?? 0,
      host: Array.isArray(event.host) ? event.host[0] ?? null : event.host ?? null,
    });
  }
  return plans;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface CarouselSectionProps {
  title: string;
  plans: Plan[];
  wishlisted: Set<string>;
  onWishlist: (id: string, current: boolean) => void;
  onSeeAll?: () => void;
}

const CarouselSection = React.memo<CarouselSectionProps>(({
  title,
  plans,
  wishlisted,
  onWishlist,
  onSeeAll,
}) => {
  if (plans.length === 0) return null;

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {onSeeAll && plans.length > 2 && (
          <TouchableOpacity onPress={onSeeAll} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.seeAllText}>See all</Text>
          </TouchableOpacity>
        )}
      </View>
      <FlatList
        horizontal
        data={plans}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <PlanCard
            plan={item}
            isWishlisted={wishlisted.has(item.id)}
            onWishlist={onWishlist}
            variant="carousel"
          />
        )}
        contentContainerStyle={styles.carouselContent}
        showsHorizontalScrollIndicator={false}
        snapToInterval={SCREEN_WIDTH - 36}
        decelerationRate="fast"
      />
    </View>
  );
});

CarouselSection.displayName = 'CarouselSection';

const EmptyState = ({ message, cta, onCta }: { message: string; cta?: string; onCta?: () => void }) => (
  <View style={styles.emptyState}>
    <Text style={styles.emptyEmoji}>🏄‍♀️</Text>
    <Text style={styles.emptyTitle}>{message}</Text>
    {cta && onCta && (
      <TouchableOpacity style={styles.emptyButton} onPress={onCta}>
        <Text style={styles.emptyButtonText}>{cta}</Text>
      </TouchableOpacity>
    )}
  </View>
);

// ─── Main Component ───────────────────────────────────────────────────────────

export default function PlansScreen() {
  const [activeTab, setActiveTab] = useState<SubTab>('plans');
  const queryClient = useQueryClient();

  // Get current user
  const [userId, setUserId] = React.useState<string | null>(null);
  React.useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  // Fetch all plans
  const {
    data: allPlans = [],
    isLoading: plansLoading,
    refetch: refetchPlans,
    isRefetching: plansRefetching,
  } = useQuery({
    queryKey: ['events', 'feed'],
    queryFn: fetchPlans,
    staleTime: 60_000,
  });

  // Fetch my plans
  const {
    data: myPlans = [],
    isLoading: myPlansLoading,
    refetch: refetchMyPlans,
  } = useQuery({
    queryKey: ['events', 'my-plans', userId],
    queryFn: () => fetchMyPlans(userId!),
    enabled: !!userId && activeTab === 'my-plans',
    staleTime: 30_000,
  });

  // Fetch wishlist
  const {
    data: wishlistPlans = [],
    isLoading: wishlistLoading,
    refetch: refetchWishlist,
  } = useQuery({
    queryKey: ['wishlists', userId],
    queryFn: () => fetchWishlist(userId!),
    enabled: !!userId && activeTab === 'wishlist',
    staleTime: 30_000,
  });

  // Wishlist state (derived from wishlist plans for quick UI updates)
  const wishlistedIds = React.useMemo(
    () => new Set(wishlistPlans.map((p) => p.id)),
    [wishlistPlans]
  );

  // Toggle wishlist mutation
  const wishlistMutation = useMutation({
    mutationFn: async ({ planId, isCurrentlyWishlisted }: { planId: string; isCurrentlyWishlisted: boolean }) => {
      if (!userId) return;
      if (isCurrentlyWishlisted) {
        await supabase.from('wishlists').delete().eq('user_id', userId).eq('event_id', planId);
      } else {
        await supabase.from('wishlists').insert({ user_id: userId, event_id: planId });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wishlists', userId] });
    },
  });

  const handleWishlist = useCallback((planId: string, isCurrentlyWishlisted: boolean) => {
    wishlistMutation.mutate({ planId, isCurrentlyWishlisted });
  }, [wishlistMutation]);

  // Tab switching
  const handleTabPress = useCallback((tab: SubTab) => {
    Haptics.selectionAsync();
    setActiveTab(tab);
  }, []);

  // Refresh
  const handleRefresh = useCallback(async () => {
    if (activeTab === 'plans') await refetchPlans();
    if (activeTab === 'my-plans') await refetchMyPlans();
    if (activeTab === 'wishlist') await refetchWishlist();
  }, [activeTab, refetchPlans, refetchMyPlans, refetchWishlist]);

  // Categorize plans into carousels
  const tonightPlans = React.useMemo(
    () => allPlans.filter((p) => isTonight(p.start_time)),
    [allPlans]
  );
  const weekendPlans = React.useMemo(
    () => allPlans.filter((p) => isThisWeekend(p.start_time)),
    [allPlans]
  );
  const userVibes = React.useRef<string[]>([]);
  const basedOnYouPlans = React.useMemo(
    () => allPlans.filter((p) => !isTonight(p.start_time) && !isThisWeekend(p.start_time)),
    [allPlans]
  );

  const isLoading =
    (activeTab === 'plans' && plansLoading) ||
    (activeTab === 'my-plans' && myPlansLoading) ||
    (activeTab === 'wishlist' && wishlistLoading);

  const isRefreshing =
    (activeTab === 'plans' && plansRefetching);

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.logo}>WashedUp</Text>
          <Text style={styles.tagline}>Find people to go with.</Text>
        </View>
        <TouchableOpacity
          style={styles.postButton}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            router.push('/(tabs)/post');
          }}
          accessibilityLabel="Post a new plan"
        >
          <Plus size={20} color="#FFFFFF" strokeWidth={2.5} />
        </TouchableOpacity>
      </View>

      {/* Sub-tabs */}
      <View style={styles.tabBar}>
        {(['plans', 'my-plans', 'wishlist'] as SubTab[]).map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, activeTab === tab && styles.tabActive]}
            onPress={() => handleTabPress(tab)}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === tab }}
          >
            <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
              {tab === 'plans' ? 'Plans' : tab === 'my-plans' ? 'My Plans' : 'Wishlist'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Content */}
      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#C4652A" />
        </View>
      ) : (
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor="#C4652A"
            />
          }
        >
          {/* ── Plans Tab ── */}
          {activeTab === 'plans' && (
            <>
              {allPlans.length === 0 ? (
                <EmptyState
                  message="No plans yet. Be the first to post something tonight."
                  cta="Post a Plan"
                  onCta={() => router.push('/(tabs)/post')}
                />
              ) : (
                <>
                  <CarouselSection
                    title="Tonight 🌙"
                    plans={tonightPlans}
                    wishlisted={wishlistedIds}
                    onWishlist={handleWishlist}
                  />
                  <CarouselSection
                    title="This Weekend 🎉"
                    plans={weekendPlans}
                    wishlisted={wishlistedIds}
                    onWishlist={handleWishlist}
                  />
                  <CarouselSection
                    title="Coming Up ✨"
                    plans={basedOnYouPlans}
                    wishlisted={wishlistedIds}
                    onWishlist={handleWishlist}
                  />
                  {/* If nothing fits the carousels, show all plans */}
                  {tonightPlans.length === 0 && weekendPlans.length === 0 && basedOnYouPlans.length === 0 && (
                    <CarouselSection
                      title="All Plans"
                      plans={allPlans}
                      wishlisted={wishlistedIds}
                      onWishlist={handleWishlist}
                    />
                  )}
                </>
              )}
            </>
          )}

          {/* ── My Plans Tab ── */}
          {activeTab === 'my-plans' && (
            <>
              {myPlans.length === 0 ? (
                <EmptyState
                  message="You haven't joined any plans yet."
                  cta="Browse Plans"
                  onCta={() => handleTabPress('plans')}
                />
              ) : (
                <View style={styles.verticalList}>
                  {myPlans.map((plan) => (
                    <PlanCard
                      key={plan.id}
                      plan={plan}
                      isWishlisted={wishlistedIds.has(plan.id)}
                      onWishlist={handleWishlist}
                      variant="full"
                    />
                  ))}
                </View>
              )}
            </>
          )}

          {/* ── Wishlist Tab ── */}
          {activeTab === 'wishlist' && (
            <>
              {wishlistPlans.length === 0 ? (
                <EmptyState
                  message="Heart a plan to save it for later."
                  cta="Browse Plans"
                  onCta={() => handleTabPress('plans')}
                />
              ) : (
                <View style={styles.verticalList}>
                  {wishlistPlans.map((plan) => (
                    <PlanCard
                      key={plan.id}
                      plan={plan}
                      isWishlisted={true}
                      onWishlist={handleWishlist}
                      variant="full"
                    />
                  ))}
                </View>
              )}
            </>
          )}

          <View style={{ height: 32 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFF8F0',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  logo: {
    fontSize: 24,
    fontWeight: '800',
    color: '#C4652A',
    letterSpacing: -0.5,
  },
  tagline: {
    fontSize: 13,
    color: '#999999',
    marginTop: 1,
  },
  postButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#C4652A',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#C4652A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    marginBottom: 4,
    gap: 4,
  },
  tab: {
    flex: 1,
    paddingVertical: 9,
    alignItems: 'center',
    borderRadius: 10,
    backgroundColor: 'transparent',
  },
  tabActive: {
    backgroundColor: '#C4652A',
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#999999',
  },
  tabTextActive: {
    color: '#FFFFFF',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 12,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1A1A1A',
  },
  seeAllText: {
    fontSize: 14,
    color: '#C4652A',
    fontWeight: '600',
  },
  carouselContent: {
    paddingHorizontal: 20,
    paddingRight: 8,
  },
  verticalList: {
    paddingHorizontal: 20,
    gap: 16,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    paddingHorizontal: 32,
  },
  emptyEmoji: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 16,
    color: '#666666',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 20,
  },
  emptyButton: {
    backgroundColor: '#C4652A',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  emptyButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
});
