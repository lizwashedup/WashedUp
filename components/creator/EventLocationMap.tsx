/**
 * The creation-canvas location map (doc 92 §3.4). The named "map isn't
 * loading" defect was not a broken render or a missing key - the canvas
 * captured coordinates but never drew a tile. This is the tile + pin,
 * with the three states §3.4 asks for:
 *   (b) coords set    -> a map tile centered on the pin
 *   (c) nothing yet   -> a graceful prompt, never a broken grey box
 *   (d) geocode miss  -> "we couldn't find that, enter it below"
 *
 * Reuses the app's platform-split MapView wrapper (MapView.native /
 * .web), already key-wired via lib/googleMapsKey, so no new provider
 * setup and parity with the rest of the app's maps.
 */

import React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { MapPin, MapPinOff } from 'lucide-react-native';
// Extensionless import so Metro resolves MapView.web.tsx on web and
// MapView.native.tsx on native. Hardcoding .native pulls native-only
// react-native-maps into the web bundle and breaks the entire web build
// (matches components/plans/PlansMapView.tsx's existing correct pattern).
import { MapView, Marker } from '../MapView';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { EventSurface } from '../../constants/EventDesign';

const MAP_HEIGHT = 168;
// tight enough to read the block, loose enough to show the surrounding streets
const PIN_DELTA = 0.008;

interface EventLocationMapProps {
  coords: { lat: number; lng: number } | null;
  /** a place was chosen but geocoding returned no lat/lng */
  geocodeMissed?: boolean;
}

export function EventLocationMap({ coords, geocodeMissed }: EventLocationMapProps) {
  if (coords) {
    return (
      <View style={styles.mapFrame}>
        <MapView
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
          region={{
            latitude: coords.lat,
            longitude: coords.lng,
            latitudeDelta: PIN_DELTA,
            longitudeDelta: PIN_DELTA,
          }}
          scrollEnabled={false}
          zoomEnabled={false}
          pitchEnabled={false}
          rotateEnabled={false}
          toolbarEnabled={false}
          liteMode={Platform.OS === 'android'}
          showsMyLocationButton={false}
          loadingEnabled
          loadingIndicatorColor={Colors.terracotta}
        >
          <Marker coordinate={{ latitude: coords.lat, longitude: coords.lng }} anchor={{ x: 0.5, y: 1 }}>
            <MapPin size={28} color={Colors.terracotta} strokeWidth={2.5} fill={Colors.white} />
          </Marker>
        </MapView>
      </View>
    );
  }

  return (
    <View style={[styles.placeholder, geocodeMissed && styles.placeholderMiss]}>
      {geocodeMissed ? (
        <MapPinOff size={20} color={Colors.warmGray} strokeWidth={2} />
      ) : (
        <MapPin size={20} color={Colors.warmGray} strokeWidth={2} />
      )}
      {/* copy to the taste gate */}
      <Text style={styles.placeholderText}>
        {geocodeMissed
          ? "we couldn't find that. enter it below and it still saves."
          : 'pick a place and the map drops a pin here.'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  mapFrame: {
    height: MAP_HEIGHT,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: EventSurface.media,
    marginBottom: 14,
  },
  placeholder: {
    height: MAP_HEIGHT,
    borderRadius: 14,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: Colors.border,
    backgroundColor: Colors.parchment,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 24,
    marginBottom: 14,
  },
  placeholderMiss: { borderColor: Colors.errorBrand },
  placeholderText: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.warmGray,
    textAlign: 'center',
    lineHeight: 19,
  },
});
