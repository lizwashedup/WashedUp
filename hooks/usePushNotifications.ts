import { useEffect } from 'react';
import { OneSignal, OSNotificationPermission } from 'react-native-onesignal';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { supabase } from '../lib/supabase';

// Initialize OneSignal once at module load. Safe to call multiple times — the
// SDK guards against double-init internally — but doing it at module level
// means the click handler buffer is active before any component mounts, so
// cold-start notification taps are captured.
const ONESIGNAL_APP_ID =
  Constants.expoConfig?.extra?.oneSignalAppId ??
  process.env.EXPO_PUBLIC_ONESIGNAL_APP_ID ??
  '';

let initialized = false;
function ensureInitialized() {
  if (initialized || !ONESIGNAL_APP_ID) return;
  try {
    OneSignal.initialize(ONESIGNAL_APP_ID);
    initialized = true;
  } catch (err) {
    if (__DEV__) console.warn('[PushNotifications] OneSignal.initialize failed:', err);
  }
}

ensureInitialized();

function devicePlatform(): 'ios' | 'android' | 'web' | null {
  if (Platform.OS === 'ios') return 'ios';
  if (Platform.OS === 'android') return 'android';
  if (Platform.OS === 'web') return 'web';
  return null;
}

async function upsertDeviceToken(userId: string, playerId: string) {
  const platform = devicePlatform();
  if (!platform) return;

  const { error } = await supabase.from('device_tokens').upsert(
    {
      user_id: userId,
      platform,
      onesignal_player_id: playerId,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: 'onesignal_player_id' },
  );

  if (error) {
    console.error(
      '[PushNotifications] Failed to upsert device_tokens:',
      error.message,
      error.code ?? '',
      error.details ?? '',
    );
  }
}

export function usePushNotifications(userId?: string | null) {
  useEffect(() => {
    if (!userId) return;
    ensureInitialized();

    // Alias this device to the authenticated user. external_id is what the
    // server passes to OneSignal in include_aliases.external_id when sending.
    // OneSignal handles fanout to every device the user has registered.
    try {
      OneSignal.login(userId);
    } catch (err) {
      if (__DEV__) console.warn('[PushNotifications] OneSignal.login failed:', err);
    }

    // If a subscription already exists at mount (returning user, permission
    // granted previously), capture it. Subsequent changes are caught by the
    // observer below.
    OneSignal.User.pushSubscription
      .getIdAsync()
      .then((id) => {
        if (id) upsertDeviceToken(userId, id);
      })
      .catch(() => {});

    // Observe subscription changes — fires when user grants permission, when
    // the subscription id changes, or when opt-in state flips.
    const onSubscriptionChange = (event: any) => {
      const id = event?.current?.id;
      const optedIn = event?.current?.optedIn;
      if (id && optedIn) upsertDeviceToken(userId, id);
    };

    try {
      OneSignal.User.pushSubscription.addEventListener('change', onSubscriptionChange);
    } catch (err) {
      if (__DEV__) console.warn('[PushNotifications] addEventListener failed:', err);
    }

    return () => {
      try {
        OneSignal.User.pushSubscription.removeEventListener('change', onSubscriptionChange);
      } catch {}
    };
  }, [userId]);

  return {};
}

// Status helper for entry points that branch on 'granted'/'denied'/'undetermined'
// (e.g. profile settings showing "open Settings" only on hard denial). Maps
// OneSignal's permissionNative values to the legacy three-state shape.
export type PushPermissionStatus = 'granted' | 'denied' | 'undetermined';

export async function getPushPermissionStatus(): Promise<PushPermissionStatus> {
  ensureInitialized();
  try {
    const native = await OneSignal.Notifications.permissionNative();
    if (
      native === OSNotificationPermission.Authorized ||
      native === OSNotificationPermission.Provisional ||
      native === OSNotificationPermission.Ephemeral
    ) {
      return 'granted';
    }
    if (native === OSNotificationPermission.Denied) return 'denied';
    return 'undetermined';
  } catch {
    return 'undetermined';
  }
}

// Request permission (or just probe). Preserves the legacy signature so the
// onboarding/profile/chat-banner entry points don't need to change. Returns
// the OneSignal subscription id on success or null on denial / error.
export async function registerForPushNotifications(
  options: { prompt?: boolean; userId?: string | null } = {},
): Promise<string | null> {
  ensureInitialized();

  try {
    const hasPermission = OneSignal.Notifications.hasPermission();
    if (!hasPermission && options.prompt) {
      // Returns true if granted, false if denied or already denied.
      const granted = await OneSignal.Notifications.requestPermission(true);
      if (!granted) return null;
    } else if (!hasPermission) {
      return null;
    }
  } catch (err) {
    if (__DEV__) console.warn('[PushNotifications] permission check failed:', err);
    return null;
  }

  try {
    const playerId = await OneSignal.User.pushSubscription.getIdAsync();
    if (!playerId) return null;

    const targetUserId = options.userId ?? null;
    if (targetUserId) {
      await upsertDeviceToken(targetUserId, playerId);
    }

    return playerId;
  } catch (err) {
    if (__DEV__) console.warn('[PushNotifications] failed to read subscription id:', err);
    return null;
  }
}
