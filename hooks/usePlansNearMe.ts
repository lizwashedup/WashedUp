import { useCallback, useRef, useState } from 'react';
import { Linking } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { hapticLight } from '../lib/haptics';
import { requestNearMeLocation, type NearMeCoords } from '../lib/location/nearMe';

type Notice = { reason: 'denied' | 'unavailable'; message: string };
type Pending = 'location' | 'settings' | null;

/** Explicit-tap location, with the cached fix retained when switched off. */
export function usePlansNearMe() {
  const [enabled, setEnabled] = useState(false);
  const [coords, setCoords] = useState<NearMeCoords | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [renderedVisit, setRenderedVisit] = useState<object | null>(null);
  const state = useRef({ enabled, coords, notice });
  const visit = useRef<object | null>(null);
  const attempt = useRef<object | null>(null);

  useFocusEffect(useCallback(() => {
    const entry = {}; visit.current = entry;
    setRenderedVisit(entry);
    setPending(null);
    return () => {
      if (visit.current === entry) {
        visit.current = null; attempt.current = null; setPending(null); setRenderedVisit(null);
      }
    };
  }, []));

  const updateNotice = useCallback((value: Notice | null) => {
    state.current.notice = value; setNotice(value);
  }, []);

  const toggle = useCallback(async () => {
    const entry = renderedVisit;
    if (!entry || visit.current !== entry || attempt.current) return;
    hapticLight();
    if (state.current.enabled) {
      state.current.enabled = false; setEnabled(false); updateNotice(null);
      return;
    }
    if (state.current.coords) {
      state.current.enabled = true; setEnabled(true); updateNotice(null);
      return;
    }
    const operation = {}; attempt.current = operation;
    const isCurrent = () => visit.current === entry && attempt.current === operation;
    setPending('location'); updateNotice(null);
    try {
      const result = await requestNearMeLocation();
      if (!isCurrent()) return;
      if (result.ok) {
        state.current.coords = result.coords; state.current.enabled = true;
        setCoords(result.coords); setEnabled(true); updateNotice(null);
      } else {
        updateNotice({ reason: result.reason, message: result.reason === 'denied'
          ? "Turn on location in Settings to see what's near you."
          : "Couldn't get your location. Try again." });
      }
    } catch {
      // The provider helper normally returns unavailable; a rejected call is
      // the same retryable result and must not escape the tap handler.
      if (isCurrent()) updateNotice({ reason: 'unavailable', message: "Couldn't get your location. Try again." });
    } finally {
      if (isCurrent()) { attempt.current = null; setPending(null); }
    }
  }, [renderedVisit, updateNotice]);

  const recover = useCallback(async () => {
    const entry = renderedVisit;
    if (!entry || visit.current !== entry || attempt.current || !state.current.notice) return;
    if (state.current.notice.reason === 'unavailable') { await toggle(); return; }
    const operation = {}; attempt.current = operation;
    const isCurrent = () => visit.current === entry && attempt.current === operation;
    hapticLight(); setPending('settings');
    try {
      await Linking.openSettings();
    } catch {
      if (isCurrent()) updateNotice({ reason: 'denied', message: "Couldn't open Settings. Allow location in your device settings, then try Near me." });
    } finally {
      if (isCurrent()) { attempt.current = null; setPending(null); }
    }
  }, [renderedVisit, toggle, updateNotice]);

  const clear = useCallback(() => {
    if (!renderedVisit || visit.current !== renderedVisit) return;
    attempt.current = null; setPending(null);
    state.current.enabled = false; setEnabled(false); updateNotice(null);
  }, [renderedVisit, updateNotice]);

  return {
    active: enabled && !!coords, coords, notice,
    pending: pending !== null,
    pendingLabel: pending === 'settings' ? 'Opening Settings…' : 'Finding your location…',
    toggle, recover, clear,
  };
}
