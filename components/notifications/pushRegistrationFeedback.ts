import type { PushRegistrationResult } from '../../hooks/usePushNotifications';

export type PushRegistrationFeedback = {
  kind: 'success' | 'settings' | 'retry' | 'silent';
  title: string;
  message: string;
};

/** Copy shared by real enable actions. OS permission alone is not registration. */
export function pushRegistrationFeedback(result: PushRegistrationResult): PushRegistrationFeedback {
  switch (result.status) {
    case 'registered':
      return {
        kind: 'success',
        title: 'Notifications enabled',
        message: 'Alerts are turned on for messages and plan updates.',
      };
    case 'permission-denied':
      return {
        kind: 'settings',
        title: 'Turn on in Settings',
        message: 'Notifications are off in your device settings. Enable them for WashedUp, then come back.',
      };
    case 'obsolete':
      return { kind: 'silent', title: '', message: '' };
    case 'pending':
    case 'opted-out':
      return {
        kind: 'retry',
        title: 'Alerts aren’t ready',
        message: 'Alerts aren’t ready yet. Try again shortly.',
      };
    default:
      return {
        kind: 'retry',
        title: 'Couldn’t turn on alerts',
        message: 'We couldn’t finish turning on alerts. Try again.',
      };
  }
}
