import React, { useState, useCallback, useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Dimensions, Platform } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { ArrowLeft, MapPin, Calendar, Users, ChevronDown } from 'lucide-react-native';
// HOTFIX 2026-04-13: react-native-view-shot is NOT in the iOS App Store 1.0.3
// native binary (it was added to package.json after the binary was built).
// The earlier OTA shipped this import to production iOS, which crashes the
// map view on every open because the JS engine can't resolve the missing
// native module. Removed for now — Android falls back to pinColor markers
// (functional but unstyled). Proper labeled-pill replacement comes in 1.0.4.
import { hapticLight, hapticSelection } from '../../lib/haptics';
import * as Location from 'expo-location';
import { MapView, Marker } from '../MapView.native';
import { MAP_STYLE } from '../../constants/MapStyle';
import { CATEGORY_OPTIONS } from '../../constants/Categories';
import { FilterBottomSheet } from '../FilterBottomSheet';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { capDisplayCount, MAX_GROUP } from '../../constants/GroupLimits';
import { getPlanPinColor, isHappeningNow } from '../../lib/planColors';
import type { Plan } from '../../lib/fetchPlans';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const LA_REGION = {
  latitude: 34.0522,
  longitude: -118.2437,
  latitudeDelta: 0.4,
  longitudeDelta: 0.4,
};

function formatDateShort(dateString: string): string {
  const d = new Date(dateString);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrowStart = new Date(todayStart.getTime() + 86400000);
  const dateStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());

  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  if (dateStart.getTime() === todayStart.getTime()) return `Today at ${time}`;
  if (dateStart.getTime() === tomorrowStart.getTime()) return `Tomorrow at ${time}`;
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) + ` at ${time}`;
}

interface PlansMapViewProps {
  plans: Plan[];
  wishlistedSet: Record<string, boolean>;
  onPlanPress: (planId: string) => void;
  onClose: () => void;
  onWishlist?: (planId: string, current: boolean) => void;
}

const IS_ANDROID = Platform.OS === 'android';

interface PlanMarkerProps {
  plan: Plan;
  isSelected: boolean;
  pinBg: string;
  happeningNow: boolean;
  onPress: (plan: Plan) => void;
}

function PlanMarker({ plan, isSelected, pinBg, happeningNow, onPress }: PlanMarkerProps) {
  const [tracks, setTracks] = useState(!IS_ANDROID);

  const label = plan.title.length > 12 ? plan.title.slice(0, 12) + '...' : plan.title;

  // iOS: turn off tracking after first paint
  useEffect(() => {
    if (!IS_ANDROID) {
      const t = setTimeout(() => setTracks(false), 300);
      return () => clearTimeout(t);
    }
  }, []);

  // Android: always image-only (no custom View children — breaks on Android).
  // Happening-now gets the gold LIVE teardrop; regular plans get pinColor.
  if (IS_ANDROID) {
    return (
      <Marker
        coordinate={{ latitude: plan.location_lat!, longitude: plan.location_lng! }}
        onPress={() => onPress(plan)}
        tracksViewChanges={false}
        stopPropagation
        anchor={{ x: 0.5, y: 1 }}
        {...(happeningNow
          ? { image: require('../../assets/markers/happening-now.png') }
          : { pinColor: pinBg }
        )}
      />
    );
  }

  // iOS: custom View pill markers.
  // Happening-now: gold pill, 1.3x larger, terracotta dot + "live · X there".
  if (happeningNow) {
    const going = Math.max(1, capDisplayCount(plan.member_count));
    return (
      <Marker
        coordinate={{ latitude: plan.location_lat!, longitude: plan.location_lng! }}
        onPress={() => onPress(plan)}
        tracksViewChanges={tracks || isSelected}
        stopPropagation
        anchor={{ x: 0.5, y: 1 }}
      >
        <View style={[styles.markerWrap, { transform: [{ scale: 1.3 }] }]} pointerEvents="none">
          <View style={[styles.happeningNowPin, isSelected && styles.pinSelected]}>
            <View style={styles.happeningNowDot} />
            <Text style={styles.happeningNowPinText} numberOfLines={1} allowFontScaling={false}>
              {`live \u00B7 ${going} there`}
            </Text>
          </View>
          <View style={[styles.pinArrow, { borderTopColor: Colors.pinHappeningNow }]} />
        </View>
      </Marker>
    );
  }

  // Regular iOS pill (plan title, category color).
  return (
    <Marker
      coordinate={{ latitude: plan.location_lat!, longitude: plan.location_lng! }}
      onPress={() => onPress(plan)}
      tracksViewChanges={tracks || isSelected}
      stopPropagation
      anchor={{ x: 0.5, y: 1 }}
    >
      <View style={styles.markerWrap} pointerEvents="none">
        <View style={[styles.pin, { backgroundColor: pinBg }, isSelected && styles.pinSelected]}>
          <Text style={styles.pinText} numberOfLines={1} allowFontScaling={false}>
            {label}
          </Text>
        </View>
        <View style={[styles.pinArrow, { borderTopColor: pinBg }]} />
      </View>
    </Marker>
  );
}

export default function PlansMapView({ plans, wishlistedSet, onPlanPress, onClose, onWishlist }: PlansMapViewProps) {
  const [selectedFilter, setSelectedFilter] = useState<string | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [heartFilter, setHeartFilter] = useState(false);
  const [categorySheetOpen, setCategorySheetOpen] = useState(false);
  const [locationGranted, setLocationGranted] = useState(false);
  const mapRef = useRef<any>(null);

  useEffect(() => {
    Location.requestForegroundPermissionsAsync().then(({ status }) => {
      setLocationGranted(status === 'granted');
    });
  }, []);

  const filteredPlans = plans.filter((p) => {
    if (!p.location_lat || !p.location_lng) return false;
    if (selectedFilter && (p.category?.toLowerCase() !== selectedFilter.toLowerCase())) return false;
    if (heartFilter && !wishlistedSet[p.id]) return false;
    return true;
  });

  const handleMarkerPress = useCallback((plan: Plan) => {
    hapticLight();
    setSelectedPlan((prev) => {
      if (prev?.id === plan.id) {
        setTimeout(() => onPlanPress(plan.id), 0);
        return prev;
      }
      return plan;
    });
    if (plan.location_lat && plan.location_lng && mapRef.current) {
      mapRef.current.animateToRegion({
        latitude: plan.location_lat - 0.02,
        longitude: plan.location_lng,
        latitudeDelta: 0.08,
        longitudeDelta: 0.08,
      }, 300);
    }
  }, [onPlanPress]);

  const handleMapPress = useCallback(() => {
    setSelectedPlan(null);
  }, []);

  const going = selectedPlan ? capDisplayCount(selectedPlan.member_count) : 0;
  const totalCapacity = selectedPlan ? Math.min((selectedPlan.max_invites ?? 7) + 1, MAX_GROUP) : 0;

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={LA_REGION}
        customMapStyle={MAP_STYLE}
        showsUserLocation={locationGranted}
        showsMyLocationButton={false}
        toolbarEnabled={false}
        moveOnMarkerPress={false}
        loadingEnabled
        loadingIndicatorColor={Colors.terracotta}
        onPress={handleMapPress}
      >
        {filteredPlans.map((plan) => (
          <PlanMarker
            key={plan.id}
            plan={plan}
            isSelected={selectedPlan?.id === plan.id}
            pinBg={getPlanPinColor(plan)}
            happeningNow={isHappeningNow(plan)}
            onPress={handleMarkerPress}
          />
        ))}
      </MapView>

      {/* Top bar */}
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.backButton} onPress={onClose} activeOpacity={0.9}>
          <ArrowLeft size={20} color={Colors.asphalt} strokeWidth={2.5} />
        </TouchableOpacity>

        <View style={styles.countPill}>
          <Text style={styles.countText}>
            {filteredPlans.length} {filteredPlans.length === 1 ? 'plan' : 'plans'}
          </Text>
        </View>

        <View style={styles.topBarRight}>
          <TouchableOpacity
            style={[styles.categoryPill, selectedFilter !== null && styles.categoryPillActive]}
            onPress={() => {
              hapticSelection();
              setCategorySheetOpen(true);
            }}
            activeOpacity={0.8}
          >
            <Text style={[styles.categoryPillText, selectedFilter !== null && styles.categoryPillTextActive]}>
              {selectedFilter ?? 'Category'}
            </Text>
            <ChevronDown size={14} color={selectedFilter ? Colors.white : Colors.asphalt} strokeWidth={2} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.heartPill, heartFilter && styles.heartPillActive]}
            onPress={() => {
              hapticSelection();
              setHeartFilter(prev => !prev);
              setSelectedPlan(null);
            }}
            activeOpacity={0.8}
          >
            <Ionicons
              name={heartFilter ? 'bookmark' : 'bookmark-outline'}
              size={16}
              color={heartFilter ? Colors.white : Colors.asphalt}
            />
          </TouchableOpacity>
        </View>
      </View>

      {/* Selected plan card */}
      {selectedPlan && (
        <TouchableOpacity
          style={styles.planCard}
          onPress={() => onPlanPress(selectedPlan.id)}
          activeOpacity={0.95}
        >
          {selectedPlan.image_url && (
            <Image
              source={{ uri: selectedPlan.image_url }}
              style={styles.cardImage}
              contentFit="cover"
            />
          )}
          <View style={styles.cardContent}>
            {isHappeningNow(selectedPlan) && (
              <View style={styles.cardHappeningNowPill}>
                <Text style={styles.cardHappeningNowText}>happening now</Text>
              </View>
            )}
            {selectedPlan.category && (
              <View style={[styles.cardCatBadge, { backgroundColor: getPlanPinColor(selectedPlan) }]}>
                <Text style={styles.cardCatText}>{selectedPlan.category}</Text>
              </View>
            )}
            <Text style={styles.cardTitle} numberOfLines={2}>{selectedPlan.title}</Text>

            <View style={styles.cardMeta}>
              <Calendar size={13} color={Colors.textMedium} strokeWidth={2} />
              <Text style={styles.cardMetaText}>{formatDateShort(selectedPlan.start_time)}</Text>
            </View>

            {selectedPlan.location_text && !selectedPlan.location_text.startsWith('http') && (
              <View style={styles.cardMeta}>
                <MapPin size={13} color={Colors.textMedium} strokeWidth={2} />
                <Text style={styles.cardMetaText} numberOfLines={1}>{selectedPlan.location_text}</Text>
              </View>
            )}

            <View style={styles.cardBottom}>
              <View style={styles.cardMeta}>
                <Users size={13} color={Colors.textMedium} strokeWidth={2} />
                <Text style={styles.cardMetaText}>{`${going} of ${totalCapacity}`}</Text>
              </View>
              {onWishlist && (
                <TouchableOpacity
                  style={styles.cardHeart}
                  onPress={(e) => {
                    e.stopPropagation();
                    hapticLight();
                    onWishlist(selectedPlan.id, !!wishlistedSet[selectedPlan.id]);
                  }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons
                    name={wishlistedSet[selectedPlan.id] ? 'bookmark' : 'bookmark-outline'}
                    size={18}
                    color={wishlistedSet[selectedPlan.id] ? Colors.terracotta : Colors.asphalt}
                  />
                </TouchableOpacity>
              )}
              <View style={styles.cardCta}>
                <Text style={styles.cardCtaText}>View Plan</Text>
              </View>
            </View>
          </View>
        </TouchableOpacity>
      )}

      <FilterBottomSheet
        visible={categorySheetOpen}
        title="Category"
        options={CATEGORY_OPTIONS.map((c) => ({ key: c, label: c }))}
        selected={selectedFilter ? [selectedFilter] : []}
        onToggle={(key) => {
          setSelectedFilter(prev => prev === key ? null : key);
          setSelectedPlan(null);
        }}
        onClose={() => setCategorySheetOpen(false)}
        onClear={() => {
          setSelectedFilter(null);
          setSelectedPlan(null);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  topBar: {
    position: 'absolute',
    top: 12,
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 10,
    elevation: 10,
    gap: 8,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.shadowBlack,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 4,
  },

  countPill: {
    backgroundColor: Colors.white,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    shadowColor: Colors.shadowBlack,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  countText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.asphalt,
  },

  topBarRight: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
  },
  categoryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    shadowColor: Colors.shadowBlack,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  categoryPillActive: {
    backgroundColor: Colors.terracotta,
    borderColor: Colors.terracotta,
  },
  categoryPillText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.asphalt,
  },
  categoryPillTextActive: {
    color: Colors.white,
  },
  heartPill: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.shadowBlack,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  heartPillActive: {
    backgroundColor: Colors.terracotta,
  },

  offscreen: {
    position: 'absolute',
    left: -1000,
    top: -1000,
    alignItems: 'center',
    opacity: 1,
  },
  markerWrap: {
    alignItems: 'center',
    width: 140,
    height: 40,
  },
  pin: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 16,
    maxWidth: 140,
    alignSelf: 'center',
  },
  pinSelected: {
    transform: [{ scale: 1.1 }],
    shadowColor: Colors.shadowBlack,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 6,
  },
  pinText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    color: Colors.white,
    textAlign: 'center',
  },
  happeningNowPin: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.pinHappeningNow,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 16,
    maxWidth: 160,
    alignSelf: 'center',
    gap: 5,
  },
  happeningNowDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.terracotta,
  },
  happeningNowPinText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    color: Colors.darkWarm,
    textAlign: 'center',
  },
  pinArrow: {
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    alignSelf: 'center',
  },

  planCard: {
    position: 'absolute',
    bottom: 24,
    left: 16,
    right: 16,
    backgroundColor: Colors.white,
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: Colors.shadowBlack,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
    zIndex: 10,
  },
  cardImage: {
    width: '100%',
    height: 120,
  },
  cardContent: {
    padding: 14,
    gap: 6,
  },
  cardHappeningNowPill: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.pinHappeningNow,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    marginBottom: 4,
  },
  cardHappeningNowText: {
    fontFamily: Fonts.sansBold,
    fontSize: 10,
    color: Colors.darkWarm,
    letterSpacing: 0.2,
  },
  cardCatBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
    marginBottom: 2,
    backgroundColor: Colors.terracotta,
  },
  cardCatText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.caption,
    color: Colors.white,
  },
  cardTitle: {
    fontFamily: Fonts.displayBold,
    fontSize: FontSizes.displaySM,
    color: Colors.asphalt,
    lineHeight: 24,
  },
  cardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  cardMetaText: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.textMedium,
    flex: 1,
  },
  cardBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
    gap: 8,
  },
  cardHeart: {
    padding: 4,
    marginLeft: 'auto',
  },
  cardCta: {
    backgroundColor: Colors.terracotta,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 14,
  },
  cardCtaText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.white,
  },
});
