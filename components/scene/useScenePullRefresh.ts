import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';

/** Only an explicit pull drives native refresh presentation; query refreshes stay independent. */
export function useScenePullRefresh(refetch: () => unknown, identity: string, active: boolean) {
  const focused = useIsFocused();
  const visit = useMemo(() => ({}), [identity, active, focused]);
  const committed = useRef<object | null>(null);
  const pending = useRef<object | null>(null);
  const [pull, setPull] = useState<object | null>(null);
  useLayoutEffect(() => {
    committed.current = visit;
    pending.current = null;
    return () => { committed.current = null; pending.current = null; };
  }, [visit]);
  const onRefresh = useCallback(async () => {
    if (!active || !focused || committed.current !== visit || pending.current) return;
    const attempt = {};
    pending.current = attempt;
    setPull(visit);
    try { await refetch(); }
    catch { /* The query retains its existing error and explicit Retry UI. */ }
    finally {
      if (committed.current === visit && pending.current === attempt) {
        pending.current = null;
        setPull(null);
      }
    }
  }, [active, focused, visit, refetch]);
  return { refreshing: active && focused && pull === visit, onRefresh };
}
