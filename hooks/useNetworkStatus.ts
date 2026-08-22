import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { SUPABASE_URL } from '../lib/supabase';

const PROBE_TIMEOUT_MS = 5000;
const POLL_INTERVAL_MS = 20000;

// ponytail: reachability is inferred from a lightweight HEAD request against
// the project's own Supabase host, not a push-based OS signal (no netinfo or
// equivalent dependency is installed anywhere in this app -- LF-01 finding).
// ceiling: can lag up to POLL_INTERVAL_MS behind a real connectivity change,
// and a captive portal (wifi with no real internet) reads as online as long
// as it still answers this one host. upgrade: install
// @react-native-community/netinfo for a real push-based listener; the
// {online} return shape here would not need to change, only this probe.
async function probeOnline(): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    // any HTTP response at all (even a 4xx/5xx) proves the request round
    // tripped; only a thrown/aborted fetch means genuinely offline.
    await fetch(SUPABASE_URL, { method: 'HEAD', signal: ctrl.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Best-effort connectivity signal for native (LF-01: the app has zero
 * connectivity-detection capability anywhere). Polls on an interval and on
 * every foreground transition. Starts optimistic (true) so a normal fast
 * connection never flashes an offline banner before the first probe lands.
 */
export function useNetworkStatus(): { online: boolean } {
  const [online, setOnline] = useState(true);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const run = () => {
      probeOnline().then((ok) => {
        if (mounted.current) setOnline(ok);
      });
    };
    run();
    const interval = setInterval(run, POLL_INTERVAL_MS);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') run();
    });
    return () => {
      mounted.current = false;
      clearInterval(interval);
      sub.remove();
    };
  }, []);

  return { online };
}
