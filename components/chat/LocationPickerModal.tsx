import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Modal, Pressable, ActivityIndicator, StyleSheet, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { MapView, Marker } from '../MapView';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';

// Replaces the old "Share your location? Cancel/Send" alert with a proper
// preview: a map centered on the current location with a pin + the resolved
// address, so the user sees what they're sharing before sending. "Send current
// location" only (live location is deliberately out of scope).

const MAP_DELTA = 0.008;

interface Coords {
  latitude: number;
  longitude: number;
}

interface LocationPickerModalProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: (latitude: number, longitude: number, address: string) => void;
}

type Phase = 'loading' | 'ready' | 'denied' | 'error';

export default function LocationPickerModal({ visible, onClose, onConfirm }: LocationPickerModalProps) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [coords, setCoords] = useState<Coords | null>(null);
  const [address, setAddress] = useState('');

  const load = useCallback(async () => {
    setPhase('loading');
    setCoords(null);
    setAddress('');
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { setPhase('denied'); return; }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { latitude, longitude } = loc.coords;
      setCoords({ latitude, longitude });
      try {
        const place = (await Location.reverseGeocodeAsync({ latitude, longitude }))[0];
        const parts = place ? [place.name, place.street, place.city].filter(Boolean) : [];
        setAddress(parts.length ? parts.join(', ') : `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`);
      } catch {
        setAddress(`${latitude.toFixed(5)}, ${longitude.toFixed(5)}`);
      }
      setPhase('ready');
    } catch {
      setPhase('error');
    }
  }, []);

  useEffect(() => {
    if (visible) load();
  }, [visible, load]);

  const handleSend = useCallback(() => {
    if (coords) onConfirm(coords.latitude, coords.longitude, address);
  }, [coords, address, onConfirm]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
            <Ionicons name="close" size={26} color={Colors.asphalt} />
          </Pressable>
          <Text style={styles.title}>Send location</Text>
          <View style={styles.headerSpacer} />
        </View>

        <View style={styles.mapWrap}>
          {phase === 'ready' && coords ? (
            <MapView
              style={styles.map}
              region={{ ...coords, latitudeDelta: MAP_DELTA, longitudeDelta: MAP_DELTA }}
              showsUserLocation
            >
              <Marker coordinate={coords} />
            </MapView>
          ) : (
            <View style={styles.mapPlaceholder}>
              {phase === 'loading' ? (
                <>
                  <ActivityIndicator color={Colors.terracotta} />
                  <Text style={styles.placeholderText}>Finding your location...</Text>
                </>
              ) : phase === 'denied' ? (
                <>
                  <Ionicons name="location-outline" size={32} color={Colors.warmGray} />
                  <Text style={styles.placeholderText}>Location access is off.</Text>
                  <Pressable onPress={() => Linking.openSettings()} style={styles.secondaryBtn} accessibilityRole="button">
                    <Text style={styles.secondaryText}>Open Settings</Text>
                  </Pressable>
                </>
              ) : (
                <>
                  <Text style={styles.placeholderText}>Couldn't get your location.</Text>
                  <Pressable onPress={load} style={styles.secondaryBtn} accessibilityRole="button">
                    <Text style={styles.secondaryText}>Try again</Text>
                  </Pressable>
                </>
              )}
            </View>
          )}
        </View>

        <View style={styles.footer}>
          {phase === 'ready' && (
            <View style={styles.addressRow}>
              <Ionicons name="location" size={18} color={Colors.terracotta} />
              <Text style={styles.address} numberOfLines={2}>{address}</Text>
            </View>
          )}
          <Pressable
            onPress={handleSend}
            disabled={phase !== 'ready'}
            style={[styles.sendBtn, phase !== 'ready' && styles.sendBtnDisabled]}
            accessibilityRole="button"
            accessibilityLabel="Send current location"
          >
            <Text style={styles.sendText}>Send current location</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.inputBg,
  },
  title: { flex: 1, textAlign: 'center', fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.asphalt },
  headerSpacer: { width: 26 },
  mapWrap: { flex: 1 },
  map: { flex: 1 },
  mapPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  placeholderText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.warmGray, textAlign: 'center' },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
    gap: 12,
    backgroundColor: Colors.cardBg,
    borderTopWidth: 1,
    borderTopColor: Colors.inputBg,
  },
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  address: { flex: 1, fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.asphalt },
  sendBtn: {
    backgroundColor: Colors.terracotta,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center',
    shadowColor: Colors.terracotta,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 3,
  },
  sendBtnDisabled: { opacity: 0.5 },
  sendText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.white },
  secondaryBtn: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 999, borderWidth: 1.5, borderColor: Colors.terracotta },
  secondaryText: { fontFamily: Fonts.sansSemibold, fontSize: FontSizes.bodyMD, color: Colors.terracotta },
});
