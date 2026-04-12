import React, { useState, useCallback, useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Dimensions, ActivityIndicator, Linking } from 'react-native';
import { Image } from 'expo-image';
import { ArrowLeft, MapPin, Calendar, Heart, ChevronDown } from 'lucide-react-native';
import { hapticLight, hapticSelection } from '../lib/haptics';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { MapView, Marker } from './MapView.native';
import { MAP_STYLE } from '../constants/MapStyle';
import { CATEGORY_OPTIONS } from '../constants/Categories';
import { FilterBottomSheet } from './FilterBottomSheet';
import Colors from '../constants/Colors';
import { Fonts, FontSizes } from '../constants/Typography';
import { getPlanPinColor } from '../lib/planColors';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const LA_REGION = {
  latitude: 34.0522,
  longitude: -118.2437,
  latitudeDelta: 0.4,
  longitudeDelta: 0.4,
};

interface SceneEvent {
  id: string;
  title: string;
  description: string | null;
  image_url: string | null;
  event_date: string | null;
  start_time: string | null;
  venue: string | null;
  venue_address: string | null;
  category: string | null;
  external_url: string | null;
  ticket_price: string | null;
  plans_count: number;
}

interface GeocodedEvent extends SceneEvent {
  latitude: number;
  longitude: number;
}

function formatDateShort(dateStr: string | null, timeStr: string | null): string {
  if (!dateStr) return '';
  const date = new Date(dateStr.includes('T') ? dateStr : `${dateStr}T00:00:00`);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  let dayLabel: string;
  if (date.toDateString() === today.toDateString()) dayLabel = 'Tonight';
  else if (date.toDateString() === tomorrow.toDateString()) dayLabel = 'Tomorrow';
  else dayLabel = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  if (timeStr) {
    const [h, m] = timeStr.split(':');
    const d = new Date();
    d.setHours(parseInt(h, 10), parseInt(m, 10));
    const t = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    return `${dayLabel} · ${t}`;
  }
  return dayLabel;
}

interface SceneMapViewProps {
  events: SceneEvent[];
  wishlistedSet: Record<string, boolean>;
  onClose: () => void;
  onWishlist?: (id: string, current: boolean) => void;
}

export default function SceneMapView({ events, wishlistedSet, onClose, onWishlist }: SceneMapViewProps) {
  const [geocodedEvents, setGeocodedEvents] = useState<GeocodedEvent[]>([]);
  const [geocoding, setGeocoding] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState<GeocodedEvent | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [heartFilter, setHeartFilter] = useState(false);
  const [categorySheetOpen, setCategorySheetOpen] = useState(false);
  const [locationGranted, setLocationGranted] = useState(false);
  // See PlansMapView for the explanation of this flag — tracksViewChanges
  // starts true so Android's first marker snapshot captures the fully-laid
  // out pin, then flips to false for performance.
  const [tracksMarkerChanges, setTracksMarkerChanges] = useState(true);
  const mapRef = useRef<any>(null);

  useEffect(() => {
    Location.requestForegroundPermissionsAsync().then(({ status }) => {
      setLocationGranted(status === 'granted');
    });
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setTracksMarkerChanges(false), 500);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function geocodeAll() {
      const results: GeocodedEvent[] = [];
      for (const event of events) {
        if (cancelled) return;
        const address = event.venue_address || event.venue;
        if (!address) continue;
        try {
          const coords = await Location.geocodeAsync(address);
          if (coords.length > 0) {
            results.push({ ...event, latitude: coords[0].latitude, longitude: coords[0].longitude });
          }
        } catch {
          // Skip events that can't be geocoded
        }
      }
      if (!cancelled) {
        setGeocodedEvents(results);
        setGeocoding(false);
      }
    }
    geocodeAll();
    return () => { cancelled = true; };
  }, [events]);

  const filteredEvents = geocodedEvents.filter((e) => {
    if (categoryFilter && e.category?.toLowerCase() !== categoryFilter.toLowerCase()) return false;
    if (heartFilter && !wishlistedSet[e.id]) return false;
    return true;
  });

  const handleMarkerPress = useCallback((event: GeocodedEvent) => {
    hapticLight();
    setSelectedEvent((prev) => {
      if (prev?.id === event.id) {
        router.push(`/event/${event.id}`);
        return prev;
      }
      return event;
    });
    if (mapRef.current) {
      mapRef.current.animateToRegion({
        latitude: event.latitude - 0.02,
        longitude: event.longitude,
        latitudeDelta: 0.08,
        longitudeDelta: 0.08,
      }, 300);
    }
  }, []);

  const handleMapPress = useCallback(() => {
    setSelectedEvent(null);
  }, []);

  const isFree = selectedEvent
    ? !selectedEvent.ticket_price || selectedEvent.ticket_price.trim() === '' || selectedEvent.ticket_price.trim().toLowerCase() === 'free'
    : true;

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={LA_REGION}
        customMapStyle={MAP_STYLE}
        showsUserLocation={locationGranted}
        showsMyLocationButton={false}
        onPress={handleMapPress}
      >
        {filteredEvents.map((event) => {
          const catColor = getPlanPinColor({ category: event.category });
          const isSelected = selectedEvent?.id === event.id;
          return (
            <Marker
              key={event.id}
              coordinate={{ latitude: event.latitude, longitude: event.longitude }}
              onPress={() => handleMarkerPress(event)}
              tracksViewChanges={tracksMarkerChanges || isSelected}
              stopPropagation
              anchor={{ x: 0.5, y: 1 }}
            >
              <View style={styles.markerWrap} pointerEvents="none">
                <View style={[styles.pin, { backgroundColor: catColor }, isSelected && styles.pinSelected]}>
                  <Text style={styles.pinText} numberOfLines={1}>
                    {event.title.length > 14 ? event.title.slice(0, 14) + '...' : event.title}
                  </Text>
                </View>
                <View style={[styles.pinArrow, { borderTopColor: catColor }]} />
              </View>
            </Marker>
          );
        })}
      </MapView>

      {geocoding && (
        <View style={styles.geocodingOverlay}>
          <ActivityIndicator size="small" color={Colors.terracotta} />
          <Text style={styles.geocodingText}>Loading locations...</Text>
        </View>
      )}

      {/* Top bar */}
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.backButton} onPress={onClose} activeOpacity={0.9}>
          <ArrowLeft size={20} color={Colors.asphalt} strokeWidth={2.5} />
        </TouchableOpacity>

        <View style={styles.countPill}>
          <Text style={styles.countText}>
            {filteredEvents.length} {filteredEvents.length === 1 ? 'event' : 'events'}
          </Text>
        </View>

        <View style={styles.topBarRight}>
          <TouchableOpacity
            style={[styles.categoryPill, categoryFilter !== null && styles.categoryPillActive]}
            onPress={() => {
              hapticSelection();
              setCategorySheetOpen(true);
            }}
            activeOpacity={0.8}
          >
            <Text style={[styles.categoryPillText, categoryFilter !== null && styles.categoryPillTextActive]}>
              {categoryFilter ?? 'Category'}
            </Text>
            <ChevronDown size={14} color={categoryFilter ? Colors.white : Colors.asphalt} strokeWidth={2} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.heartPill, heartFilter && styles.heartPillActive]}
            onPress={() => {
              hapticSelection();
              setHeartFilter(prev => !prev);
              setSelectedEvent(null);
            }}
            activeOpacity={0.8}
          >
            <Heart
              size={16}
              color={heartFilter ? Colors.white : Colors.asphalt}
              fill={heartFilter ? Colors.white : 'transparent'}
              strokeWidth={2}
            />
          </TouchableOpacity>
        </View>
      </View>

      {/* Selected event card */}
      {selectedEvent && (
        <TouchableOpacity
          style={styles.eventCard}
          onPress={() => router.push(`/event/${selectedEvent.id}`)}
          activeOpacity={0.95}
        >
          {selectedEvent.image_url && (
            <Image
              source={{ uri: selectedEvent.image_url }}
              style={styles.cardImage}
              contentFit="cover"
            />
          )}
          <View style={styles.cardContent}>
            {selectedEvent.category && (
              <View style={[styles.cardCatBadge, { backgroundColor: getPlanPinColor({ category: selectedEvent.category }) }]}>
                <Text style={styles.cardCatText}>{selectedEvent.category}</Text>
              </View>
            )}
            <Text style={styles.cardTitle} numberOfLines={2}>{selectedEvent.title}</Text>

            {(selectedEvent.event_date || selectedEvent.start_time) && (
              <View style={styles.cardMeta}>
                <Calendar size={13} color={Colors.textMedium} strokeWidth={2} />
                <Text style={styles.cardMetaText}>{formatDateShort(selectedEvent.event_date, selectedEvent.start_time)}</Text>
              </View>
            )}

            {selectedEvent.venue && (
              <View style={styles.cardMeta}>
                <MapPin size={13} color={Colors.textMedium} strokeWidth={2} />
                <Text style={styles.cardMetaText} numberOfLines={1}>{selectedEvent.venue}</Text>
              </View>
            )}

            <View style={styles.cardBottom}>
              {onWishlist && (
                <TouchableOpacity
                  style={styles.cardHeart}
                  onPress={(e) => {
                    e.stopPropagation();
                    hapticLight();
                    onWishlist(selectedEvent.id, !!wishlistedSet[selectedEvent.id]);
                  }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Heart
                    size={18}
                    color={wishlistedSet[selectedEvent.id] ? Colors.errorRed : Colors.asphalt}
                    fill={wishlistedSet[selectedEvent.id] ? Colors.errorRed : 'transparent'}
                    strokeWidth={2}
                  />
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={styles.cardCta}
                onPress={() => {
                  if (selectedEvent.external_url && !isFree) {
                    Linking.openURL(selectedEvent.external_url);
                  } else {
                    router.push(`/event/${selectedEvent.id}`);
                  }
                }}
                activeOpacity={0.9}
              >
                <Text style={styles.cardCtaText}>{isFree ? 'View Event' : 'Get Tickets'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      )}

      <FilterBottomSheet
        visible={categorySheetOpen}
        title="Category"
        options={CATEGORY_OPTIONS.map((c) => ({ key: c, label: c }))}
        selected={categoryFilter ? [categoryFilter] : []}
        onToggle={(key) => {
          setCategoryFilter(prev => prev === key ? null : key);
          setSelectedEvent(null);
        }}
        onClose={() => setCategorySheetOpen(false)}
        onClear={() => {
          setCategoryFilter(null);
          setSelectedEvent(null);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  geocodingOverlay: {
    position: 'absolute',
    top: 70,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.white,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    shadowColor: Colors.shadowBlack,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    // elevation matches the iOS shadow visual; the pill sits above the map
    // (no siblings at the same y-coordinate), so it doesn't need to win an
    // elevation race against the topBar.
    elevation: 3,
    zIndex: 20,
  },
  geocodingText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.textMedium,
  },

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

  markerWrap: {
    alignItems: 'center',
  },
  pin: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 16,
    maxWidth: 150,
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

  eventCard: {
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
  cardCatBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
    marginBottom: 2,
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
    justifyContent: 'flex-end',
    marginTop: 4,
    gap: 8,
  },
  cardHeart: {
    padding: 4,
    marginRight: 'auto',
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
