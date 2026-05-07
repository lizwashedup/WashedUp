import { useQuery, type QueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

/**
 * Auth-routing profile cache.
 *
 * Both `app/_layout.tsx` (root checkAuth + auth listener) and
 * `app/(tabs)/_layout.tsx` (onboarding guard) need the same three columns
 * to decide where to route the user. Without coalescing, an authed cold
 * start fires two identical `profiles` selects in <100ms.
 *
 * checkAuth seeds the cache via `seedAuthProfile` after its fetch, so the
 * tabs guard can read from cache via `getAuthProfile` without a second
 * round trip.
 */

export type AuthProfile = {
  onboarding_status: string | null;
  referral_source: string | null;
  phone_number: string | null;
};

const PROFILE_STALE_MS = 60_000;

export const AUTH_PROFILE_KEY = (userId: string) =>
  ['authProfile', userId] as const;

async function fetchAuthProfile(userId: string): Promise<AuthProfile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('onboarding_status, referral_source, phone_number')
    .eq('id', userId)
    .single();
  if (error || !data) return null;
  return data as AuthProfile;
}

/** React hook for components that want to subscribe to the cached profile. */
export function useAuthProfile(userId: string | null) {
  return useQuery({
    queryKey: userId ? AUTH_PROFILE_KEY(userId) : ['authProfile', 'none'],
    queryFn: () => fetchAuthProfile(userId!),
    enabled: !!userId,
    staleTime: PROFILE_STALE_MS,
  });
}

/** Seed the cache from outside the React tree (cold-start checkAuth). */
export function seedAuthProfile(
  queryClient: QueryClient,
  userId: string,
  data: AuthProfile,
) {
  queryClient.setQueryData(AUTH_PROFILE_KEY(userId), data);
}

/** Imperative fetch that respects cache + staleness — used by tabs guard. */
export function getAuthProfile(
  queryClient: QueryClient,
  userId: string,
): Promise<AuthProfile | null> {
  return queryClient.fetchQuery({
    queryKey: AUTH_PROFILE_KEY(userId),
    queryFn: () => fetchAuthProfile(userId),
    staleTime: PROFILE_STALE_MS,
  });
}

/** Invalidate the cached profile after a write. */
export function invalidateAuthProfile(
  queryClient: QueryClient,
  userId: string,
) {
  queryClient.invalidateQueries({ queryKey: AUTH_PROFILE_KEY(userId) });
}
