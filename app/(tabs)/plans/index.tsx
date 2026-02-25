import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Dimensions,
  Modal,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { LayoutList, Map, ChevronDown, Check, ArrowRight } from 'lucide-react-native';
import MapView, { Marker } from 'react-native-maps';
import { supabase } from '../../../lib/supabase';
import { fetchPlans, Plan } from '../../../lib/fetchPlans';
import { PlanCard } from '../../../components/plans/PlanCard';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ─── Types ────────────────────────────────────────────────────────────────────

type CategoryOption = 'Music' | 'Food' | 'Outdoors' | 'Nightlife' | 'Film' | 'Art' | 'Fitness' | 'Comedy' | 'Wellness' | 'Sports';

interface SectionDef {
  key: string;
  title: string;
  from: Date;
  to: Date;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CATEGORY_OPTIONS: CategoryOption[] = ['Music', 'Food', 'Outdoors', 'Nightlife', 'Film', 'Art', 'Fitness', 'Comedy', 'Wellness', 'Sports'];

const LA_REGION = {
  latitude: 34.0522,
  longitude: -118.2437,
  latitudeDelta: 0.4,
  longitudeDelta: 0.4,
};

// ─── Section boundary logic ───────────────────────────────────────────────────

function getSectionDefs(now: Date): SectionDef[] {
  const day = now.getDay(); // 0=Sun … 6=Sat
  const y = now.getFullYear();
  const mo = now.getMonth();
  const d = now.getDate();

  const todayEnd = new Date(y, mo, d, 23, 59, 59, 999);
  const tonight: SectionDef = { key: 'tonight', title: 'Tonight', from: now, to: todayEnd };

  let middle: SectionDef;
  let comingUpFrom: Date;

  if (day >= 1 && day <= 4) {
    // Mon–Thu → "This Week" = tomorrow through Friday
    const tomorrowStart = new Date(y, mo, d + 1, 0, 0, 0);
    const fridayEnd = new Date(y, mo, d + (5 - day), 23, 59, 59, 999);
    middle = { key: 'this-week', title: 'This Week', from: tomorrowStart, to: fridayEnd };
    comingUpFrom = new Date(fridayEnd.getTime() + 1);
  } else if (day === 5) {
    // Friday → "This Weekend" = Sat + Sun
    const satStart = new Date(y, mo, d + 1, 0, 0, 0);
    const sunEnd = new Date(y, mo, d + 2, 23, 59, 59, 999);
    middle = { key: 'this-weekend', title: 'This Weekend', from: satStart, to: sunEnd };
    comingUpFrom = new Date(sunEnd.getTime() + 1);
  } else if (day === 6) {
    // Saturday → "This Weekend" = just Sunday
    const sunStart = new Date(y, mo, d + 1, 0, 0, 0);
    const sunEnd = new Date(y, mo, d + 1, 23, 59, 59, 999);
    middle = { key: 'this-weekend', title: 'This Weekend', from: sunStart, to: sunEnd };
    comingUpFrom = new Date(sunEnd.getTime() + 1);
  } else {
    // Sunday → "Next Week" = Mon–Fri
    const monStart = new Date(y, mo, d + 1, 0, 0, 0);
    const friEnd = new Date(y, mo, d + 5, 23, 59, 59, 999);
    middle = { key: 'next-week', title: 'Next Week', from: monStart, to: friEnd };
    comingUpFrom = new Date(friEnd.getTime() + 1);
  }

  const comingUp: SectionDef = {
    key: 'coming-up',
    title: 'Coming Up',
    from: comingUpFrom,
    to: new Date(y + 2, 0, 1),
  };

  return [tonight, middle, comingUp];
}

function filterIntoSections(
  plans: Plan[],
  sectionDefs: SectionDef[],
  categoryFilter: CategoryOption[],
  whenKeys: string[],
): { def: SectionDef; plans: Plan[] }[] {
  const catFiltered = categoryFilter.length === 0
    ? plans
    : plans.filter((p) => categoryFilter.some((c) => c.toLowerCase() === p.category?.toLowerCase()));

  return sectionDefs
    .filter((def) => whenKeys.length === 0 || whenKeys.includes(def.key))
    .map((def) => ({
      def,
      plans: catFiltered.filter((p) => {
        const t = new Date(p.start_time);
        return t >= def.from && t <= def.to;
      }),
    }))
    .filter((s) => s.plans.length > 0);
}

// ─── Bottom Sheet ─────────────────────────────────────────────────────────────

interface SheetOption {
  key: string;
  label: string;
}

function BottomSheet({
  visible,
  title,
  options,
  selected,
  onToggle,
  onClose,
  onClear,
}: {
  visible: boolean;
  title: string;
  options: SheetOption[];
  selected: string[];
  onToggle: (key: string) => void;
  onClose: () => void;
  onClear: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.sheet}>
          <View style={styles.sheetHandle} />

          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{title}</Text>
            <TouchableOpacity onPress={onClear} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.sheetClear}>Clear all</Text>
            </TouchableOpacity>
          </View>

          {options.map((opt) => {
            const active = selected.includes(opt.key);
            return (
              <TouchableOpacity
                key={opt.key}
                style={styles.sheetRow}
                onPress={() => { Haptics.selectionAsync(); onToggle(opt.key); }}
                activeOpacity={0.7}
              >
                <Text style={[styles.sheetRowText, active && styles.sheetRowTextActive]}>
                  {opt.label}
                </Text>
                <View style={[styles.sheetCheck, active && styles.sheetCheckActive]}>
                  {active && <Check size={13} color="#FFFFFF" strokeWidth={3} />}
                </View>
              </TouchableOpacity>
            );
          })}

          <TouchableOpacity style={styles.sheetDone} onPress={onClose}>
            <Text style={styles.sheetDoneText}>Done</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── Section Row ──────────────────────────────────────────────────────────────

const SectionRow = React.memo(({
  def,
  plans,
  wishlisted,
  onWishlist,
}: {
  def: SectionDef;
  plans: Plan[];
  wishlisted: Set<string>;
  onWishlist: (id: string, current: boolean) => void;
}) => {
  const handleSeeAll = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({
      pathname: '/plans-section',
      params: {
        title: def.title,
        from: def.from.toISOString(),
        to: def.to.toISOString(),
      },
    } as any);
  }, [def]);

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{def.title}</Text>
        <TouchableOpacity
          style={styles.seeAllButton}
          onPress={handleSeeAll}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <ArrowRight size={18} color="#1A1A1A" strokeWidth={2} />
        </TouchableOpacity>
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
SectionRow.displayName = 'SectionRow';

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function PlansScreen() {
  const queryClient = useQueryClient();
  const sectionDefs = useMemo(() => getSectionDefs(new Date()), []);

  const [mapView, setMapView] = useState(false);
  const [whenSheetOpen, setWhenSheetOpen] = useState(false);
  const [categorySheetOpen, setCategorySheetOpen] = useState(false);
  const [whenFilter, setWhenFilter] = useState<string[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<CategoryOption[]>([]);

  const [userId, setUserId] = React.useState<string | null>(null);
  React.useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  const { data: allPlans = [], isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ['events', 'feed', userId],
    queryFn: () => fetchPlans(userId!),
    enabled: !!userId,
    staleTime: 60_000,
    retry: 1,
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

  const handleWishlist = useCallback((planId: string, isCurrentlyWishlisted: boolean) => {
    wishlistMutation.mutate({ planId, isCurrentlyWishlisted });
  }, [wishlistMutation]);

  const sections = useMemo(
    () => filterIntoSections(allPlans, sectionDefs, categoryFilter, whenFilter),
    [allPlans, sectionDefs, categoryFilter, whenFilter],
  );

  // "When" sheet options mirror the section keys for this day
  const whenOptions = useMemo<SheetOption[]>(
    () => sectionDefs.map((s) => ({ key: s.key, label: s.title })),
    [sectionDefs],
  );

  const whenLabel = whenFilter.length === 0
    ? 'When'
    : whenFilter.length === 1
      ? sectionDefs.find((s) => s.key === whenFilter[0])?.title ?? 'When'
      : `When · ${whenFilter.length}`;

  const categoryLabel = categoryFilter.length === 0
    ? 'Category'
    : categoryFilter.length === 1 ? categoryFilter[0] : `Category · ${categoryFilter.length}`;

  const whenActive = whenFilter.length > 0;
  const categoryActive = categoryFilter.length > 0;

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.logoContainer}>
          <Image
            source={require('../../../assets/images/logo-wordmark.png')}
            style={styles.logoImage}
            contentFit="contain"
            contentPosition="left"
          />
        </View>
        <TouchableOpacity
          style={[styles.mapToggleButton, mapView && styles.mapToggleButtonActive]}
          onPress={() => { Haptics.selectionAsync(); setMapView((v) => !v); }}
          accessibilityLabel={mapView ? 'Switch to list view' : 'Switch to map view'}
        >
          {mapView
            ? <LayoutList size={20} color="#FFFFFF" strokeWidth={2} />
            : <Map size={20} color="#1A1A1A" strokeWidth={2} />}
        </TouchableOpacity>
      </View>

      {/* Filter Dropdowns */}
      <View style={styles.filterRow}>
        <TouchableOpacity
          style={[styles.dropdownPill, whenActive && styles.dropdownPillActive]}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setWhenSheetOpen(true); }}
        >
          <Text style={[styles.dropdownText, whenActive && styles.dropdownTextActive]} numberOfLines={1}>
            {whenLabel}
          </Text>
          <ChevronDown size={13} color={whenActive ? '#FFFFFF' : '#1A1A1A'} strokeWidth={2.5} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.dropdownPill, categoryActive && styles.dropdownPillActive]}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setCategorySheetOpen(true); }}
        >
          <Text style={[styles.dropdownText, categoryActive && styles.dropdownTextActive]} numberOfLines={1}>
            {categoryLabel}
          </Text>
          <ChevronDown size={13} color={categoryActive ? '#FFFFFF' : '#1A1A1A'} strokeWidth={2.5} />
        </TouchableOpacity>
      </View>

      {/* Content */}
      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#C4652A" />
        </View>
      ) : isError ? (
        <View style={styles.centered}>
          <Text style={styles.errorTitle}>Couldn't load plans</Text>
          <Text style={styles.errorMessage}>{(error as Error)?.message ?? 'Unknown error'}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => refetch()}>
            <Text style={styles.retryButtonText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      ) : mapView ? (
        <MapView
          style={styles.map}
          initialRegion={LA_REGION}
          showsUserLocation
          showsMyLocationButton={false}
        >
          {allPlans
            .filter((p) => p.latitude != null && p.longitude != null)
            .map((plan) => (
              <Marker
                key={plan.id}
                coordinate={{ latitude: plan.latitude!, longitude: plan.longitude! }}
                title={plan.title}
                description={plan.location_text ?? undefined}
                pinColor="#C4652A"
                onCalloutPress={() => router.push(`/plan/${plan.id}`)}
              />
            ))}
        </MapView>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor="#C4652A" />
          }
        >
          {sections.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No plans match your filters.</Text>
              <TouchableOpacity style={styles.emptyButton} onPress={() => router.push('/(tabs)/post')}>
                <Text style={styles.emptyButtonText}>Post a Plan</Text>
              </TouchableOpacity>
            </View>
          ) : (
            sections.map(({ def, plans }) => (
              <SectionRow
                key={def.key}
                def={def}
                plans={plans}
                wishlisted={wishlistedSet}
                onWishlist={handleWishlist}
              />
            ))
          )}
          <View style={{ height: 32 }} />
        </ScrollView>
      )}

      {/* When Sheet */}
      <BottomSheet
        visible={whenSheetOpen}
        title="When"
        options={whenOptions}
        selected={whenFilter}
        onToggle={(key) => setWhenFilter((prev) => prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key])}
        onClose={() => setWhenSheetOpen(false)}
        onClear={() => setWhenFilter([])}
      />

      {/* Category Sheet */}
      <BottomSheet
        visible={categorySheetOpen}
        title="Category"
        options={CATEGORY_OPTIONS.map((c) => ({ key: c, label: c }))}
        selected={categoryFilter}
        onToggle={(key) => setCategoryFilter((prev) => {
          const c = key as CategoryOption;
          return prev.includes(c) ? prev.filter((k) => k !== c) : [...prev, c];
        })}
        onClose={() => setCategorySheetOpen(false)}
        onClear={() => setCategoryFilter([])}
      />
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFF8F0' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  logoContainer: { justifyContent: 'center' },
  logoImage: { width: 160, height: 40 },
  mapToggleButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#F0E6D3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapToggleButtonActive: { backgroundColor: '#C4652A', borderColor: '#C4652A' },

  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 10,
    marginBottom: 20,
  },
  dropdownPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#F0E6D3',
  },
  dropdownPillActive: { backgroundColor: '#C4652A', borderColor: '#C4652A' },
  dropdownText: { fontSize: 14, fontWeight: '600', color: '#1A1A1A' },
  dropdownTextActive: { color: '#FFFFFF' },

  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  map: { flex: 1 },

  section: { marginBottom: 32 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 14,
  },
  sectionTitle: { fontSize: 20, fontWeight: '800', color: '#1A1A1A', letterSpacing: -0.3 },
  seeAllButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#F5F5F5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  carouselContent: { paddingHorizontal: 20 },

  emptyState: { alignItems: 'center', paddingTop: 80, paddingHorizontal: 32 },
  emptyText: { fontSize: 16, color: '#666666', textAlign: 'center', marginBottom: 20 },
  emptyButton: { backgroundColor: '#C4652A', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 },
  emptyButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  errorTitle: { fontSize: 16, fontWeight: '700', color: '#1A1A1A', marginBottom: 8, textAlign: 'center' },
  errorMessage: { fontSize: 13, color: '#999999', textAlign: 'center', marginBottom: 20, paddingHorizontal: 32 },
  retryButton: { backgroundColor: '#C4652A', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 },
  retryButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },

  // Bottom Sheet
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingBottom: 44,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E5E5E5',
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 20,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: '#1A1A1A' },
  sheetClear: { fontSize: 14, color: '#999999', fontWeight: '500' },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F5F5F5',
  },
  sheetRowText: { fontSize: 16, color: '#1A1A1A', fontWeight: '500' },
  sheetRowTextActive: { color: '#C4652A', fontWeight: '700' },
  sheetCheck: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#DDDDDD',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetCheckActive: { backgroundColor: '#C4652A', borderColor: '#C4652A' },
  sheetDone: {
    marginTop: 20,
    backgroundColor: '#C4652A',
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
  },
  sheetDoneText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});
