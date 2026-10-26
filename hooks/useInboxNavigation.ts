import { useCallback } from 'react';
import { useRouter } from 'expo-router';

export type InboxNavigate = (route: string) => void;

/** A containing native inbox owns dismissal. Standalone rows can navigate directly. */
export function useInboxNavigation(onClose: () => void, navigateAfterDismiss?: InboxNavigate) {
  const router = useRouter();
  return useCallback((route: string) => {
    if (navigateAfterDismiss) { navigateAfterDismiss(route); return; }
    onClose();
    router.push(route as never);
  }, [onClose, navigateAfterDismiss, router]);
}
