/**
 * Member-side legal evidence bridge (proposal 49, legal v4.0): the
 * Independent Activity Notice before a first join/RSVP under each material
 * terms version, and the ToS reacceptance interstitial. The client stays
 * VERSION-DUMB: the server answers "does this caller owe the notice right
 * now" and stamps identity, versions, and time itself; the client only
 * reports the context it rendered.
 *
 * Self-flipping (house canon): until proposal 49 applies, the status RPCs
 * do not exist and both surfaces stay dormant (today's sanctioned
 * behavior). The moment 49 lands, the notice and the interstitial wake up
 * with no client deploy. After 49 is live, any OTHER status failure fails
 * CLOSED: the caller shows the notice, and if the assent cannot be
 * recorded the action does not proceed.
 */

import { supabase } from './supabase';

/** PostgREST "function does not exist" signatures: proposal 49 not applied. */
function isFunctionMissing(code: string | undefined): boolean {
  return code === 'PGRST202' || code === '42883';
}

export interface ParticipationAssentContext {
  listingType: 'plan' | 'explore_event';
  listingId: string;
  organizerUserId: string | null;
  organizerName: string;
  action: 'join' | 'rsvp';
}

export async function getParticipationNoticeStatus(): Promise<{ needsAssent: boolean }> {
  const { data, error } = await supabase.rpc('get_participation_notice_status');
  if (error) {
    if (isFunctionMissing(error.code)) return { needsAssent: false };
    return { needsAssent: true };
  }
  const row = Array.isArray(data) ? data[0] : data;
  return { needsAssent: !!row?.needs_assent };
}

export async function recordParticipationAssent(ctx: ParticipationAssentContext): Promise<boolean> {
  const { error } = await supabase.rpc('record_participation_assent', {
    p_listing_type: ctx.listingType,
    p_listing_id: ctx.listingId,
    p_organizer_user_id: ctx.organizerUserId,
    // the evidence column caps the snapshot at 200; a longer display name
    // truncates rather than failing the assent
    p_organizer_name: ctx.organizerName.slice(0, 200),
    p_action: ctx.action,
  });
  return !error;
}

export async function getMemberTermsStatus(): Promise<{ needsAcceptance: boolean }> {
  const { data, error } = await supabase.rpc('get_member_terms_status');
  if (error) {
    // Dormant until 49 applies; on any other failure the interstitial
    // simply does not show this open (it re-asks next open; a blocking
    // screen must never appear on a failed read, per the blocking-modal
    // offline-escape rule).
    return { needsAcceptance: false };
  }
  const row = Array.isArray(data) ? data[0] : data;
  return { needsAcceptance: !!row?.needs_acceptance };
}

export async function recordMemberTermsAcceptance(): Promise<boolean> {
  const { error } = await supabase.rpc('record_member_terms_acceptance');
  return !error;
}
