import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Modal, Pressable, ActivityIndicator, StyleSheet, Linking, AppState } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { MapView, Marker } from '../MapView';
import Colors from '../../constants/Colors';
import { CreatorActionFill } from '../creator/CreatorActionFill';
import { Fonts, FontSizes } from '../../constants/Typography';

// Replaces the old "Share your location? Cancel/Send" alert with a proper
// preview: a map centered on the current location with a pin + the resolved
// address, so the user sees what they're sharing before sending. "Send current
// location" only (live location is deliberately out of scope).

const MAP_DELTA = 0.008;
const POSITION_WAIT_MS = 15000;
const ADDRESS_WAIT_MS = 5000;

interface LocationLoadAttempt {
  cancelWait?: () => void;
}

// Native GPS/geocoding promises cannot be canceled. End this preview's wait
// while retaining rejection handlers for eventual native results. A late result
// cannot replace a newer preview or turn a coordinate fallback into another pin.
function waitForLocationResult<T>(promise: Promise<T>, milliseconds: number, attempt: LocationLoadAttempt): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (complete: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (attempt.cancelWait === cancel) attempt.cancelWait = undefined;
      complete();
    };
    const cancel = () => finish(() => reject(new Error('Location preview retired')));
    const timer = setTimeout(() => finish(() => reject(new Error('Location lookup timed out'))), milliseconds);
    attempt.cancelWait = cancel;
    promise.then(value => finish(() => resolve(value)), error => finish(() => reject(error)));
  });
}

interface Coords {
  latitude: number;
  longitude: number;
}

interface LocationPickerModalProps {
  visible: boolean;
  retryPreservesMessage?: boolean;
  onClose: () => void;
  onConfirm: (latitude: number, longitude: number, address: string) => Promise<boolean>;
}

type Phase = 'loading' | 'ready' | 'denied' | 'error';

export default function LocationPickerModal({ visible, onClose, onConfirm, retryPreservesMessage = false }: LocationPickerModalProps) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [coords, setCoords] = useState<Coords | null>(null);
  const [address, setAddress] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(false);
  const [settingsError, setSettingsError] = useState(false);
  const visit = useMemo(() => ({}), [visible]);
  const activeVisit = useRef<typeof visit | null>(null);
  const loadAttempt = useRef<LocationLoadAttempt | null>(null);
  const sendAttempt = useRef<object | null>(null);
  const settingsAttempt = useRef<{ leftApp: boolean } | null>(null);
  const selectedPin = useRef<(Coords & { address: string }) | null>(null);
  const isCurrent = useCallback(() => visible && activeVisit.current === visit, [visible, visit]);

  useLayoutEffect(() => {
    activeVisit.current = visible ? visit : null;
    loadAttempt.current = null; sendAttempt.current = null; selectedPin.current = null; settingsAttempt.current = null;
    setPhase('loading'); setCoords(null); setAddress(''); setSending(false); setSendError(false); setSettingsError(false);
    return () => {
      if (activeVisit.current === visit) activeVisit.current = null;
      const pending = loadAttempt.current;
      loadAttempt.current = null; settingsAttempt.current = null;
      pending?.cancelWait?.();
    };
  }, [visible, visit]);

  const load = useCallback(async (recheckPermission = false) => {
    if (!isCurrent() || loadAttempt.current || sendAttempt.current) return;
    const attempt: LocationLoadAttempt = {}; loadAttempt.current = attempt;
    const current = () => isCurrent() && loadAttempt.current === attempt;
    selectedPin.current = null;
    setPhase('loading');
    setCoords(null);
    setAddress('');
    setSendError(false); setSettingsError(false);
    try {
      // Returning from Settings reads the new permission without opening an
      // unsolicited permission prompt. The user's initial prompt stays untimed.
      const { status } = await (recheckPermission ? Location.getForegroundPermissionsAsync() : Location.requestForegroundPermissionsAsync());
      if (!current()) return;
      if (status !== 'granted') { setPhase('denied'); return; }
      const loc = await waitForLocationResult(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }), POSITION_WAIT_MS, attempt);
      if (!current()) return;
      const { latitude, longitude } = loc.coords;
      setCoords({ latitude, longitude });
      let nextAddress: string;
      try {
        const place = (await waitForLocationResult(Location.reverseGeocodeAsync({ latitude, longitude }), ADDRESS_WAIT_MS, attempt))[0];
        if (!current()) return;
        const parts = place ? [place.name, place.street, place.city].filter(Boolean) : [];
        nextAddress = parts.length ? parts.join(', ') : `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
      } catch {
        if (!current()) return;
        nextAddress = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
      }
      if (!current()) return;
      // Coordinates and the displayed address are accepted together. A queued
      // send cannot combine a previous request's address with a newer pin.
      selectedPin.current = { latitude, longitude, address: nextAddress };
      setAddress(nextAddress);
      setPhase('ready');
    } catch {
      if (current()) setPhase('error');
    } finally {
      if (current()) loadAttempt.current = null;
    }
  }, [isCurrent]);

  useEffect(() => {
    if (visible) void load();
  }, [visible, load]);

  useEffect(() => {
    if (!visible) return;
    const subscription = AppState.addEventListener('change', state => {
      const attempt = settingsAttempt.current;
      if (!attempt || !isCurrent()) return;
      if (state === 'inactive' || state === 'background') attempt.leftApp = true;
      else if (state === 'active' && attempt.leftApp) {
        // Consume the intent before the async read. Ordinary foreground events
        // never restart a preview or request location permission.
        settingsAttempt.current = null;
        void load(true);
      }
    });
    return () => subscription.remove();
  }, [visible, isCurrent, load]);

  const handleSend = useCallback(async () => {
    const pin = selectedPin.current;
    if (!isCurrent() || !pin || sendAttempt.current || loadAttempt.current) return;
    const attempt = {}; sendAttempt.current = attempt;
    const current = () => isCurrent() && sendAttempt.current === attempt;
    setSending(true);
    setSendError(false);
    try {
      const confirmed = await onConfirm(pin.latitude, pin.longitude, pin.address);
      if (current() && !confirmed) setSendError(true);
    } catch {
      if (current()) setSendError(true);
    } finally {
      if (current()) { sendAttempt.current = null; setSending(false); }
    }
  }, [isCurrent, onConfirm]);

  const handleClose = useCallback(() => {
    if (!isCurrent() || sendAttempt.current) return;
    // Retire immediately; the parent may apply visible=false on a later render.
    activeVisit.current = null;
    const pending = loadAttempt.current;
    loadAttempt.current = null;
    pending?.cancelWait?.();
    selectedPin.current = null;
    settingsAttempt.current = null;
    onClose();
  }, [isCurrent, onClose]);

  const handleSettings = useCallback(async () => {
    if (!isCurrent() || settingsAttempt.current || loadAttempt.current || sendAttempt.current) return;
    const attempt = { leftApp: false }; settingsAttempt.current = attempt;
    setSettingsError(false);
    try {
      await Linking.openSettings();
    } catch {
      if (isCurrent() && settingsAttempt.current === attempt) {
        settingsAttempt.current = null;
        setSettingsError(true);
      }
    }
  }, [isCurrent]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleClose} statusBarTranslucent>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Pressable onPress={handleClose} disabled={sending} style={styles.headerControl} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
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
                  {settingsError && <Text style={styles.placeholderText} accessibilityRole="alert">Couldn't open Settings. Please try again.</Text>}
                  <Pressable onPress={handleSettings} style={styles.secondaryBtn} accessibilityRole="button">
                    <Text style={styles.secondaryText}>Open Settings</Text>
                  </Pressable>
                </>
              ) : (
                <>
                  <Text style={styles.placeholderText}>Couldn't get your location.</Text>
                  <Pressable onPress={() => { void load(); }} style={styles.secondaryBtn} accessibilityRole="button">
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
          <Text style={styles.privacyNote}>Shares this pin once with the chat. It won’t follow you or update your location.</Text>
          {sendError && <Text style={styles.sendError} accessibilityRole="alert">{retryPreservesMessage ? "Couldn't confirm delivery. Retry keeps the same pin." : "Couldn't confirm delivery. Your pin is still here. Check the chat before retrying."}</Text>}
          <Pressable
            onPress={handleSend}
            disabled={phase !== 'ready' || sending}
            style={[styles.sendBtn, (phase !== 'ready' || sending) && styles.sendBtnDisabled]}
            accessibilityRole="button"
            accessibilityLabel={sending ? 'Sending location' : sendError ? 'Retry sending current location' : 'Send current location'}
          >
            <CreatorActionFill />
            <Text numberOfLines={1} style={styles.sendText}>{sending ? 'Sending…' : sendError ? 'Try again' : 'Send location'}</Text>
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
  headerControl: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  headerSpacer: { width: 44 },
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
  privacyNote: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.warmGray, lineHeight: 20 },
  sendBtn: {
    backgroundColor: Colors.terracotta,
    borderRadius: 24,
    minHeight: 48,
    paddingHorizontal: 20,
    paddingVertical: 14,
    alignItems: 'center',
  },
  sendBtnDisabled: { opacity: 0.5 },
  sendError: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.errorRed },
  sendText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.white },
  secondaryBtn: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 18, paddingVertical: 10, borderRadius: 22, borderWidth: 1, borderColor: Colors.terracotta },
  secondaryText: { fontFamily: Fonts.sansSemibold, fontSize: FontSizes.bodyMD, color: Colors.terracotta },
});
