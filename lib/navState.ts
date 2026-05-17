/**
 * Cross-screen navigation state shared between `app/_layout.tsx`'s auth
 * listener and screens that route themselves on auth events.
 *
 * verify-code uses a 600ms success-hold animation before routing. The
 * auth listener fires SIGNED_IN as soon as supabase.auth.verifyOtp
 * succeeds, which would yank the user away mid-animation. We previously
 * gated this with `pathnameRef.current === '/verify-code'`, which is
 * timing-sensitive and breaks on deep-links. The ref below is a
 * pathname-agnostic flag verify-code flips while it's about to navigate.
 */
export const verifyCodeSelfRoutingRef = { current: false };

/**
 * Timestamp of the most recent app-initiated redirect to the unauthed
 * route (e.g., delete-account flow's `router.replace(unauthedRoute())`
 * BEFORE its `signOut()`). The auth listener uses this as a synchronous
 * dedup signal — `pathnameRef` lags the actual navigation by one render,
 * so without this the listener can fire a second `router.replace` to the
 * same destination and the user sees a brief bounce.
 *
 * Callers set `Date.now()` immediately before their `router.replace`.
 * Listener treats any value within ~1.5s as "external redirect already
 * happened, skip my own."
 */
export const lastUnauthRedirectAt = { ts: 0 };

/**
 * One-shot flag flipped by any auth-success path (login.tsx after a
 * successful sign-in via email/Apple/Google, verify-code.tsx after OTP
 * success). The plans tab consumes it on mount to show the WelcomeLoading
 * transition over the skeleton, then clears it. Without this, existing
 * users (who've already dismissed the welcome banner) see a hard
 * skeleton-blink immediately after login.
 *
 * Set: `postAuthTransitionRef.active = true`
 * Consume: read once on mount; clear with `.active = false`.
 */
export const postAuthTransitionRef = { active: false };

/**
 * User id the root auth listener has already routed into the app this
 * runtime. supabase-js (RN, autoRefreshToken + AsyncStorage) re-emits
 * SIGNED_IN on app foreground / session recovery, not only on deliberate
 * logins. Without this, every re-emit re-runs authedDest() and can bounce
 * an actively-using user back to /migration-gate or yank them to
 * /(tabs)/plans mid-session. Set when checkAuth() or a genuine fresh
 * SIGNED_IN routes a user in; cleared on SIGNED_OUT. State
 * (setAuthedUserId) is async and can't be read synchronously inside the
 * listener, hence a ref.
 */
export const authedUserIdRef: { current: string | null } = { current: null };

/**
 * Session-scoped OTP throttle, shared between `phone-entry.tsx` (initial
 * send) and `verify-code.tsx` (resend). Without a shared store, a user
 * could send via phone-entry, resend via verify-code (which wouldn't
 * update phone-entry's local throttle), then back-nav to phone-entry and
 * trigger a third SMS once the local 60s window expired. The shared store
 * here is the source of truth for "was an OTP sent to this phone recently."
 *
 * - `markOtpSent(phone)` — call after a successful signInWithOtp /
 *   updateUser({phone}) request. E.164 format expected.
 * - `wasOtpRecentlySent(phone)` — returns true if an OTP was sent to this
 *   exact phone within the reuse window. Callers should skip their API
 *   call and treat the prior OTP as still valid.
 *
 * Module-level state — persists across screen re-mounts, resets on cold
 * start (JS runtime reload). No AsyncStorage; the throttle is intentionally
 * session-scoped and would be wrong to persist past app kill.
 */
const OTP_REUSE_WINDOW_MS = 60_000;
let lastOtpSent: { phone: string; at: number } | null = null;

export function wasOtpRecentlySent(phone: string): boolean {
  return (
    lastOtpSent !== null
    && lastOtpSent.phone === phone
    && Date.now() - lastOtpSent.at < OTP_REUSE_WINDOW_MS
  );
}

export function markOtpSent(phone: string): void {
  lastOtpSent = { phone, at: Date.now() };
}
