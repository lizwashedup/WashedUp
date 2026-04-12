import { useState, useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform, AppState } from 'react-native';
import { supabase } from '../lib/supabase';
import Colors from '../constants/Colors';

// Global handler: controls how notifications are displayed when the app is in the foreground.
// Set once at module level so it's always active regardless of which component mounts first.
// Wrapped in try/catch because simulators lack push notification entitlements.
try {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });
} catch {}

export function usePushNotifications(userId?: string | null) {
  const [expoPushToken, setExpoPushToken] = useState<string>('');
  const notificationListener = useRef<Notifications.EventSubscription | null>(null);

  useEffect(() => {
    if (!userId) return;

    // On mount: only register if permission is ALREADY granted. Don't prompt
    // here — the prompt is shown contextually during onboarding (vibes screen)
    // so users see it after a meaningful moment instead of cold at launch.
    // Cold-launching the permission dialog before any context produces a much
    // higher denial rate, and once denied iOS won't show the prompt again.
    registerForPushNotifications({ prompt: false, userId }).then((token) => {
      if (token) setExpoPushToken(token);
    }).catch(() => {});

    // Re-check on every foreground transition. This catches the case where
    // the user denied the prompt but later enabled notifications via iOS
    // Settings — when they bring the app back to foreground we'll fetch the
    // token and save it without ever needing to ask again.
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        registerForPushNotifications({ prompt: false, userId }).then((token) => {
          if (token) setExpoPushToken(token);
        }).catch(() => {});
      }
    });

    notificationListener.current?.remove();
    notificationListener.current = Notifications.addNotificationReceivedListener(() => {});

    return () => {
      notificationListener.current?.remove();
      appStateSub.remove();
    };
  }, [userId]);

  return { expoPushToken };
}

export async function registerForPushNotifications(
  options: { prompt?: boolean; userId?: string | null } = {},
): Promise<string | null> {
  if (!Device.isDevice) return null;

  // Android requires a notification channel before any notification can be shown
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: Colors.terracotta,
    });
  }

  let finalStatus: string;
  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    finalStatus = existingStatus;

    // Only show the system permission prompt when the caller explicitly asks
    // for it (e.g. the vibes screen at the end of onboarding). Other call
    // sites — cold launch from the hook, foreground re-check — pass
    // prompt:false because they just want to know whether permission is
    // already granted, not surface a fresh dialog.
    if (existingStatus !== 'granted' && options.prompt) {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
  } catch {
    // Simulator doesn't support push notification entitlements
    return null;
  }

  if (finalStatus !== 'granted') return null;

  // Resolve projectId from app.json extra.eas — run `eas init` if this is missing
  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    (Constants as any).easConfig?.projectId;

  if (!projectId || projectId === 'YOUR_PROJECT_ID_RUN_EAS_INIT') return null;

  try {
    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
    const token = tokenData.data;

    // Save token to this user's profile row so the backend can send targeted
    // notifications. Surface upsert failures loudly — this used to silently
    // fail and we had no way to tell whether tokens were actually landing.
    // Prefer the userId passed in by the caller (the authenticated user id
    // from the hook) over a fresh getUser() call. On Android, getUser() can
    // race with a just-established session after login and return null,
    // which caused expo_push_token to silently never get written.
    let targetUserId = options.userId ?? null;
    if (!targetUserId) {
      const { data: { user } } = await supabase.auth.getUser();
      targetUserId = user?.id ?? null;
    }
    if (targetUserId && token) {
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ expo_push_token: token })
        .eq('id', targetUserId);
      if (updateError) {
        console.error(
          '[PushNotifications] Failed to save expo_push_token to profiles:',
          updateError.message,
          updateError.code ?? '',
          updateError.details ?? '',
        );
      }
    }

    return token;
  } catch (err) {
    if (__DEV__) {
      console.warn('[PushNotifications] getExpoPushTokenAsync failed:', err);
    }
    return null;
  }
}
