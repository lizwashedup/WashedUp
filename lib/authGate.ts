// Auth-gate helpers. Both fail CLOSED on any uncertainty so a transient error,
// a timeout, or a stale session can never sign out or wrongly gate a valid user
// (auth-audit.md, 2026-06-11).
import type { User } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { withTimeout } from './withTimeout';
import { PHONE_AUTH_ENABLED } from '../constants/FeatureFlags';

/**
 * The DEFINITE answer to "send this user to the phone-migration gate?" from the
 * server (`needs_phone_migration()` RPC). FAILS CLOSED: returns `true` ONLY on a
 * hard server `true`; any error, timeout, missing RPC, or non-boolean resolves to
 * `false` (not gated). Bounded so it never blocks launch on the phone read (the
 * 752c83a regression). While the RPC is unapplied this always returns false, so
 * the gate is dormant rather than wrongly firing.
 */
export async function fetchNeedsPhoneMigration(): Promise<boolean> {
  if (!PHONE_AUTH_ENABLED) return false;
  const res = await withTimeout<{ data: unknown; error: unknown } | null>(
    supabase.rpc('needs_phone_migration') as unknown as PromiseLike<{ data: unknown; error: unknown }>,
    3000,
    { data: false, error: null },
  );
  return res?.data === true;
}

/**
 * getUser bounded so a hang/timeout/network error is reported as "couldn't
 * resolve" (resolved=false) rather than a null user. Callers must treat
 * `resolved=false` as TRANSIENT (do NOT sign out / re-gate); only a resolved
 * null user (resolved=true, user=null) is a genuinely-missing session.
 */
const UNRESOLVED = Symbol('getUser-unresolved');
export async function getUserBounded(
  ms = 4000,
): Promise<{ user: User | null; resolved: boolean }> {
  const res = await withTimeout<unknown>(
    supabase.auth.getUser().then(
      (r) => r,
      () => UNRESOLVED,
    ),
    ms,
    UNRESOLVED,
  );
  if (res === UNRESOLVED) return { user: null, resolved: false };
  const user = (res as { data?: { user: User | null } })?.data?.user ?? null;
  return { user, resolved: true };
}
