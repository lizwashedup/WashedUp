import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking } from 'react-native';
import { useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { registerPushNotificationsWithResult, getPushPermissionStatus } from './usePushNotifications';
import { pushRegistrationFeedback } from '../components/notifications/pushRegistrationFeedback';

interface ChatPushBannerOptions {
  entry: object;
  currentUserId: string | null;
  isCurrentEntry: () => boolean;
  messages: readonly { user_id: string }[];
}

/** Own the optional notification prompt separately from messaging and its composer. */
export function useChatPushBanner({ entry, currentUserId, isCurrentEntry, messages }: ChatPushBannerOptions) {
  const [showPushBanner, setShowPushBanner] = useState(false);
  const [enablingPush, setEnablingPush] = useState(false);
  const [pushFeedback, setPushFeedback] = useState<string | null>(null);
  const [pushVisit, setPushVisit] = useState<object>({});
  const activePushVisit = useRef<object | null>(null);
  const pushAttempt = useRef<object | null>(null);
  const pushCheckRevision = useRef(0);
  const pushSettingsReturn = useRef<{ visit: object; returned: boolean } | null>(null);
  const PUSH_BANNER_KEY = 'push_banner_dismissed_at';
  const PUSH_BANNER_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
  const isCurrentPush = useCallback(() => isCurrentEntry() && activePushVisit.current === pushVisit,
    [isCurrentEntry, pushVisit]);

  useFocusEffect(useCallback(() => {
    const visit = {};
    activePushVisit.current = visit;
    setPushVisit(visit);
    pushAttempt.current = null;
    pushSettingsReturn.current = null;
    pushCheckRevision.current++;
    setShowPushBanner(false);
    setPushFeedback(null);
    setEnablingPush(false);
    return () => {
      if (activePushVisit.current !== visit) return;
      activePushVisit.current = null;
      pushAttempt.current = null;
      pushSettingsReturn.current = null;
      pushCheckRevision.current++;
    };
  }, [entry]));

  useEffect(() => {
    if (!isCurrentPush() || !currentUserId || messages.length === 0) return;
    if (!messages.some(message => message.user_id !== currentUserId)) return;
    let cancelled = false;
    const revision = pushCheckRevision.current;
    const current = () => !cancelled && isCurrentPush() && revision === pushCheckRevision.current;
    void (async () => {
      try {
        const permission = await getPushPermissionStatus();
        if (!current() || permission === 'granted') return;
        const dismissed = await AsyncStorage.getItem(PUSH_BANNER_KEY);
        if (!current()) return;
        if (dismissed && Date.now() - parseInt(dismissed, 10) < PUSH_BANNER_COOLDOWN_MS) return;
        setShowPushBanner(true);
      } catch { /* A passive check never opens an error or requests permission. */ }
    })();
    return () => { cancelled = true; };
  }, [currentUserId, messages.length, isCurrentPush]);

  const handleEnablePush = useCallback(async (fromSettings = false): Promise<void> => {
    if (!isCurrentPush() || pushAttempt.current) return;
    if (fromSettings && (pushSettingsReturn.current?.visit !== pushVisit || !pushSettingsReturn.current.returned)) return;
    pushSettingsReturn.current = null;
    const attempt = {};
    pushAttempt.current = attempt;
    pushCheckRevision.current++;
    setEnablingPush(true);
    setPushFeedback(null);
    const current = () => isCurrentPush() && pushAttempt.current === attempt;
    // showResult and the native foreground listener can assign this ref
    // after the initial clear; read its declared type at completion time.
    const getSettingsReturn = (): { visit: object; returned: boolean } | null => pushSettingsReturn.current;
    const showResult = (result: Parameters<typeof pushRegistrationFeedback>[0], previouslyDenied = false) => {
      if (!current()) return;
      const feedback = pushRegistrationFeedback(result);
      if (feedback.kind === 'silent') return;
      if (feedback.kind === 'success') {
        setShowPushBanner(false);
      } else if (feedback.kind === 'settings') {
        // Keep the established snooze after a declined native prompt. Open
        // Settings only when denial was known before this enable attempt.
        void AsyncStorage.setItem(PUSH_BANNER_KEY, String(Date.now())).catch(() => {});
        setShowPushBanner(false);
        if (fromSettings || !previouslyDenied) return;
        const settingsReturn = { visit: pushVisit, returned: false };
        pushSettingsReturn.current = settingsReturn;
        void Linking.openSettings().catch(() => {
          if (!isCurrentPush() || pushSettingsReturn.current !== settingsReturn) return;
          pushSettingsReturn.current = null;
          setShowPushBanner(true);
          setPushFeedback('Couldn’t open Settings. Open your device settings and choose WashedUp.');
        });
      } else {
        setShowPushBanner(true);
        setPushFeedback(feedback.message);
      }
    };
    try {
      // An explicit Enable action first asks for a truthful, non-prompting
      // registration result; the coarse Android native enum is insufficient.
      let result = await registerPushNotificationsWithResult({ prompt: false, userId: currentUserId });
      if (!current()) return;
      const previouslyDenied = result.status === 'permission-denied';
      if (result.status === 'permission-required' && !fromSettings) {
        result = await registerPushNotificationsWithResult({ prompt: true, userId: currentUserId, canPrompt: current });
      }
      showResult(result, previouslyDenied);
    } catch {
      showResult({ status: 'failed' });
    } finally {
      if (pushAttempt.current === attempt) {
        pushAttempt.current = null;
        if (isCurrentPush()) {
          setEnablingPush(false);
          // An early foreground event may arrive before this attempt releases
          // its lock. Retain and consume that one return after the lock clears.
          const settingsReturn = getSettingsReturn();
          if (settingsReturn?.visit === pushVisit && settingsReturn.returned) {
            void handleEnablePush(true);
          }
        }
      }
    }
  }, [currentUserId, isCurrentPush, pushVisit]);

  const handleDismissPushBanner = useCallback(() => {
    if (!isCurrentPush()) return;
    pushAttempt.current = null;
    pushCheckRevision.current++;
    pushSettingsReturn.current = null;
    setEnablingPush(false);
    setShowPushBanner(false);
    setPushFeedback(null);
    void AsyncStorage.setItem(PUSH_BANNER_KEY, String(Date.now())).catch(() => {});
  }, [isCurrentPush]);

  // Recheck only after this visit's explicit Settings action. Foregrounding
  // elsewhere must not start another registration or display a new prompt.
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state !== 'active' || !isCurrentPush() || pushSettingsReturn.current?.visit !== pushVisit) return;
      pushSettingsReturn.current.returned = true;
      void handleEnablePush(true);
    });
    return () => sub.remove();
  }, [handleEnablePush, isCurrentPush, pushVisit]);

  return { showPushBanner, enablingPush, pushFeedback, handleEnablePush, handleDismissPushBanner };
}
