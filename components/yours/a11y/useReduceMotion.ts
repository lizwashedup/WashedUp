import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Reduce Motion detection. No app-wide handling existed before the Yours
 * rebuild; this is intentionally scoped to components/yours/* only. When
 * true, animated primitives jump straight to their final state.
 */
export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        if (mounted) setReduce(v);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (v) => setReduce(v),
    );
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  return reduce;
}
