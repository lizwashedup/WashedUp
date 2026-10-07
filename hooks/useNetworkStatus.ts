import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { SUPABASE_URL } from '../lib/supabase';

const PROBE_TIMEOUT_MS = 5000;
const POLL_INTERVAL_MS = 20000;

/** Best-effort reachability of this project's endpoint, not backend health.
 * A HEAD probe avoids adding a native connectivity dependency. It can lag a
 * network loss by the polling interval plus timeout and cannot rule out a captive
 * portal. Start optimistic so a normal connection does not flash a warning. */
export function useNetworkStatus(): { online: boolean } {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    let disposed = false;
    let foreground = AppState.currentState !== 'background' && AppState.currentState !== 'inactive';
    type Probe = { controller: AbortController; timer?: ReturnType<typeof setTimeout> };
    let current: Probe | null = null;
    const cancel = () => {
      const previous = current;
      current = null; // Abort rejection belongs to the retired request.
      if (previous?.timer !== undefined) clearTimeout(previous.timer);
      previous?.controller.abort();
    };
    const run = () => {
      if (disposed || !foreground) return;
      cancel();
      const probe: Probe = { controller: new AbortController() };
      current = probe;
      const finish = (ok: boolean) => {
        if (disposed || !foreground || current !== probe) return;
        current = null;
        if (probe.timer !== undefined) clearTimeout(probe.timer);
        setOnline(ok);
      };
      probe.timer = setTimeout(() => {
        // Bound the result even if a native fetch ignores cancellation.
        finish(false);
        probe.controller.abort();
      }, PROBE_TIMEOUT_MS);
      try {
        // Any response, including 4xx/5xx, proves reachability only.
        void Promise.resolve(fetch(SUPABASE_URL, { method: 'HEAD', signal: probe.controller.signal }))
          .then(() => finish(true), () => finish(false));
      } catch { finish(false); }
    };
    run();
    const interval = setInterval(run, POLL_INTERVAL_MS);
    const subscription = AppState.addEventListener('change', state => {
      const returning = state === 'active' && !foreground;
      foreground = state === 'active';
      if (!foreground) cancel();
      else if (returning) run();
    });
    return () => {
      disposed = true;
      cancel();
      clearInterval(interval);
      subscription.remove();
    };
  }, []);

  return { online };
}
