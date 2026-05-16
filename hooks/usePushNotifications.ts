import { useEffect } from 'react';
import { OneSignal, OSNotificationPermission } from 'react-native-onesignal';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { supabase } from '../lib/supabase';

// Singleton ready promise. Resolves true once OneSignal.initialize has been
// called and the native bridge has had a tick to settle. Resolves false if
// the app id is missing or initialize threw. All OneSignal access in this
// module (and the click listener in app/_layout.tsx) gates on this promise
// so we never call into the native SDK before initWithContext has run on
// Android.
let readyPromise: Promise<boolean> | null = null;

export function initOneSignal(): Promise<boolean> {
  // Master web guard: OneSignal's RN SDK is native-only. Resolving false here
  // means every path that funnels through ensureOneSignalReady() (the hook,
  // registerForPushNotifications, getPushPermissionStatus, the chat banner,
  // profile settings) becomes a guaranteed no-op on web with zero SDK calls.
  if (Platform.OS === 'web') {
    readyPromise = Promise.resolve(false);
    return readyPromise;
  }
  if (readyPromise) return readyPromise;
  const appId =
    Constants.expoConfig?.extra?.oneSignalAppId ??
    process.env.EXPO_PUBLIC_ONESIGNAL_APP_ID ??
    '';
  if (!appId) {
    readyPromise = Promise.resolve(false);
    return readyPromise;
  }
  readyPromise = new Promise<boolean>((resolve) => {
    try {
      OneSignal.initialize(appId);
      // Yield to the native bridge before any caller touches the SDK.
      setTimeout(() => resolve(true), 0);
    } catch (err) {
      if (__DEV__) console.warn('[PushNotifications] OneSignal.initialize failed:', err);
      resolve(false);
    }
  });
  return readyPromise;
}

export function ensureOneSignalReady(): Promise<boolean> {
  return readyPromise ?? initOneSignal();
}

function devicePlatform(): 'ios' | 'android' | 'web' | null {
  if (Platform.OS === 'ios') return 'ios';
  if (Platform.OS === 'android') return 'android';
  if (Platform.OS === 'web') return 'web';
  return null;
}

async function upsertDeviceToken(userId: string, playerId: string) {
  const platform = devicePlatform();
  if (!platform || platform === 'web') return;

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
    if (Platform.OS === 'web') return;

    let cancelled = false;
    let attached: ((event: any) => void) | null = null;

    const onSubscriptionChange = (event: any) => {
      const id = event?.current?.id;
      const optedIn = event?.current?.optedIn;
      if (id && optedIn) upsertDeviceToken(userId, id);
    };

    ensureOneSignalReady().then((ready) => {
      if (cancelled || !ready) return;

      try {
        OneSignal.login(userId);
      } catch (err) {
        if (__DEV__) console.warn('[PushNotifications] OneSignal.login failed:', err);
      }

      OneSignal.User.pushSubscription
        .getIdAsync()
        .then((id) => {
          if (!cancelled && id) upsertDeviceToken(userId, id);
        })
        .catch(() => {});

      try {
        OneSignal.User.pushSubscription.addEventListener('change', onSubscriptionChange);
        attached = onSubscriptionChange;
      } catch (err) {
        if (__DEV__) console.warn('[PushNotifications] addEventListener failed:', err);
      }
    });

    return () => {
      cancelled = true;
      if (attached) {
        try {
          OneSignal.User.pushSubscription.removeEventListener('change', attached);
        } catch {}
      }
    };
  }, [userId]);

  return {};
}

// Status helper for entry points that branch on 'granted'/'denied'/'undetermined'
// (e.g. profile settings showing "open Settings" only on hard denial). Maps
// OneSignal's permissionNative values to the legacy three-state shape.
export type PushPermissionStatus = 'granted' | 'denied' | 'undetermined';

export async function getPushPermissionStatus(): Promise<PushPermissionStatus> {
  if (!(await ensureOneSignalReady())) return 'undetermined';
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
  if (!(await ensureOneSignalReady())) return null;

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
    // The subscription id can lag a freshly-granted permission by a tick.
    // One short retry closes that race; the passive change listener in
    // usePushNotifications is the further backstop.
    let playerId = await OneSignal.User.pushSubscription.getIdAsync();
    if (!playerId) {
      await new Promise((r) => setTimeout(r, 1500));
      playerId = await OneSignal.User.pushSubscription.getIdAsync();
    }
    if (!playerId) return null;
    if (__DEV__) console.log('[PushNotifications] OneSignal player id:', playerId);

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
