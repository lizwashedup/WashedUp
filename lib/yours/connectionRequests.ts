/**
 * The single client entry point for "add this person" -- backed by
 * add_or_accept_person (supabase/migrations/20260611000000_add_or_accept_person.sql),
 * THE HANDSHAKE, not the old direct send_people_request insert.
 *
 * Why this exists (circle-mutual-prerequest-race):
 * send_people_request only ever inserts MY OWN directional row and never
 * looks at the reverse direction. If Liz requests John and John requests
 * Liz -- whether at the exact same instant, or one right after the other
 * before either client has refetched -- two crossed pending rows land
 * (requester_user_id, recipient_user_id) is an ordered pair, so (Liz,John)
 * and (John,Liz) are two different rows and neither insert conflicts with
 * the other. Nothing ever reconciles that into a connection; both people
 * stay stuck seeing "Requested" forever.
 *
 * add_or_accept_person closes this by serializing same-pair callers on a
 * canonical (least,greatest) advisory xact lock, then re-checking state
 * inside the lock: whichever call lands second sees the first call's fresh
 * pending row and ACCEPTS it instead of inserting a counter-request. See the
 * migration's own in-transaction self-test for the 4 cases this covers
 * (no relationship / incoming pending -> accept / already connected /
 * blocked). This module is the one place the client calls it, so every
 * "add a person" surface (plan-history backlog, handle lookup, profile
 * card, keep page) gets the same race-safe handshake for free.
 *
 * Rule: do not reintroduce a direct client-side send_people_request call for
 * any person-adding UI, in this module or a new one. send_people_request has
 * no reciprocal check at all -- two people requesting each other, same
 * instant or one after the other, strands two crossed pending rows forever.
 * Route every new "add a person" surface through sendOrAcceptPeopleRequest
 * (add_or_accept_person) below instead.
 */
import { supabase } from '../supabase';
import type { AddOrAcceptOutcome, ConnectionContext } from './types';

const KNOWN_OUTCOMES: readonly AddOrAcceptOutcome[] = [
  'requested',
  'now_connected',
  'already_connected',
];

/**
 * Defensive parse of the RPC's return value. An outcome we don't recognize
 * must never be silently treated as a connection that may not exist --
 * 'requested' is the safe fallback (it just means the UI keeps showing a
 * pending state instead of falsely celebrating a connection).
 */
export function parseAddOrAcceptOutcome(raw: unknown): AddOrAcceptOutcome {
  return (KNOWN_OUTCOMES as readonly unknown[]).includes(raw)
    ? (raw as AddOrAcceptOutcome)
    : 'requested';
}

/**
 * Send-or-accept a people connection. Resolves to:
 *   'requested'          no relationship existed -> a pending request was sent
 *   'now_connected'      an incoming pending request existed -> now mutual
 *   'already_connected'  a race left the pair already mutual -> no-op
 * Throws on 'blocked' / 'cannot_re_request' / etc, same as the old
 * send_people_request call -- callers already route caught errors through
 * friendlyConnectionError.
 */
export async function sendOrAcceptPeopleRequest(args: {
  recipientId: string;
  context: ConnectionContext;
  contextEventId?: string | null;
}): Promise<AddOrAcceptOutcome> {
  const { data, error } = await supabase.rpc('add_or_accept_person', {
    p_target: args.recipientId,
    p_context: args.context,
    p_context_event_id: args.contextEventId ?? null,
  });
  if (error) throw error;
  return parseAddOrAcceptOutcome(data);
}
