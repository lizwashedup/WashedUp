import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, processLock } from '@supabase/supabase-js';
import { AppState } from 'react-native';

// Prefer env vars (EAS Secrets / .env). Fallback for builds without secrets configured.
const DEFAULT_URL = 'https://upstjumasqblszevlgik.supabase.co';
const DEFAULT_ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVwc3RqdW1hc3FibHN6ZXZsZ2lrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyMjg4NzYsImV4cCI6MjA4NzgwNDg3Nn0.84inESQAGh_gCfASpy1Xe39NpkWTjilh-jAuV_UM84U';

export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? DEFAULT_URL;
const supabaseUrl = SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? DEFAULT_ANON;

// supabase-js has no per-request timeout. On a stale/expired session the token
// refresh can hit a half-open socket and hang forever — and because GoTrue
// serializes auth work behind a lock, that one hung request poisons every later
// auth/db call (the cold-start freeze: feed + chats hang behind a refresh that
// never settles). The withTimeout() guards in the gate make the *waiter* give
// up but never abort the request or release the lock, so the poison persists
// for the whole session. Fix it at the source: a fetch that actually aborts.
//
// Storage uploads/downloads (photos, albums, voice notes) can legitimately run
// long on weak networks, so they are explicitly exempt — only auth/REST/edge
// requests get the hard ceiling that releases the lock.
//
// Kept deliberately BELOW GoTrue's 10s processLock acquire timeout: an in-flight
// auth request must abort (and release the lock) before any queued waiter hits
// its own 10s lock-acquire ceiling. At 12000 a waiter could time out ~2s before
// the holder released, still surfacing ProcessLockAcquireTimeoutError; 8000
// guarantees the holder lets go first.
const REQUEST_TIMEOUT_MS = 8000;

// The token endpoint gets its own, longer ceiling, and this one is about
// losing accounts rather than losing time.
//
// A refresh ROTATES: the server consumes the presented token and issues a
// new one. If we abort at 8s AFTER the server rotated but BEFORE the client
// persisted the reply, the device is left holding a token the server has
// already spent. That abort is harmless by itself (auth-js wraps it as
// AuthRetryableFetchError and keeps the session), but the next tick presents
// the spent token, the server answers with a definitive invalid_grant, and
// THAT is not retryable: auth-js calls _removeSession() and the user is
// signed out with no warning. On prod that lands them on the cold
// acquisition screen, where known users re-register.
//
// So: give a rotation the best chance to land. Still strictly below GoTrue's
// 10s processLock acquire timeout, which is the invariant the 8s above
// exists to protect (the holder must let go before a waiter times out).
const AUTH_TOKEN_TIMEOUT_MS = 9000;

const timeoutFetch: typeof fetch = (input, init) => {
  // Avoid referencing the global `Request` (instanceof would throw on every
  // fetch if it were ever undefined). A Request-like object exposes `.url`;
  // a string or URL stringifies to the href.
  const url =
    typeof input === 'string'
      ? input
      : input && typeof input === 'object' && 'url' in input
        ? String((input as { url: unknown }).url)
        : String(input);

  // Never abort storage transfers — large media over a slow connection is a
  // legitimate long request, not a hang.
  if (url.includes('/storage/v1/')) {
    return fetch(input as any, init);
  }

  const controller = new AbortController();
  const ceiling = url.includes('/auth/v1/token') ? AUTH_TOKEN_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), ceiling);

  // Respect a caller-supplied AbortSignal too, so an upstream cancel still
  // propagates (and we don't leak our timer).
  const callerSignal = init?.signal;
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  return fetch(input as any, { ...init, signal: controller.signal }).finally(() =>
    clearTimeout(timer),
  );
};

// GoTrue's lock-acquire ceiling (ProcessLockAcquireTimeoutError, "Acquiring
// process lock ... timed out") is hardcoded to 10s inside @supabase/auth-js
// and is NOT reachable through createClient(): supabase-js's
// _initSupabaseAuthClient only forwards autoRefreshToken, persistSession,
// detectSessionInUrl, storage, userStorage, storageKey, flowType, lock,
// debug, and throwOnError out of this auth config before constructing
// GoTrueClient -- a lockAcquireTimeout passed here would be silently dropped
// before it ever reached the client (verified against this repo's installed
// @supabase/supabase-js 2.97.0 source).
//
// That fixed 10s is a per-CALLER budget, not a per-queue budget. processLock()
// chains every call for the same lock name onto one module-level promise,
// first-come-first-served -- and GoTrueClient's own _acquireLock() has a
// check-then-act race on its lockAcquired flag (checked synchronously, only
// set true inside the async callback handed to lock()), so two or more
// auth-touching calls that fire in the same tick -- a realistic cold-start
// pattern, e.g. getSession() plus a couple of REST calls each needing a
// fresh token, and the root layout alone mounts well over a dozen effects --
// can each independently call processLock() instead of queuing behind one
// caller's gate. When that happens, a later caller's own 10s countdown
// starts at ITS arrival, not at the front of the line, so it can still time
// out while every individual holder ahead of it releases within the
// AUTH_TOKEN_TIMEOUT_MS ceiling above, exactly as designed. Confirmed via
// Sentry still recurring after the abort-timeout fix below shipped (e.g.
// build 35, 2026-09-02) alongside concurrent XHRs in the same event's
// breadcrumbs -- consistent with a stacked queue, not a single hung request.
//
// Fix: override the acquireTimeout GoTrue passes in, without touching how a
// lock is acquired or released. 25s comfortably survives two stacked holders
// at the worst-case AUTH_TOKEN_TIMEOUT_MS each plus slack, while still
// failing well short of anything a user would sit through unexplained (the
// 10s auth watchdog in app/_layout.tsx already stops blocking the UI on this
// regardless -- see its own comment -- so a longer background ceiling here
// only reduces spurious lock timeouts, it doesn't add new visible wait).
const LOCK_ACQUIRE_TIMEOUT_MS = 25000;
const queueTolerantLock: typeof processLock = (name, _acquireTimeout, fn) =>
  processLock(name, LOCK_ACQUIRE_TIMEOUT_MS, fn);

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    // RN-safe in-process lock. Serializes auth operations so a refresh and a
    // getSession() can't interleave; paired with the abort-timeout fetch above,
    // a failed refresh now releases the lock instead of holding it forever.
    // Wrapped to raise GoTrue's unconfigurable 10s acquire ceiling -- see
    // queueTolerantLock above.
    lock: queueTolerantLock,
  },
  global: {
    fetch: timeoutFetch,
  },
});

// Drive token auto-refresh off app foreground/background. A bare refresh timer
// (autoRefreshToken alone) gets throttled/suspended while RN is backgrounded,
// so a returning user can foreground onto an already-expired token — exactly
// the stale-session path that froze launch. Pausing on background and resuming
// (with an immediate refresh) on foreground keeps the token fresh on return.
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    supabase.auth.startAutoRefresh();
  } else {
    supabase.auth.stopAutoRefresh();
  }
});
