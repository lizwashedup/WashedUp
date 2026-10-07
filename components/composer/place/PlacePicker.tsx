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
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GooglePlacesAutocomplete } from 'react-native-google-places-autocomplete';
import * as Location from 'expo-location';
import { ChevronLeft, MapPin, Search } from 'lucide-react-native';

import Colors, { AfterglowColors } from '../../../constants/Colors';
import { Fonts, FontSizes, AfterglowType, type AfterglowFontFamilies } from '../../../constants/Typography';
import { hapticLight } from '../../../lib/haptics';
import { addRecentPlace, loadRecentPlaces, relativeUsed, type RecentPlace } from './recentPlaces';

import { GOOGLE_MAPS_API_KEY } from '../../../lib/googleMapsKey';

export interface PlaceValue {
  name: string;
  lat: number | null;
  lng: number | null;
  neighborhood: string | null;
}

interface PlacePickerProps {
  value: PlaceValue | null;
  onChange: (v: PlaceValue | null) => void;
  appearance?: { fonts: AfterglowFontFamilies };
}

/** Google Static Maps preview with a terracotta marker. An image (no native
 *  MapView), so it can never crash the composer on a modal-dismiss race. */
function staticMapUrl(lat: number, lng: number, color: string): string {
  const marker = `color:0x${color.replace('#', '')}%7C${lat},${lng}`;
  return (
    `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}` +
    `&zoom=15&size=600x240&scale=2&markers=${marker}&key=${GOOGLE_MAPS_API_KEY}`
  );
}

function PlaceMap({ lat, lng, appearance }: { lat: number; lng: number; appearance?: PlacePickerProps['appearance'] }) {
  const [failed, setFailed] = useState(false), live = useRef(true);
  useLayoutEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const s = useMemo(() => appearance ? { ...styles, ...placeAppearance(appearance.fonts) } : styles, [appearance?.fonts]);
  const accent = appearance ? AfterglowColors.clay : Colors.terracotta;
  return <View style={s.mapWrap}>
    {failed || !GOOGLE_MAPS_API_KEY ? <View style={s.mapFallback}><MapPin size={22} color={accent} strokeWidth={2} /></View> :
      <Image source={{ uri: staticMapUrl(lat, lng, accent) }} style={s.map} contentFit="cover" accessible={false}
        onError={() => { if (live.current) setFailed(true); }} />}
  </View>;
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

export default function PlacePicker({ value, onChange, appearance }: PlacePickerProps) {
  const [visit, setVisit] = useState<object | null>(null);
  const searching = visit !== null;
  const live = useRef(true), currentVisit = useRef<object | null>(null), pendingPick = useRef<object | null>(null);
  const [picking, setPicking] = useState(false);
  useLayoutEffect(() => { live.current = true; return () => { live.current = false; currentVisit.current = null; pendingPick.current = null; }; }, []);
  const [query, setQuery] = useState('');
  const [recents, setRecents] = useState<RecentPlace[]>([]);
  const [distanceMi, setDistanceMi] = useState<number | null>(null);
  const s = useMemo(() => appearance ? { ...styles, ...placeAppearance(appearance.fonts) } : styles, [appearance?.fonts]);
  const accent = appearance ? AfterglowColors.clay : Colors.terracotta;
  const current = (forVisit: object | null, attempt?: object) => live.current && !!forVisit && currentVisit.current === forVisit &&
    (!attempt || pendingPick.current === attempt);
  const open = () => {
    if (!live.current) return;
    const next = {}; currentVisit.current = next; pendingPick.current = null;
    setPicking(false); setVisit(next); setQuery('');
  };
  const close = (forVisit: object | null) => {
    if (!current(forVisit)) return;
    currentVisit.current = null; pendingPick.current = null;
    setVisit(null); setQuery(''); setPicking(false);
  };

  // Load recents when the search sheet opens.
  useEffect(() => {
    if (visit) loadRecentPlaces().then(places => { if (current(visit)) setRecents(places); });
  }, [visit]);

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

  const commit = async (v: PlaceValue, forVisit: object | null, attempt: object) => {
    if (!current(forVisit, attempt)) return;
    onChange(v);
    await addRecentPlace(v, Date.now());
    if (current(forVisit, attempt)) close(forVisit);
  };

  const handlePick = async (data: any, details: any) => {
    const forVisit = visit;
    if (!current(forVisit)) return;
    const attempt = {}; pendingPick.current = attempt; setPicking(true);
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
    await commit({ name, lat, lng, neighborhood }, forVisit, attempt);
  };

  const hasCoords = value != null && value.lat != null && value.lng != null;

  // Single return: the search Modal is one STABLE instance, rendered outside the
  // chosen/skipped branch. Rendering it inside the branch swapped two Modal
  // instances when value flipped null->chosen mid-present, leaving a stuck blank
  // pageSheet (the white-screen crash). Keep it here.
  return (
    <View>
      {value ? (
        <View style={s.chosen}>
          {hasCoords ? (
            <PlaceMap key={JSON.stringify([value.lat, value.lng, accent])} lat={value.lat!} lng={value.lng!} appearance={appearance}/>
          ) : null}
          <View style={s.chosenInfoRow}>
            <View style={s.chosenInfo}>
              <Text style={s.chosenName} numberOfLines={appearance ? undefined : 1}>{value.name}</Text>
              {(!appearance || !!value.neighborhood) && <Text style={s.chosenHood} numberOfLines={appearance ? undefined : 1}>
                {appearance ? value.neighborhood : value.neighborhood ? `${value.neighborhood} · Los Angeles` : 'Los Angeles'}
              </Text>}
              {distanceMi != null ? (
                <Text style={s.chosenDist}>{distanceMi.toFixed(1)} mi away</Text>
              ) : null}
            </View>
            <TouchableOpacity onPress={() => { hapticLight(); open(); }} style={appearance ? s.change : undefined} hitSlop={8} activeOpacity={0.7}
              accessibilityRole="button" accessibilityLabel={appearance ? 'Change place' : 'change place'} accessibilityState={{ expanded: searching }}>
              <Text style={s.changeText} numberOfLines={1}>{appearance ? 'Change' : 'change place'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        // Skipped: just the search field. The place-skip nudge is owned by the
        // composer's nudge arbiter (at most one gold line shows), not here.
        <TouchableOpacity style={s.searchField} onPress={open} activeOpacity={0.7} accessibilityRole="button"
          accessibilityLabel={appearance ? 'Add a place (optional)' : 'add a place (optional)'} accessibilityState={{ expanded: searching }}>
          <Search size={15} color={appearance ? AfterglowColors.muted : Colors.secondary} strokeWidth={2} />
          <Text style={s.searchPlaceholder}>{appearance ? 'Add a place (optional)' : 'add a place (optional)'}</Text>
        </TouchableOpacity>
      )}
      {renderSearchModal()}
    </View>
  );

  function renderSearchModal() {
    return (
      <Modal visible={searching} animationType="slide" onRequestClose={() => close(visit)} presentationStyle="pageSheet">
        <SafeAreaView style={s.modal} edges={['top', 'bottom']} accessibilityViewIsModal onAccessibilityEscape={() => close(visit)}>
          <View style={s.modalHeader}>
            <TouchableOpacity onPress={() => close(visit)} style={appearance ? s.close : undefined} hitSlop={10}
              accessibilityRole="button" accessibilityLabel="Cancel place search">
              <ChevronLeft size={24} color={appearance ? AfterglowColors.ink : Colors.darkWarm} />
            </TouchableOpacity>
            <Text style={s.modalTitle} accessibilityRole="header">{appearance ? 'Add a place' : 'add a place'}</Text>
            <View style={s.modalHeaderSpacer} />
          </View>
          <GooglePlacesAutocomplete
            placeholder={appearance ? 'Search for a place' : 'search for a place'}
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
              placeholderTextColor: appearance ? AfterglowColors.muted : Colors.inkSoft,
              onChangeText: (next: string) => { if (current(visit)) setQuery(next); },
              autoFocus: true,
              accessibilityLabel: 'Search for a place',
            }}
            styles={{
              container: s.acContainer,
              textInputContainer: s.acInputContainer,
              textInput: s.acInput,
              row: s.acRow,
              description: s.acDescription,
              separator: s.acSeparator,
            }}
            renderRow={(row: any) => (
              <View style={s.resultRow}>
                <View style={s.resultIcon}>
                  <MapPin size={14} color={accent} strokeWidth={2} />
                </View>
                <View style={s.resultInfo}>
                  <Text style={s.resultName} numberOfLines={appearance ? undefined : 1}>
                    {row?.structured_formatting?.main_text ?? row?.description}
                  </Text>
                  {row?.structured_formatting?.secondary_text ? (
                    <Text style={s.resultSub} numberOfLines={appearance ? undefined : 1}>{row.structured_formatting.secondary_text}</Text>
                  ) : null}
                </View>
              </View>
            )}
          />
          {appearance && picking && <Text style={s.choosing} accessibilityLiveRegion="polite">Choosing place…</Text>}
          {query.length === 0 && recents.length > 0 ? (
            <View style={s.recentsWrap}>
              <Text style={s.recentsLabel}>{appearance ? 'Recent places' : 'recent places'}</Text>
              {recents.map((r) => (
                <TouchableOpacity
                  key={`${r.name}-${r.usedAt}`}
                  style={s.resultRow}
                  activeOpacity={0.7}
                  accessibilityRole="button" accessibilityLabel={r.name}
                  onPress={() => {
                    if (!current(visit)) return;
                    const attempt = {}; pendingPick.current = attempt; setPicking(true); hapticLight();
                    void commit({ name: r.name, lat: r.lat, lng: r.lng, neighborhood: r.neighborhood }, visit, attempt);
                  }}
                >
                  <View style={s.resultIconMuted}>
                    <MapPin size={14} color={appearance ? AfterglowColors.muted : Colors.secondary} strokeWidth={2} />
                  </View>
                  <View style={s.resultInfo}>
                    <Text style={s.resultName} numberOfLines={appearance ? undefined : 1}>{r.name}</Text>
                    <Text style={s.resultSub} numberOfLines={appearance ? undefined : 1}>
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
  close: {}, change: {}, choosing: {},
  // Skipped
  searchField: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13,
  },
  searchPlaceholder: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyLG, color: Colors.inkSoft },

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
  modalTitle: { fontFamily: Fonts.display, fontSize: 22, color: Colors.darkWarm },
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

function placeAppearance(fonts: AfterglowFontFamilies) { return StyleSheet.create({
  searchField: { ...styles.searchField, minHeight: 48, backgroundColor: AfterglowColors.white, borderColor: AfterglowColors.line, borderRadius: 4 },
  searchPlaceholder: { flex: 1, ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.muted },
  chosen: { ...styles.chosen, borderRadius: 4, backgroundColor: AfterglowColors.white, borderColor: AfterglowColors.line },
  mapWrap: { ...styles.mapWrap, height: 100, backgroundColor: AfterglowColors.avatar },
  mapFallback: { ...styles.mapFallback, backgroundColor: AfterglowColors.avatar },
  chosenInfoRow: { ...styles.chosenInfoRow, paddingVertical: 8, gap: 8 },
  chosenInfo: { flex: 1, minWidth: 0 },
  chosenName: { ...AfterglowType.title, fontFamily: fonts.semibold, color: AfterglowColors.ink },
  chosenHood: { ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.muted, marginTop: 2 },
  chosenDist: { ...AfterglowType.caption, fontFamily: fonts.regular, color: AfterglowColors.muted, marginTop: 2 },
  change: { minWidth: 44, minHeight: 44, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
  changeText: { ...AfterglowType.body, fontFamily: fonts.semibold, color: AfterglowColors.clay },
  modal: { flex: 1, backgroundColor: AfterglowColors.paper },
  modalHeader: { ...styles.modalHeader, paddingVertical: 8, borderBottomColor: AfterglowColors.line },
  close: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  modalTitle: { ...AfterglowType.contextTitle, fontFamily: fonts.semibold, color: AfterglowColors.ink, flexShrink: 1 },
  modalHeaderSpacer: { width: 44 },
  acInput: { ...styles.acInput, ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.ink,
    minHeight: 48, borderRadius: 4, backgroundColor: AfterglowColors.white, borderColor: AfterglowColors.line },
  acDescription: { ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.ink },
  resultRow: { ...styles.resultRow, minHeight: 56, paddingVertical: 12, borderBottomColor: AfterglowColors.subtleLine },
  resultIcon: { ...styles.resultIcon, borderRadius: 4, backgroundColor: AfterglowColors.avatar },
  resultIconMuted: { ...styles.resultIconMuted, borderRadius: 4, backgroundColor: AfterglowColors.avatar },
  resultInfo: { flex: 1, minWidth: 0 },
  resultName: { ...AfterglowType.body, fontFamily: fonts.semibold, color: AfterglowColors.ink },
  resultSub: { ...AfterglowType.caption, fontFamily: fonts.regular, color: AfterglowColors.muted, marginTop: 2 },
  recentsLabel: { ...AfterglowType.section, fontFamily: fonts.semibold, color: AfterglowColors.muted, paddingHorizontal: 16, marginBottom: 8 },
  choosing: { ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.muted, paddingVertical: 12, paddingHorizontal: 16 },
}); }
