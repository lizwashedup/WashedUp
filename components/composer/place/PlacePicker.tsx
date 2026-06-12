/**
 * PlacePicker - the WHERE control, never a bare text box. Three states:
 *   skipped  - an optional search field + one warm gold nudge; the plan posts
 *              anyway (no red, no blocking). Open-to-others gets a warmer nudge.
 *   searching- Google Places autocomplete + recent places (relative-time
 *              provenance), in a sheet opened from the field.
 *   chosen   - a small map preview + terracotta pin + neighborhood + distance
 *              + "change place".
 *
 * Shared by both composer surfaces. Uses the existing native modules
 * (react-native-google-places-autocomplete, react-native-maps, expo-location)
 * and the EAS-secret-backed EXPO_PUBLIC_GOOGLE_MAPS_API_KEY - no new dep, no
 * new key.
 */
import { useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GooglePlacesAutocomplete } from 'react-native-google-places-autocomplete';
import * as Location from 'expo-location';
import { ChevronLeft, MapPin, Search } from 'lucide-react-native';

import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';
import { hapticLight } from '../../../lib/haptics';
import { addRecentPlace, loadRecentPlaces, relativeUsed, type RecentPlace } from './recentPlaces';

const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';

export interface PlaceValue {
  name: string;
  lat: number | null;
  lng: number | null;
  neighborhood: string | null;
}

const NUDGE_BASE = 'plans with a place get found more. you can always add one later.';
const NUDGE_WARM =
  'plans with a place get found more, and people are likelier to say yes. you can always add one later.';

interface PlacePickerProps {
  value: PlaceValue | null;
  onChange: (v: PlaceValue | null) => void;
  /** Circle "open to others": show the slightly warmer nudge. */
  openToOthers?: boolean;
}

/** Google Static Maps preview with a terracotta marker. An image (no native
 *  MapView), so it can never crash the composer on a modal-dismiss race. */
function staticMapUrl(lat: number, lng: number): string {
  const marker = `color:0xB5522E%7C${lat},${lng}`;
  return (
    `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}` +
    `&zoom=15&size=600x240&scale=2&markers=${marker}&key=${GOOGLE_MAPS_API_KEY}`
  );
}

function milesBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 3958.8;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

export default function PlacePicker({ value, onChange, openToOthers }: PlacePickerProps) {
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [recents, setRecents] = useState<RecentPlace[]>([]);
  const [distanceMi, setDistanceMi] = useState<number | null>(null);
  const [mapFailed, setMapFailed] = useState(false);

  // Reset the static-map fallback whenever the chosen place changes.
  useEffect(() => { setMapFailed(false); }, [value?.lat, value?.lng]);

  // Load recents when the search sheet opens.
  useEffect(() => {
    if (searching) loadRecentPlaces().then(setRecents);
  }, [searching]);

  // Best-effort distance for the chosen place (last-known position, no prompt).
  useEffect(() => {
    let cancelled = false;
    setDistanceMi(null);
    if (value?.lat != null && value?.lng != null) {
      (async () => {
        try {
          const pos = await Location.getLastKnownPositionAsync({});
          if (!cancelled && pos) {
            setDistanceMi(milesBetween(pos.coords.latitude, pos.coords.longitude, value.lat!, value.lng!));
          }
        } catch {
          /* no distance */
        }
      })();
    }
    return () => { cancelled = true; };
  }, [value?.lat, value?.lng]);

  const commit = async (v: PlaceValue) => {
    onChange(v);
    await addRecentPlace(v, Date.now());
    setSearching(false);
    setQuery('');
  };

  const handlePick = async (data: any, details: any) => {
    hapticLight();
    const lat: number | null = details?.geometry?.location?.lat ?? null;
    const lng: number | null = details?.geometry?.location?.lng ?? null;
    const name: string = data?.structured_formatting?.main_text ?? data?.description ?? '';
    let neighborhood: string | null = null;
    if (lat != null && lng != null) {
      try {
        const res = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
        const area = (res[0]?.district || res[0]?.subregion || res[0]?.city || '').trim();
        neighborhood = area || null;
      } catch {
        /* neighborhood stays null */
      }
    }
    await commit({ name, lat, lng, neighborhood });
  };

  const hasCoords = value != null && value.lat != null && value.lng != null;

  // Single return: the search Modal is one STABLE instance, rendered outside the
  // chosen/skipped branch. Rendering it inside the branch swapped two Modal
  // instances when value flipped null->chosen mid-present, leaving a stuck blank
  // pageSheet (the white-screen crash). Keep it here.
  return (
    <View>
      {value ? (
        <View style={styles.chosen}>
          {hasCoords ? (
            <View style={styles.mapWrap}>
              {mapFailed || !GOOGLE_MAPS_API_KEY ? (
                <View style={styles.mapFallback}>
                  <MapPin size={22} color={Colors.terracotta} strokeWidth={2} />
                </View>
              ) : (
                <Image
                  source={{ uri: staticMapUrl(value.lat!, value.lng!) }}
                  style={styles.map}
                  contentFit="cover"
                  onError={() => setMapFailed(true)}
                />
              )}
            </View>
          ) : null}
          <View style={styles.chosenInfoRow}>
            <View style={styles.chosenInfo}>
              <Text style={styles.chosenName} numberOfLines={1}>{value.name}</Text>
              <Text style={styles.chosenHood} numberOfLines={1}>
                {value.neighborhood ? `${value.neighborhood} · Los Angeles` : 'Los Angeles'}
              </Text>
              {distanceMi != null ? (
                <Text style={styles.chosenDist}>{distanceMi.toFixed(1)} mi away</Text>
              ) : null}
            </View>
            <TouchableOpacity onPress={() => { hapticLight(); setSearching(true); }} hitSlop={8} activeOpacity={0.7}>
              <Text style={styles.changeText}>change place</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View>
          <TouchableOpacity style={styles.searchField} onPress={() => setSearching(true)} activeOpacity={0.7}>
            <Search size={15} color={Colors.secondary} strokeWidth={2} />
            <Text style={styles.searchPlaceholder}>add a place (optional)</Text>
          </TouchableOpacity>
          <View style={styles.nudge}>
            <View style={styles.nudgeDot} />
            <Text style={styles.nudgeText}>{openToOthers ? NUDGE_WARM : NUDGE_BASE}</Text>
          </View>
        </View>
      )}
      {renderSearchModal()}
    </View>
  );

  function renderSearchModal() {
    return (
      <Modal visible={searching} animationType="slide" onRequestClose={() => setSearching(false)} presentationStyle="pageSheet">
        <SafeAreaView style={styles.modal} edges={['top', 'bottom']}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => { setSearching(false); setQuery(''); }} hitSlop={10}>
              <ChevronLeft size={24} color={Colors.darkWarm} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>add a place</Text>
            <View style={styles.modalHeaderSpacer} />
          </View>
          <GooglePlacesAutocomplete
            placeholder="search for a place"
            fetchDetails
            onPress={handlePick}
            query={{
              key: GOOGLE_MAPS_API_KEY,
              language: 'en',
              components: 'country:us',
              location: '34.0522,-118.2437',
              radius: '50000',
            }}
            debounce={300}
            enablePoweredByContainer={false}
            keepResultsAfterBlur
            textInputProps={{
              placeholderTextColor: Colors.inkSoft,
              onChangeText: setQuery,
              autoFocus: true,
            }}
            styles={{
              container: styles.acContainer,
              textInputContainer: styles.acInputContainer,
              textInput: styles.acInput,
              row: styles.acRow,
              description: styles.acDescription,
              separator: styles.acSeparator,
            }}
            renderRow={(row: any) => (
              <View style={styles.resultRow}>
                <View style={styles.resultIcon}>
                  <MapPin size={14} color={Colors.terracotta} strokeWidth={2} />
                </View>
                <View style={styles.resultInfo}>
                  <Text style={styles.resultName} numberOfLines={1}>
                    {row?.structured_formatting?.main_text ?? row?.description}
                  </Text>
                  {row?.structured_formatting?.secondary_text ? (
                    <Text style={styles.resultSub} numberOfLines={1}>{row.structured_formatting.secondary_text}</Text>
                  ) : null}
                </View>
              </View>
            )}
          />
          {query.length === 0 && recents.length > 0 ? (
            <View style={styles.recentsWrap}>
              <Text style={styles.recentsLabel}>recent places</Text>
              {recents.map((r) => (
                <TouchableOpacity
                  key={`${r.name}-${r.usedAt}`}
                  style={styles.resultRow}
                  activeOpacity={0.7}
                  onPress={() => { hapticLight(); commit({ name: r.name, lat: r.lat, lng: r.lng, neighborhood: r.neighborhood }); }}
                >
                  <View style={styles.resultIconMuted}>
                    <MapPin size={14} color={Colors.secondary} strokeWidth={2} />
                  </View>
                  <View style={styles.resultInfo}>
                    <Text style={styles.resultName} numberOfLines={1}>{r.name}</Text>
                    <Text style={styles.resultSub} numberOfLines={1}>
                      {r.neighborhood ? `${r.neighborhood} · ${relativeUsed(r.usedAt, Date.now())}` : relativeUsed(r.usedAt, Date.now())}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
        </SafeAreaView>
      </Modal>
    );
  }
}

const styles = StyleSheet.create({
  // Skipped
  searchField: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13,
  },
  searchPlaceholder: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyLG, color: Colors.inkSoft },
  nudge: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10,
    backgroundColor: Colors.goldBadgeSoft, borderWidth: 1, borderColor: Colors.goldAccent,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11,
  },
  nudgeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.gold },
  nudgeText: { flex: 1, fontFamily: Fonts.sans, fontSize: 13, lineHeight: 18, color: Colors.quoteText },

  // Chosen
  chosen: {
    backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 14, overflow: 'hidden',
  },
  mapWrap: { height: 120, width: '100%', backgroundColor: Colors.accentSubtle },
  map: { ...StyleSheet.absoluteFillObject },
  mapFallback: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.accentSubtle },
  chosenInfoRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12 },
  chosenInfo: { flex: 1 },
  chosenName: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.darkWarm },
  chosenHood: { fontFamily: Fonts.sans, fontSize: 13, color: Colors.secondary, marginTop: 2 },
  chosenDist: { fontFamily: Fonts.sans, fontSize: 13, color: Colors.tertiary, marginTop: 2 },
  changeText: { fontFamily: Fonts.sansSemibold, fontSize: 13, color: Colors.terracotta },

  // Search modal
  modal: { flex: 1, backgroundColor: Colors.cream },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  modalTitle: { fontFamily: Fonts.displayItalic, fontSize: 22, color: Colors.darkWarm },
  modalHeaderSpacer: { width: 24 },
  acContainer: { flex: 0, paddingHorizontal: 16, paddingTop: 14 },
  acInputContainer: { backgroundColor: 'transparent' },
  acInput: {
    height: 48, backgroundColor: Colors.white, borderRadius: 12, borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 14, fontFamily: Fonts.sans, fontSize: FontSizes.bodyLG, color: Colors.darkWarm,
  },
  acRow: { padding: 0, backgroundColor: 'transparent' },
  acDescription: { fontFamily: Fonts.sans },
  acSeparator: { height: 0 },
  resultRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  resultIcon: {
    width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.accentSubtle,
  },
  resultIconMuted: {
    width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.inputBg,
  },
  resultInfo: { flex: 1 },
  resultName: { fontFamily: Fonts.sansSemibold, fontSize: FontSizes.bodyMD, color: Colors.darkWarm },
  resultSub: { fontFamily: Fonts.sans, fontSize: 13, color: Colors.secondary, marginTop: 1 },
  recentsWrap: { marginTop: 18 },
  recentsLabel: {
    fontFamily: Fonts.sansSemibold, fontSize: 13, letterSpacing: 1.2, textTransform: 'uppercase',
    color: Colors.terracotta, paddingHorizontal: 16, marginBottom: 8,
  },
});
