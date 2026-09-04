/**
 * Ticket transfer (item 15, Liz confirmed 2026-09-03): the current holder of
 * a seat starts a transfer, the recipient claims it through the same
 * /t/<code> shape already proven for referrals (compare
 * lib/yours/referralLink.ts / claim_referral_invite). Draft migration:
 * supabase/migrations/20260904010000_ticket_transfer_draft.sql -- NOT
 * applied to any database yet.
 *
 * Legal note carried from the migration: the claim step re-collects any
 * required per-attendee question fresh from the recipient, which is correct
 * mechanically, but Liz's own approval says final waiver handling still
 * needs real legal review before this ships. Nothing here certifies that.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { getQuestions, type TicketQuestion } from './ticketing';

const PENDING_KEY = 'pendingTicketTransferCode';

/** Extract the <code> from a washedup.app/t/<code> or washedupapp://t/<code> URL. */
export function parseTransferCode(url: string): string | null {
  if (!url || !/(^|[/.])washedup(app)?(\.app)?/i.test(url)) return null;
  const m = url.match(/\/t\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

export interface TransferPreview {
  eventId: string;
  eventTitle: string;
}

/**
 * What the claim screen shows before the recipient commits: which event,
 * so it can also fetch that event's required per-attendee questions. Works
 * before the transfer is claimed (the audit table's own RLS does not let a
 * not-yet-recipient read it directly).
 */
export async function previewTransfer(code: string): Promise<TransferPreview | null> {
  const { data, error } = await supabase.rpc('preview_ticket_transfer', { p_code: code });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row?.event_id) return null;
  return { eventId: row.event_id as string, eventTitle: (row.event_title as string) ?? '' };
}

/** Current holder starts a transfer for one seat. Returns the share code, or null on failure. */
export async function startTransfer(positionId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('start_ticket_transfer', { p_position_id: positionId });
  if (error || !data) return null;
  return data as string;
}

/** The initiating holder can undo their own transfer while it is still pending. */
export async function cancelTransfer(code: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('cancel_ticket_transfer', { p_transfer_code: code });
  return !error && data === true;
}

/** Every active, required, per-attendee question the claim screen must ask fresh. */
export async function getRequiredAttendeeQuestions(eventId: string): Promise<TicketQuestion[]> {
  const all = await getQuestions(eventId);
  return all.filter((q) => q.scope === 'per_attendee' && q.required);
}

/**
 * Recipient claims a pending transfer, answering every required per-attendee
 * question fresh -- the original attendee's answers are never reused (the
 * RPC enforces this, not just this client call). Returns the event id to
 * route to, or null if the code was invalid/expired/already claimed.
 */
export async function claimTransfer(
  code: string,
  answers: Array<{ question_id: string; value: unknown }>,
): Promise<string | null> {
  const { data, error } = await supabase.rpc('claim_ticket_transfer', {
    p_code: code,
    p_answers: answers,
  });
  if (error || !data) return null;
  return data as string;
}

/** Stash a transfer code for consumePendingTransfer() to run after sign-in. */
export async function stashPendingTransfer(code: string): Promise<void> {
  try {
    await AsyncStorage.setItem(PENDING_KEY, code);
  } catch {
    /* best-effort */
  }
}

/** Read back (without clearing) a transfer code stashed while signed out. */
export async function readPendingTransfer(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(PENDING_KEY);
  } catch {
    return null;
  }
}

export async function clearPendingTransfer(): Promise<void> {
  try {
    await AsyncStorage.removeItem(PENDING_KEY);
  } catch {
    /* best-effort */
  }
}

/**
 * Unlike consumePendingReferral(), a stashed transfer code cannot resolve
 * itself silently after sign-in -- claiming may need fresh per-attendee
 * answers first. This only routes the person back to the claim screen so
 * app/t/[code].tsx can pick up where it left off; call it wherever
 * consumePendingReferral() already runs after sign-in.
 */
export async function pendingTransferRoute(): Promise<string | null> {
  const code = await readPendingTransfer();
  return code ? `/t/${code}` : null;
}
