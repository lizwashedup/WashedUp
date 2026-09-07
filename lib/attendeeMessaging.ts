/**
 * Native compose-and-preview layer for Build 35's event-communications
 * cluster (Screens 6 event messages, 60 reminder settings, 61 attendee
 * composer). Mirrors washedup-web's src/lib/communities/organizerData.ts /
 * attendeeMessaging.ts naming and semantics -- Screen 6's own gap says
 * "port rather than invent" -- but deliberately does NOT port that file's
 * SEND orchestration (the daily cap, opt-out lookup, essential-reason
 * enforcement, or the attendee_message_sends / attendee_message_opt_outs
 * tables). That backend is still a DRAFT migration living in the web repo
 * (supabase/migrations/20260904060000_attendee_message_send.sql, header:
 * "DO NOT APPLY WITHOUT JOSH'S WORD"), gated behind
 * ATTENDEE_MESSAGE_SEND_ENABLED, which defaults off everywhere including on
 * web today. Building a second, independent implementation of that
 * safety-critical logic here would create two places recipient/cap logic
 * can drift apart -- exactly what attendeeMessaging.ts's own header says it
 * was written to avoid ("so there is exactly one place recipient logic
 * lives"). So this file only computes real, live audience data for preview
 * and review; attendee-message.tsx is honest that sending itself is not
 * open yet, the same "the button never lies" principle already used twice
 * in this app (event-summary.tsx's messages row, web's own held-send
 * banner in AttendeeMessageComposer.tsx).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { isLiveSeat, type DoorAttendee } from './ticketAttendees';

export type MessageKind = 'promotional' | 'essential';
export type EssentialReason = 'cancellation' | 'venue_change' | 'time_change';

/** Liz's exact three reasons (decision #6, 2026-09-04) -- do not add a
 *  fourth without a new decision, matching web's own comment on this list. */
export const ESSENTIAL_REASONS: EssentialReason[] = ['cancellation', 'venue_change', 'time_change'];

export const ESSENTIAL_REASON_LABEL: Record<EssentialReason, string> = {
  cancellation: "it's cancelled",
  venue_change: 'the venue changed',
  time_change: 'the time changed',
};

/** Documented so the composer's copy can state it; not enforced here since
 *  there is no live send to enforce it against yet (see file header). */
export const MANUAL_MESSAGE_DAILY_CAP = 3;
export const MESSAGE_SUBJECT_MAX = 160;
export const MESSAGE_BODY_MAX = 5000;

export interface SeatFilter {
  tier: string | null;
  checkedIn: 'all' | 'in' | 'out';
  refunded: 'all' | 'yes' | 'no';
}

export const EMPTY_FILTER: SeatFilter = { tier: null, checkedIn: 'all', refunded: 'all' };

export function isFilterOpen(filter: SeatFilter): boolean {
  return !filter.tier && filter.checkedIn === 'all' && filter.refunded === 'all';
}

/**
 * The same predicates app/creator/attendees.tsx's own filter chips already
 * use (isLiveSeat + checkedIn/refundedCents), factored out here so the
 * composer's audience picker and its recipient count always agree with
 * what the real attendee list would show for the same filter.
 */
export function filterSeats(seats: DoorAttendee[], filter: SeatFilter): DoorAttendee[] {
  return seats.filter((a) => {
    if (filter.tier && a.tierName !== filter.tier) return false;
    if (filter.checkedIn === 'in' && !(isLiveSeat(a) && a.checkedIn)) return false;
    if (filter.checkedIn === 'out' && !(isLiveSeat(a) && !a.checkedIn)) return false;
    const isRefunded = a.refundedCents > 0 || a.voided;
    if (filter.refunded === 'yes' && !isRefunded) return false;
    if (filter.refunded === 'no' && isRefunded) return false;
    return true;
  });
}

/**
 * Live recipient count for the composer's audience preview. Dedupes by
 * orderId -- one message per buyer/party, not one per seat -- mirroring
 * web's resolveRecipientUserIds deduping by buyer_user_id. RSVPs (going, no
 * ticket) are added only when the filter is fully open, the same rule
 * attendeeMessaging.ts's own resolveRecipientUserIds uses: an RSVP has no
 * tier/check-in/refund state to match against a narrowing filter.
 */
export function countMessageRecipients(seats: DoorAttendee[], filter: SeatFilter, rsvpGoingCount: number): number {
  const matched = filterSeats(seats, filter);
  const orders = new Set(matched.map((a) => a.orderId));
  return orders.size + (isFilterOpen(filter) ? rsvpGoingCount : 0);
}

/**
 * Free-RSVP "going" headcount for an event -- the same table/status
 * lib/creatorMode.ts's getMemberEventHistory and lib/inviteAudience.ts
 * already read for organizer-side reads (RLS-gated the same way). A
 * count-only head request, never a row fetch: a composer preview never
 * needs to know who they are, only how many.
 */
export async function getEventRsvpGoingCount(eventId: string): Promise<number> {
  const { count, error } = await supabase
    .from('explore_event_rsvps')
    .select('user_id', { count: 'exact', head: true })
    .eq('explore_event_id', eventId)
    .eq('status', 'going');
  if (error) return 0;
  return count ?? 0;
}

/**
 * Send-test-to-yourself: pushes the exact subject/body to the organizer's
 * own account via the same OneSignal pipeline a real send would use
 * (app_notifications -> claim_pending_push_notifications ->
 * send-push-notifications), completely independent of the real send backend
 * described in this file's header (no attendee_message_sends row, no daily
 * cap, no opt-out lookup -- see the RPC's own migration). The RPC takes no
 * audience parameter at all -- auth.uid() is the only possible recipient,
 * re-verified server-side on every call -- so there is no way for this to
 * reach anyone but the caller.
 */
export async function sendAttendeeMessageTestToSelf(eventId: string, subject: string, body: string): Promise<void> {
  const { error } = await supabase.rpc('send_attendee_message_test_to_self', {
    p_event_id: eventId,
    p_subject: subject,
    p_body: body,
  });
  if (error) throw error;
}

// ─── local drafts ──────────────────────────────────────────────────────
// AsyncStorage mirrors web's localStorage draft (AttendeeMessageComposer.tsx),
// so nothing an organizer writes in the composer or reminder settings is
// lost between app opens, before any real send/save backend exists.

export async function saveDraft<T>(key: string, value: T): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* best-effort, matches lib/knownAccount.ts's own precedent */
  }
}

export async function loadDraft<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
