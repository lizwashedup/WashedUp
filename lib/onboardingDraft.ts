/**
 * Local-only draft cache for in-progress onboarding screens.
 *
 * Screen-level resume (which screen a user lands back on) is handled
 * server-side by `onboarding_status` — see lib/authRouting.ts. This is the
 * layer underneath that: what the user had actually typed on that screen
 * before a submit ever reached the server. Onboarding fields save to
 * `profiles` only on that screen's own "continue" tap, so a kill mid-fill-out
 * loses everything typed even though the next launch lands back on the same
 * screen.
 *
 * Keyed by the current session's user id, not just the screen name. Onboarding
 * sits right next to two real same-device account-switch paths (sign-out then
 * a different sign-in, and the Apple-shell -> different-canonical-account swap
 * in migration-gate.tsx) — an unkeyed draft would resurrect person A's typed
 * name/email/birthday for person B on the same device. With no real user id
 * known, every operation is a no-op: there is deliberately no shared "anon"
 * bucket, because that bucket is itself a second account on the same device
 * and would leak into it exactly the way an unkeyed draft would.
 *
 * The user id comes from a single onAuthStateChange subscription, cached
 * synchronously, not a per-call getSession() (which can itself do a real
 * network round trip on the installed supabase-js when a cached token is
 * near expiry — exactly the flaky moment this feature has to survive). That
 * first callback (INITIAL_SESSION) is not synchronous at subscribe time
 * either, though: supabase-js awaits its own init/lock/refresh first, which
 * this codebase's own numbers put north of a few seconds on a bad network.
 *
 * This module went through two real, proven bugs getting that waiting logic
 * right, both worth naming so a future change doesn't reintroduce them:
 *
 * 1. A caller that gives up waiting (bounded, see authReady below) must never
 *    be treated the same as a caller that got a real, confirmed answer.
 *    Racing every call against its OWN fresh timeout let a read give up
 *    early (rendering blank fields) while a LATER write's own fresh timeout
 *    happened to straddle the real resolution and fired anyway — writing
 *    those blank fields over a real draft. `hydrationConfirmed` below exists
 *    only to prevent that: a screen may not save until that SAME screen's
 *    own loadDraft() call has genuinely resolved auth once, not merely
 *    returned.
 * 2. signOut() is not synchronous either (a real network call precedes the
 *    local session clear), so a user who keeps typing in that window can
 *    re-arm a save that lands under the departing user's still-cached id.
 *    `signingOut` closes that: set the moment clearAllDrafts() runs (always
 *    called before signOut() itself), cleared either by a real confirming
 *    auth event OR, since that event is not guaranteed at all (an offline
 *    signOut() can fail without ever emitting one), by its own bounded
 *    fallback — otherwise a single failed sign-out permanently disables this
 *    entire feature for the rest of the app session.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { withTimeout } from './withTimeout';

const DEBOUNCE_MS = 500;
// Matches this codebase's own existing convention for "give up and proceed
// anyway" on an auth-dependent wait (see the bootstrap watchdog in
// app/(auth)/onboarding/basics.tsx). Not sized to the theoretical worst case
// for a stale-token refresh (real, but tens of seconds, and rare for a screen
// reached moments after a fresh sign-in) -- sized so the failure mode of
// exceeding it is "this session doesn't get draft-persistence," which is
// safe, not "guess wrong and overwrite something real."
const AUTH_READY_TIMEOUT_MS = 8000;

// The fixed, small set of onboarding screens this module manages -- used only
// by clearAllDrafts() below to wipe every one of a departing user's drafts in
// one pass, not something callers need to enumerate themselves.
const KNOWN_SCREENS = ['basics', 'laCheck', 'referral'] as const;

// Keyed by screen name, not the resolved storage key -- there is only ever one
// signed-in user typing on a given onboarding screen at a time, so this stays
// simple without losing the ability to cancel a screen's pending write.
const timers: Partial<Record<string, ReturnType<typeof setTimeout>>> = {};

// True only once THIS screen's own loadDraft() has genuinely resolved auth
// (not timed out) at least once. A one-way ratchet, deliberately never reset
// to false once true: cachedUserId keeps getting updated correctly by the
// live subscription below for the rest of the app's life, so an earlier
// confirmation stays valid; what it must never do is get set on a give-up.
const hydrationConfirmed: Partial<Record<string, boolean>> = {};

let cachedUserId: string | null = null;
let signingOut = false;
let signingOutFallback: ReturnType<typeof setTimeout> | undefined;
let resolveReady: () => void;
let ready: Promise<void> = new Promise((resolve) => { resolveReady = resolve; });

supabase.auth.onAuthStateChange((_event, session) => {
  const uid = session?.user?.id ?? null;
  cachedUserId = uid;
  if (uid === null) {
    signingOut = false; // a sign-out (or no session ever) is now genuinely confirmed
    if (signingOutFallback) { clearTimeout(signingOutFallback); signingOutFallback = undefined; }
  }
  resolveReady();
});

/** Resolves true once auth has reported its state at least once, false if a bounded wait gave up first. */
async function authReady(): Promise<boolean> {
  const GAVE_UP = Symbol('gave-up');
  const outcome = await withTimeout<typeof GAVE_UP | void>(ready, AUTH_READY_TIMEOUT_MS, GAVE_UP);
  return outcome !== GAVE_UP;
}

function keyFor(screen: string, userId: string): string {
  return `wu.onboardingDraft.${userId}.${screen}.v1`;
}

/**
 * Debounced write. Fire-and-forget, best-effort, like the rest of this
 * codebase's local caches. Refuses to write at all unless THIS screen's own
 * loadDraft() has already genuinely confirmed auth once -- see the module
 * doc comment above for why a fresh per-call wait here is not enough on its
 * own. Re-reads cachedUserId at the moment the debounce actually fires, not
 * when saveDraft was called, so a change during the debounce window is
 * picked up rather than acted on stale.
 */
export function saveDraft<T>(screen: string, value: T): void {
  if (signingOut) return; // a sign-out is in flight; refuse new work until it's confirmed, not just requested
  if (!hydrationConfirmed[screen]) return; // this screen never confirmed who's typing; don't guess
  const existing = timers[screen];
  if (existing) clearTimeout(existing);
  timers[screen] = setTimeout(() => {
    delete timers[screen];
    (async () => {
      if (signingOut) return; // re-check: the sign-out may have landed during the debounce window itself
      const uid = cachedUserId;
      if (!uid) return; // no known signed-in user -- refuse to write anywhere
      try {
        await AsyncStorage.setItem(keyFor(screen, uid), JSON.stringify(value));
      } catch { /* best-effort */ }
    })();
  }, DEBOUNCE_MS);
}

/** Cancel a screen's pending debounced write without touching what's already on disk. Call on unmount. */
export function cancelPendingSave(screen: string): void {
  const pending = timers[screen];
  if (pending) { clearTimeout(pending); delete timers[screen]; }
}

/**
 * Also the one place that decides whether saveDraft() may ever run for this
 * screen (see hydrationConfirmed above) -- a screen that never calls this,
 * or whose call here times out, permanently gets no draft-saving for that
 * mount rather than a guess.
 */
export async function loadDraft<T>(screen: string): Promise<T | null> {
  const gotReal = await authReady();
  if (!gotReal) return null; // could not confirm identity in time; do not mark this screen ready to save either
  const uid = cachedUserId;
  if (!uid) {
    hydrationConfirmed[screen] = true; // confirmed: genuinely no signed-in user right now
    return null;
  }
  try {
    const raw = await AsyncStorage.getItem(keyFor(screen, uid));
    // Only now, not before the read: a caller that couldn't actually confirm
    // the disk state (see the catch below) must not be treated as one that
    // did, for the same reason a caller that gave up waiting for auth isn't.
    hydrationConfirmed[screen] = true;
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Call the instant a screen's real submit succeeds. Cancels any pending debounced write too. */
export async function clearDraft(screen: string): Promise<void> {
  cancelPendingSave(screen);
  const uid = cachedUserId;
  if (!uid) return;
  try { await AsyncStorage.removeItem(keyFor(screen, uid)); } catch { /* best-effort */ }
}

/**
 * Wipe every onboarding draft for whoever is signed in right now, and refuse
 * any further save until a sign-out (or the next sign-in) is confirmed by a
 * real auth event -- or, failing that, until a bounded fallback clears the
 * guard on its own, since signOut() can fail (e.g. offline) without ever
 * emitting a confirming event, and this must not disable the feature
 * permanently over one failed attempt. Call this BEFORE
 * supabase.auth.signOut(), not after -- it needs cachedUserId to still be
 * the departing user's id, and signOut() itself is not synchronous (a real
 * network call precedes the local clear), so the caller's screen can
 * otherwise stay mounted and typeable throughout that whole round trip.
 */
export async function clearAllDrafts(): Promise<void> {
  signingOut = true;
  if (signingOutFallback) clearTimeout(signingOutFallback);
  signingOutFallback = setTimeout(() => { signingOut = false; signingOutFallback = undefined; }, AUTH_READY_TIMEOUT_MS);
  KNOWN_SCREENS.forEach(cancelPendingSave);
  const uid = cachedUserId;
  if (!uid) return;
  try {
    await AsyncStorage.multiRemove(KNOWN_SCREENS.map((screen) => keyFor(screen, uid)));
  } catch { /* best-effort */ }
}

/**
 * Test-only: resets every piece of in-memory state (cachedUserId, the
 * hydration ratchet, the sign-out guard, pending timers, and the auth-ready
 * signal itself) back to a fresh-module baseline. Never call this from
 * application code -- it exists because jest.resetModules() between tests
 * in the same file re-requires React itself along with everything else,
 * producing "Invalid hook call" from a duplicate React copy; this resets
 * just this module's own state instead, which is genuinely a fresh boot as
 * far as this module's own behavior is concerned.
 */
export function __resetForTests__(): void {
  cachedUserId = null;
  signingOut = false;
  if (signingOutFallback) { clearTimeout(signingOutFallback); signingOutFallback = undefined; }
  Object.keys(hydrationConfirmed).forEach((k) => { delete hydrationConfirmed[k]; });
  Object.keys(timers).forEach((k) => {
    const pending = timers[k];
    if (pending) clearTimeout(pending);
    delete timers[k];
  });
  ready = new Promise((resolve) => { resolveReady = resolve; });
}
