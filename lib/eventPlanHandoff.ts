/**
 * The organization-event → Plan handoff (CTO spec item 07 / design-build
 * spec PL-01 / Creator Space Inventory O-08): "Let an organization-event
 * attendee optionally create or join a normal Plans group that is
 * pre-populated from the event data." Pure logic pulled out of the screen
 * it feeds (same shape as lib/eventRsvp.ts).
 *
 * This flow was already fully built inline in app/event/[id].tsx
 * (goFindPeople + the post-RSVP "want people to go with?" nudge) before
 * this module existed; the logic itself is not new, only its extraction
 * into pure, tested functions is. Two invariants both primary docs state
 * explicitly, now locked by test instead of "correct by inspection":
 *
 *   - a community event NEVER gets this affordance (item 04's chat-law
 *     revision: its RSVP enrolls the person in the event's OWN temporary
 *     chat, not a Plan — offering both would contradict that revision)
 *   - RSVP/purchase NEVER auto-creates a Plan (O-08) — nothing in this
 *     module writes to the database; it only ever builds data for a Plan
 *     the person explicitly chooses to start via the Post composer
 *
 * NOT built here (see openQuestionsForLiz): a creator-side flow that
 * selects ticket buyers/RSVPs off the attendee roster and adds them to a
 * Plan directly. No source doc describes that, and it raises a real
 * consent question (adding someone to a Plan without them choosing it)
 * none of the docs address either.
 */

import { MAX_GROUP } from '../constants/GroupLimits';

export interface OrganizationEventForHandoff {
  id: string;
  title: string;
  description: string | null;
  image_url: string | null;
  event_date: string | null;
  start_time: string | null;
  venue: string | null;
  venue_address: string | null;
  category: string | null;
  community_id: string | null;
}

/**
 * The exact router params /(tabs)/post reads as a Plan prefill. The index
 * signature is required so this is assignable to expo-router's
 * UnknownInputParams at the router.push() call site.
 */
export interface PlanPrefillParams {
  [key: string]: string;
  prefillTitle: string;
  prefillExploreEventId: string;
  prefillStartTime: string;
  prefillEventDate: string;
  prefillDescription: string;
  prefillImageUrl: string;
  prefillLocation: string;
  prefillCategory: string;
}

/**
 * Item 04's chat law: a community event's RSVP opens its own event-room
 * chat. "Find people to go with" only ever applies to an organization
 * (non-community) event — callers must check this before offering the
 * action or calling buildPlanPrefillFromEvent.
 */
export function canFindPeopleForEvent(
  event: Pick<OrganizationEventForHandoff, 'community_id'>,
): boolean {
  return !event.community_id;
}

/**
 * Builds the exact /(tabs)/post param set the Post composer's prefill
 * already reads (prefillExploreEventId links the new Plan back to the
 * event it was pre-populated from). venue_address wins over venue when
 * both exist, matching the address WashedUp already shows the buyer on
 * the event page itself. Every field falls back to '' rather than
 * undefined so a partial event row never reaches the composer's
 * controlled inputs as undefined.
 */
export function buildPlanPrefillFromEvent(
  event: OrganizationEventForHandoff,
): PlanPrefillParams {
  return {
    prefillTitle: event.title,
    prefillExploreEventId: event.id,
    prefillStartTime: event.start_time ?? '',
    prefillEventDate: event.event_date ?? '',
    prefillDescription: event.description ?? '',
    prefillImageUrl: event.image_url ?? '',
    prefillLocation: event.venue_address ?? event.venue ?? '',
    prefillCategory: event.category ?? '',
  };
}

export interface LinkedPlanForHandoff {
  id: string;
  memberCount: number;
  maxInvites: number | null;
}

/**
 * Spec item 07 / O-08: "show existing groups with space before Start a
 * new Plan." A group is open when it has not yet reached its real total
 * capacity — creator plus up to seven invitees, never more than
 * MAX_GROUP overall (mirrors the same capDisplayCount ceiling the event
 * detail screen already renders spots-left with).
 */
export function getOpenLinkedPlans<T extends LinkedPlanForHandoff>(
  plans: readonly T[],
): T[] {
  return plans.filter((p) => {
    const totalCapacity = Math.min((p.maxInvites ?? 7) + 1, MAX_GROUP);
    const count = Math.min(Math.max(0, Math.floor(p.memberCount)), MAX_GROUP);
    return count < totalCapacity;
  });
}
