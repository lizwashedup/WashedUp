/**
 * PlacePicker - the WHERE control, never a bare text box. Three states:
 *   skipped  - an optional search field + one warm gold nudge; the plan posts
 *              anyway (no red, no blocking). Open-to-others gets a warmer nudge.
 *   searching- autocomplete + recent places (step 4).
 *   chosen   - map preview + pin + neighborhood + "change place" (step 4).
 *
 * Step 3 ships the skipped state + nudge (no maps dependency). Shared by both
 * composer surfaces.
 */
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MapPin, Search } from 'lucide-react-native';

import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';

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
  /** Opens the search state (wired in step 4). */
  onStartSearch?: () => void;
  /** Circle "open to others": show the slightly warmer nudge. */
  openToOthers?: boolean;
}

export default function PlacePicker({ value, onChange, onStartSearch, openToOthers }: PlacePickerProps) {
  if (value) {
    // Chosen (minimal here; the map preview + pin lands in step 4).
    return (
      <View style={styles.chosen}>
        <View style={styles.chosenIcon}>
          <MapPin size={15} color={Colors.terracotta} strokeWidth={2} />
        </View>
        <View style={styles.chosenInfo}>
          <Text style={styles.chosenName} numberOfLines={1}>{value.name}</Text>
          {value.neighborhood ? (
            <Text style={styles.chosenHood} numberOfLines={1}>{value.neighborhood} · Los Angeles</Text>
          ) : null}
        </View>
        <TouchableOpacity onPress={() => onChange(null)} hitSlop={8} activeOpacity={0.7}>
          <Text style={styles.changeText}>change</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Skipped: optional search field + one warm gold nudge.
  return (
    <View>
      <TouchableOpacity style={styles.searchField} onPress={onStartSearch} activeOpacity={0.7}>
        <Search size={15} color={Colors.secondary} strokeWidth={2} />
        <Text style={styles.searchPlaceholder}>add a place (optional)</Text>
      </TouchableOpacity>
      <View style={styles.nudge}>
        <View style={styles.nudgeDot} />
        <Text style={styles.nudgeText}>{openToOthers ? NUDGE_WARM : NUDGE_BASE}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
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

  chosen: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12,
  },
  chosenIcon: {
    width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.accentSubtle,
  },
  chosenInfo: { flex: 1 },
  chosenName: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.darkWarm },
  chosenHood: { fontFamily: Fonts.sans, fontSize: 13, color: Colors.secondary, marginTop: 2 },
  changeText: { fontFamily: Fonts.sansSemibold, fontSize: 13, color: Colors.terracotta },
});
