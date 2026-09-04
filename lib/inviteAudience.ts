/**
 * Invite audience (Liz decision #6, 2026-09-03, the net-new half): a
 * creator inviting people who are NOT yet registered for a NEW event --
 * past attendees of the creator's other events, organization followers,
 * or (when the event belongs to a community) community members. This is a
 * different action from "Message attendees" (people already registered
 * for THIS event): that one has no send backend anywhere in this codebase
 * (see constants/FeatureFlags.ts's EVENT_SUMMARY_ENABLED note) and its
 * send button is out of scope here on purpose.
 *
 * Legal-gate note, read before wiring a real send here: the planning doc
 * (clients/washed-up/LIZ-OPEN-QUESTIONS.md) attributes "Message attendees"
 * being unsent to a legal timeline (counsel's 30e conditional, WashedUp
 * PBC/EIN reconciliation), not an engineering gap. Nothing in this
 * repo's own code cites that reasoning -- grepped for "30e" and "EIN
 * reconciliation", zero hits outside the planning doc. Separately, the
 * follower-broadcast feature (lib/followerBroadcasts.ts,
 * app/(creator)/organizer-broadcast.tsx) already ships a real, un-gated
 * send today, which is strong evidence the legal concern is specific to
 * messaging people with a transactional/ticket relationship, not to
 * broadcasting to a self-selected follow/community relationship. That
 * makes the "followers" and "community members" audiences here look safe
 * by the same precedent. The "past attendees" audience is the genuinely
 * unclear case: those people DO have a transactional history (a ticket or
 * RSVP to a DIFFERENT, past event), even though this message is about a
 * new event, not their past purchase. Do not assume that's fine or that
 * it's blocked -- ask counsel or Josh directly before enabling a real send
 * to that specific audience. This module only computes real, read-only
 * preview counts; it does not send anything (see invite-audience.tsx).
 *
 * Net-new bug fix noted in the same Liz decision, for whenever "Message
 * attendees" gets a real backend: it must reach everyone with a ticket OR
 * a confirmed RSVP, not just ticket holders (today's draft silently drops
 * RSVPs -- confirmed a real bug, not a choice). The exact shape once that
 * backend exists: recipients = DISTINCT(
 *   ticket_orders.buyer_user_id WHERE ticket_orders.event_id = :event AND
 *     ticket_orders.status = 'paid'
 *   UNION
 *   explore_event_rsvps.user_id WHERE explore_event_rsvps.explore_event_id
 *     = :event AND explore_event_rsvps.status = 'going'
 * ). The same union (across the creator's OTHER events instead of one
 * event) is exactly what getPastAttendeesCount below already does for
 * this new feature -- reuse it as the reference implementation instead of
 * re-deriving the filter from scratch.
 */

import { supabase } from './supabase';

export type InviteAudienceType = 'past_attendees' | 'followers' | 'community_members';

export interface InviteAudienceOption {
  type: InviteAudienceType;
  label: string;
}

/** Community members only makes sense when the event actually belongs to one. */
export function getInviteAudienceOptions(communityId: string | null): InviteAudienceOption[] {
  const options: InviteAudienceOption[] = [
    { type: 'past_attendees', label: 'people who came to one of your past events' },
    { type: 'followers', label: 'your followers' },
  ];
  if (communityId) {
    options.push({ type: 'community_members', label: 'your community members' });
  }
  return options;
}

/**
 * Distinct people who either bought a paid ticket or hold a confirmed RSVP
 * on any of this creator's OTHER events (excludeEventId is the new event
 * being invited to, never counted against itself). Two plain reads + a
 * client-side Set, not a new RPC or migration -- this repo already has a
 * host_user_id-scoped events list and both source tables are simple to
 * query directly at this scale.
 */
export async function getPastAttendeesCount(
  creatorUserId: string,
  excludeEventId: string | null,
): Promise<number | null> {
  const { data: events, error: eventsError } = await supabase
    .from('explore_events')
    .select('id')
    .eq('host_user_id', creatorUserId);
  if (eventsError) return null;

  const eventIds = (events ?? [])
    .map((e: { id: string }) => e.id)
    .filter((id: string) => id !== excludeEventId);
  if (eventIds.length === 0) return 0;

  const [ticketResult, rsvpResult] = await Promise.all([
    supabase
      .from('ticket_orders')
      .select('buyer_user_id')
      .in('event_id', eventIds)
      .eq('status', 'paid'),
    supabase
      .from('explore_event_rsvps')
      .select('user_id')
      .in('explore_event_id', eventIds)
      .eq('status', 'going'),
  ]);
  if (ticketResult.error || rsvpResult.error) return null;

  const people = new Set<string>();
  for (const row of ticketResult.data ?? []) {
    if (row.buyer_user_id) people.add(row.buyer_user_id as string);
  }
  for (const row of rsvpResult.data ?? []) {
    if (row.user_id) people.add(row.user_id as string);
  }
  return people.size;
}

/** Active members of a community. Plain exact count, no new RPC needed. */
export async function getCommunityMemberCount(communityId: string): Promise<number | null> {
  const { count, error } = await supabase
    .from('community_members')
    .select('user_id', { count: 'exact', head: true })
    .eq('community_id', communityId)
    .eq('status', 'active');
  if (error) return null;
  return count ?? 0;
}
