import { useCallback, useEffect, useRef, useState } from 'react';
import type { CreatorPageScope } from '../lib/creatorPageReview';


/** Retain a current visit's data on refresh failure; never reuse it for another account/page. */
export function useCreatorPageRead<T, S extends { isCurrent(): boolean } = CreatorPageScope>(scope: S | null, read: (scope: S) => Promise<T>) {
  const sequence = useRef(0);
  const [state, setState] = useState<{ scope: S; data?: T; error?: string; loading: boolean }>();
  const refresh = useCallback(async () => {
    if (!scope?.isCurrent()) return undefined;
    const attempt = ++sequence.current;
    setState(old => ({ scope, data: old?.scope === scope ? old.data : undefined, loading: true }));
    try {
      const data = await read(scope);
      if (scope.isCurrent() && sequence.current === attempt) setState({ scope, data, loading: false });
      return scope.isCurrent() && sequence.current === attempt ? data : undefined;
    } catch (failure) {
      if (scope.isCurrent() && sequence.current === attempt) setState(old => ({ scope,
        data: old?.scope === scope ? old.data : undefined, loading: false,
        error: failure instanceof Error ? failure.message : 'Could not load this page. Please try again.',
      }));
      throw failure;
    }
  }, [scope, read]);
  useEffect(() => { void refresh().catch(() => undefined); }, [refresh]);
  return { ...(state?.scope === scope ? state : { data: undefined, error: undefined, loading: !!scope }), refresh };
}
