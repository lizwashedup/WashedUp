import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { LOCAL_DEVELOPMENT_ONLY } from '../constants/LocalDevelopment';

// Native responses can be delivered by both the listener and the initial read.
// Keep the consumed identities through a root remount, with bounded memory.
const consumed = new Set<string>();
const MAX_CONSUMED_RESPONSES = 64;
type Response = Notifications.NotificationResponse;

function responseKey(response: Response | null | undefined): string | null {
  const id = response?.notification?.request?.identifier;
  return response?.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER
    && typeof id === 'string' && id.length > 0 ? id : null;
}

/** Receive explicit Expo taps only; the root still owns routing and auth gates. */
export function subscribeExpoNotificationResponses(onData: (data: Record<string, unknown>) => void): () => void {
  if (LOCAL_DEVELOPMENT_ONLY || (Platform.OS !== 'ios' && Platform.OS !== 'android')) return () => {};
  let active = true;
  let subscription: { remove(): void } | undefined;
  const receive = (response: Response | null) => {
    if (!active) return;
    const key = responseKey(response);
    const data = response?.notification?.request?.content?.data;
    // OneSignal's own envelope, unrelated local notifications and action-button
    // responses must not become an unsolicited generic Chats navigation.
    if (!key || !data || Array.isArray(data) || typeof data !== 'object'
      || typeof data.type !== 'string' || !data.type.trim()) return;
    if (!consumed.has(key)) {
      try { onData(data); } catch { return; }
      consumed.add(key);
      if (consumed.size > MAX_CONSUMED_RESPONSES) consumed.delete(consumed.values().next().value!);
    }
    // Installed Expo SDK exposes synchronous reads/clears. Check the current
    // native response before clearing, so an older callback leaves a newer tap.
    try {
      if (responseKey(Notifications.getLastNotificationResponse()) === key) Notifications.clearLastNotificationResponse();
    } catch { /* The session identity still prevents duplicate handling. */ }
  };
  try { subscription = Notifications.addNotificationResponseReceivedListener(receive); }
  catch { /* A buffered cold response can still be handled below. */ }
  try { receive(Notifications.getLastNotificationResponse()); }
  catch { /* A subsequent live tap can still be handled by the listener. */ }
  return () => {
    active = false;
    try { subscription?.remove(); } catch { /* Already detached native bridge. */ }
  };
}
