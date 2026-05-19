// Waitlist Exceptions — client RPC wrappers + error copy.
//
// Single source of truth for the six Phase-1 RPCs (live on prod, frozen).
// Wrappers do NOT swallow errors: callers surface them via waitlistAlertMessage
// so a Postgres RAISE code never reaches the user as raw text.

import { supabase } from './supabase';
import { friendlyError } from './friendlyError';

export type WaitlistKind = 'waitlist' | 'accepted';
export type ExceptionStatus =
  | 'waiting'
  | 'invited'
  | 'accepted'
  | 'declined'
  | 'expired';

export interface WaitlistManagerRow {
  kind: WaitlistKind;
  user_id: string;
  first_name: string;
  photo: string | null;
  queue_position: number | null;
  total: number;
  exception_status: ExceptionStatus;
  context: string | null;
}

export async function getWaitlistForCreator(
  eventId: string,
): Promise<WaitlistManagerRow[]> {
  const { data, error } = await supabase.rpc('get_waitlist_for_creator', {
    p_event_id: eventId,
  });
  if (error) throw error;
  return (data ?? []) as WaitlistManagerRow[];
}

// Returns the new slots-used count (0-3).
export async function grantWaitlistException(
  eventId: string,
  userId: string,
): Promise<number> {
  const { data, error } = await supabase.rpc('grant_waitlist_exception', {
    p_event_id: eventId,
    p_user_id: userId,
  });
  if (error) throw error;
  return data as number;
}

export async function closeWaitlist(eventId: string): Promise<void> {
  const { error } = await supabase.rpc('close_waitlist', {
    p_event_id: eventId,
  });
  if (error) throw error;
}

export async function reopenWaitlist(eventId: string): Promise<void> {
  const { error } = await supabase.rpc('reopen_waitlist', {
    p_event_id: eventId,
  });
  if (error) throw error;
}

export async function acceptWaitlistException(eventId: string): Promise<void> {
  const { error } = await supabase.rpc('accept_waitlist_exception', {
    p_event_id: eventId,
  });
  if (error) throw error;
}

export async function declineWaitlistException(eventId: string): Promise<void> {
  const { error } = await supabase.rpc('decline_waitlist_exception', {
    p_event_id: eventId,
  });
  if (error) throw error;
}

export interface WaitlistManagerData {
  rows: WaitlistManagerRow[];
  slotsUsed: number;
  closed: boolean;
}

// One fetch for the manager route AND the plan-detail "Waitlist (N)" count.
// Both read it through WAITLIST_MANAGER_KEY so they share a single cache entry.
export async function fetchWaitlistManager(
  eventId: string,
): Promise<WaitlistManagerData> {
  const rows = await getWaitlistForCreator(eventId);
  const { data, error } = await supabase
    .from('events')
    .select('exception_slots_used, waitlist_closed')
    .eq('id', eventId)
    .single();
  if (error) throw error;
  return {
    rows,
    slotsUsed: data?.exception_slots_used ?? 0,
    closed: data?.waitlist_closed === true,
  };
}

// Map a known RAISE code to branded copy. Empty string = not one of ours.
// No em/en-dashes anywhere (standing rule).
function knownCodeMessage(err: unknown): string {
  const m = String(
    typeof err === 'string' ? err : (err as { message?: unknown } | null)?.message ?? '',
  );
  if (m.includes('exception_cap_reached'))
    return "You've used all 3 exception spots for this plan.";
  if (m.includes('not_next_in_line'))
    return 'Someone joined the waitlist before them. Invite the next person in line.';
  if (m.includes('no_one_waiting')) return "Nobody's waiting right now.";
  if (m.includes('invite_expired'))
    return 'This invite expired. Ask the creator to send a new one.';
  if (m.includes('no_active_invite'))
    return "There's no active invite for you on this plan.";
  if (m.includes('not_on_waitlist'))
    return "You're not on the waitlist for this plan.";
  if (m.includes('not_authorized')) return 'Only the plan creator can do that.';
  if (m.includes('not_found')) return "This plan isn't available anymore.";
  if (m.includes('not_authenticated')) return 'Please sign in again.';
  return '';
}

// Final user-facing string for a waitlist-exception error.
// Precedence: our mapped copy first (friendlyError would otherwise return a
// bare code like "exception_cap_reached" verbatim, since short codes don't
// match its raw-DB suppression patterns); otherwise fall back to friendlyError
// which suppresses any raw schema leakage.
export function waitlistAlertMessage(
  err: unknown,
  fallback = 'Something went wrong. Try again.',
): string {
  return knownCodeMessage(err) || friendlyError(err, fallback);
}

// True for FIFO/expiry races where the manager should refetch to re-derive
// the true next-eligible person.
export function isStaleOrderError(err: unknown): boolean {
  const m = String(
    typeof err === 'string' ? err : (err as { message?: unknown } | null)?.message ?? '',
  );
  return (
    m.includes('not_next_in_line') ||
    m.includes('no_one_waiting') ||
    m.includes('exception_cap_reached')
  );
}
