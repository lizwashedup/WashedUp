import { useEffect, type RefObject } from 'react';
import { AppState } from 'react-native';

/** A socket can remain apparently connected while the OS suspends JS. Refresh
 * the visible room on return even when no reconnect event is delivered. */
export function useChatResumeRefresh(
  refresh: (silent: boolean) => Promise<unknown>,
  isCurrent: () => boolean,
  focused: RefObject<boolean>,
) {
  useEffect(() => {
    let active = true;
    let previous = AppState.currentState;
    const subscription = AppState.addEventListener('change', state => {
      const returned = state === 'active' && previous !== 'active';
      previous = state;
      if (!active || !returned || !focused.current || !isCurrent()) return;
      // The owning data hook handles errors and coalesces concurrent refreshes.
      // Keep existing history visible and never send messages from this path.
      void Promise.resolve().then(() => {
        if (active && focused.current && AppState.currentState === 'active' && isCurrent()) return refresh(true);
      }).catch(() => undefined);
    });
    return () => { active = false; subscription.remove(); };
  }, [refresh, isCurrent, focused]);
}
