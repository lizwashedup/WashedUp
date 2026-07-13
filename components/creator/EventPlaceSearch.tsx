/**
 * EventPlaceSearch - the LA-biased venue search for the event form (doc 34
 * 3.2). A search row opens a sheet with Google Places autocomplete (the same
 * modules and key the composer's PlacePicker uses, no new dep); picking a
 * place hands back the venue name, the formatted address, and coordinates.
 *
 * The form seeds its venue and address fields from the pick and keeps them
 * editable, so legacy events and hand-tweaked names ("the back room at...")
 * still work. Coordinates are captured here but not yet persisted:
 * explore_events has no lat/lng columns, that schema rides proposal 35.
 */
import { useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GooglePlacesAutocomplete } from 'react-native-google-places-autocomplete';
import { ChevronLeft, MapPin, Search } from 'lucide-react-native';

import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { hapticLight } from '../../lib/haptics';
import { GOOGLE_MAPS_API_KEY } from '../../lib/googleMapsKey';

export interface EventPlacePick {
  venue: string;
  address: string;
  lat: number | null;
  lng: number | null;
}

interface EventPlaceSearchProps {
  onPick: (place: EventPlacePick) => void;
}

/** "1234 Sunset Blvd, Los Angeles, CA 90026, USA" -> drop the country tail. */
function trimAddress(formatted: string): string {
  return formatted.replace(/,\s*(USA|United States)$/i, '').trim();
}

export default function EventPlaceSearch({ onPick }: EventPlaceSearchProps) {
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');

  const handlePick = (data: any, details: any) => {
    hapticLight();
    const venue: string = data?.structured_formatting?.main_text ?? data?.description ?? '';
    const formatted: string = details?.formatted_address ?? data?.structured_formatting?.secondary_text ?? '';
    onPick({
      venue,
      address: trimAddress(formatted),
      lat: details?.geometry?.location?.lat ?? null,
      lng: details?.geometry?.location?.lng ?? null,
    });
    setSearching(false);
    setQuery('');
  };

  return (
    <View>
      <TouchableOpacity style={styles.searchField} onPress={() => { hapticLight(); setSearching(true); }} activeOpacity={0.7}>
        <Search size={15} color={Colors.secondary} strokeWidth={2} />
        {/* LIZ COPY */}
        <Text style={styles.searchPlaceholder}>find the place</Text>
      </TouchableOpacity>

      <Modal visible={searching} animationType="slide" onRequestClose={() => setSearching(false)} presentationStyle="pageSheet">
        <SafeAreaView style={styles.modal} edges={['top', 'bottom']}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => { setSearching(false); setQuery(''); }} hitSlop={10}>
              <ChevronLeft size={24} color={Colors.darkWarm} />
            </TouchableOpacity>
            {/* LIZ COPY */}
            <Text style={styles.modalTitle}>find the place</Text>
            <View style={styles.modalHeaderSpacer} />
          </View>
          <GooglePlacesAutocomplete
            placeholder="search for the venue"
            fetchDetails
            onPress={handlePick}
            query={{
              key: GOOGLE_MAPS_API_KEY,
              language: 'en',
              components: 'country:us',
              // the LA bias, matching the composer's PlacePicker
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
          {query.length === 0 && (
            /* LIZ COPY */
            <Text style={styles.hint}>the name and address fill in from here. you can still edit them after.</Text>
          )}
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  searchField: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, marginBottom: 10,
  },
  searchPlaceholder: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.inkSoft },
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
  },
  resultIcon: {
    width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.accentSubtle,
  },
  resultInfo: { flex: 1 },
  resultName: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.darkWarm },
  resultSub: { fontFamily: Fonts.sans, fontSize: 13, color: Colors.secondary, marginTop: 1 },
  hint: {
    fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.tertiary,
    paddingHorizontal: 16, paddingTop: 12,
  },
});
