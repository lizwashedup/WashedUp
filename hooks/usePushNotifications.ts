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
//
// OneSignal App ID. Prefer the build-time env var (EAS Secret / .env), but fall
// back to the known production App ID so a missing OR BLANK env var can NEVER
// silently disable push again. (2026-06: an env-var drop shipped appId='' in
// build 27 and every OTA after it, so OneSignal.initialize never ran -> ~0%
// push registration fleet-wide for 9 days. This mirrors the URL/anon-key
// fallback in lib/supabase.ts.) The App ID is a PUBLIC identifier (it ships in
// the client and rides in every notification payload), not a secret.
const DEFAULT_ONESIGNAL_APP_ID = 'fc98cc7c-b325-4a45-b3d2-19527c280fca';

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
  // Use || (NOT ??) so a present-but-BLANK env var ('') also falls through to
  // the hardcoded default. '' ?? DEFAULT returns '', which is the silent
  // empty-appId failure this fallback exists to prevent.
  const envAppId =
    Constants.expoConfig?.extra?.oneSignalAppId ||
    process.env.EXPO_PUBLIC_ONESIGNAL_APP_ID ||
    null;
  const appId = envAppId || DEFAULT_ONESIGNAL_APP_ID;
  if (!envAppId && __DEV__) {
    console.warn(
      '[PushNotifications] EXPO_PUBLIC_ONESIGNAL_APP_ID missing or blank; using hardcoded fallback App ID.',
    );
  }
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
