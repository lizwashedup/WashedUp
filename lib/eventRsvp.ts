/**
 * Just-join RSVPs (batch 15) plus the doc 09 RSVP-moment nudge bookkeeping.
 * Going solo is a real path: an RSVP is the count and the reminder, no chat.
 * The smart popup shows ONCE per event (locally remembered); after that,
 * count-me-in is a plain toggle. Identities are owner-only by RLS; the
 * public number rides get_event_rsvp_count.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

const NUDGE_KEY_PREFIX = 'event-rsvp-nudge-';

export type RsvpStatus = 'going' | 'cancelled' | null;

export function canParticipateInSceneEvent(
  sceneEnabled: boolean,
  communitiesEnabled: boolean,
  communityId: string | null | undefined,
): boolean {
  return sceneEnabled && (
    communityId === null ||
    (communitiesEnabled && typeof communityId === 'string')
  );
}

export function isCommunityEventReleaseBlocked(
  communitiesEnabled: boolean,
  communityId: string | null | undefined,
): boolean {
  return Boolean(communityId) && !communitiesEnabled;
}

export async function getMyRsvp(eventId: string, expectedUserId?: string | null): Promise<RsvpStatus> {
  const { data: { user }, error: accountError } = await supabase.auth.getUser();
  if (accountError) throw accountError;
  if (expectedUserId !== undefined && (user?.id ?? null) !== expectedUserId) throw new Error('Your account changed. Check your attendance again.');
  if (!user) return null;
  const { data, error } = await supabase
    .from('explore_event_rsvps')
    .select('status')
    .eq('explore_event_id', eventId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) throw error;
  if (data && !['going', 'cancelled'].includes(data.status)) throw new Error('Your attendance could not be checked.');
  const after = await supabase.auth.getUser();
  if (after.error) throw after.error;
  if (after.data.user?.id !== user.id) throw new Error('Your account changed. Check your attendance again.');
  return data?.status ?? null;
}

export async function setRsvp(eventId: string, going: boolean, expectedUserId?: string | null,
  operation?: { updatedAt: string; isCurrent(): boolean; onDispatch?(): void }): Promise<void> {
  if (operation && !operation.isCurrent()) throw new Error('This attendance action is no longer active.');
  const { data: { user }, error: accountError } = await supabase.auth.getUser();
  if (operation && !operation.isCurrent()) throw new Error('This attendance action is no longer active.');
  if (accountError) throw accountError;
  if (!user) throw new Error('Not signed in');
  if (expectedUserId !== undefined && user.id !== expectedUserId) throw new Error('Your account changed. Check your attendance again.');
  // Capacity should eventually be enforced atomically via set_event_rsvp_atomic
  // (supabase/migrations/20260817130000_explore_event_rsvp_capacity.sql), but
  // that migration is not applied live yet -- confirmed directly against the
  // schema cache 2026-08-19 (PGRST202, function does not exist). Calling it
  // unconditionally was breaking every RSVP toggle. Reverted to the plain
  // upsert until the migration + a real capacity RPC actually ship (see C-21).
  operation?.onDispatch?.();
  const { error } = await supabase
    .from('explore_event_rsvps')
    .upsert(
      {
        explore_event_id: eventId,
        user_id: user.id,
        status: going ? 'going' : 'cancelled',
        updated_at: operation?.updatedAt ?? new Date().toISOString(),
      },
      { onConflict: 'explore_event_id,user_id' },
    );
  if (error) throw error;
}

export async function getRsvpCount(eventId: string): Promise<number | null> {
  const { data, error } = await supabase.rpc('get_event_rsvp_count', { p_event_id: eventId });
  if (error) return null;
  return typeof data === 'number' ? data : null;
}

/** One nudge per event, never again once answered (doc 09 addendum). */
export async function wasNudged(eventId: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(NUDGE_KEY_PREFIX + eventId)) === '1';
  } catch {
    return true; // storage misbehaving: err on not nudging twice
  }
}

export async function markNudged(eventId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(NUDGE_KEY_PREFIX + eventId, '1');
  } catch {}
}
