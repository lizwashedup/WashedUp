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

import { requestWithDeadline } from './requestWithDeadline';
import { withDeadline } from './withTimeout';
import { supabase } from './supabase';

/** PostgREST "function does not exist" signatures: proposal 49 not applied. */
function isFunctionMissing(code: string | undefined): boolean {
  return code === 'PGRST202' || code === '42883';
}

export type ParticipationVersions = { notice: string; terms: string };
export interface ParticipationAssentContext {
  versions?: ParticipationVersions;
  listingType: 'plan' | 'explore_event';
  listingId: string;
  organizerUserId: string | null;
  organizerName: string;
  action: 'join' | 'rsvp';
}

export async function getParticipationNoticeStatus(): Promise<{ needsAssent: boolean; versions?: ParticipationVersions }> {
  // No membership write has started. Let the member retry this read, even if
  // the first connection never answers. A late result cannot authorize a join.
  const { data, error } = await requestWithDeadline(supabase.rpc('get_participation_notice_status'), 12_000);
  if (error) {
    if (isFunctionMissing(error.code)) return { needsAssent: false };
    return { needsAssent: true };
  }
  const row = Array.isArray(data) ? (data.length === 1 ? data[0] : null) : data;
  // A successful transport is not an answer about this member. Only the
  // explicit false receipt (or the legacy missing RPC above) skips the notice.
  if (typeof row?.needs_assent !== 'boolean') throw new Error('Couldn’t check the participation notice. Try again.');
  const versions = typeof row.notice_version === 'string' && row.notice_version && typeof row.terms_version === 'string' && row.terms_version
    ? { notice: row.notice_version, terms: row.terms_version } : undefined;
  return versions ? { needsAssent: row.needs_assent, versions } : { needsAssent: row.needs_assent };
}

export async function recordParticipationAssent(ctx: ParticipationAssentContext, viewerId: string): Promise<boolean> {
  if (!ctx.versions || !viewerId) return false;
  const { data, error } = await withDeadline(supabase.rpc('record_participation_assent', {
    p_expected_user_id: viewerId, p_notice_version: ctx.versions.notice, p_terms_version: ctx.versions.terms,
    p_listing_type: ctx.listingType,
    p_listing_id: ctx.listingId,
    p_organizer_user_id: ctx.organizerUserId,
    // the evidence column caps the snapshot at 200; a longer display name
    // truncates rather than failing the assent
    p_organizer_name: ctx.organizerName.slice(0, 200),
    p_action: ctx.action,
  }), 12_000, 'Participation receipt');
  return error === null && isReceiptId(data);
}

function isReceiptId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
}

export async function getMemberTermsStatus(): Promise<{ needsAcceptance: boolean; termsVersion?: string }> {
  const { data, error } = await requestWithDeadline(supabase.rpc('get_member_terms_status'), 12_000);
  const row = Array.isArray(data) ? (data.length === 1 ? data[0] : null) : data;
  // An unconfirmed startup read must not open a blocking interstitial.
  if (error || typeof row?.needs_acceptance !== 'boolean' || typeof row.terms_version !== 'string' || !row.terms_version) {
    return { needsAcceptance: false };
  }
  return { needsAcceptance: row.needs_acceptance, termsVersion: row.terms_version };
}

export async function recordMemberTermsAcceptance(viewerId: string, termsVersion: string): Promise<boolean | 'outdated'> {
  if (!viewerId || !termsVersion) return false;
  const { data, error } = await withDeadline(supabase.rpc('record_member_terms_acceptance', {
    p_expected_user_id: viewerId, p_terms_version: termsVersion,
  }), 12_000, 'Member terms receipt');
  if (error?.code === '22023') return 'outdated';
  return error === null && isReceiptId(data);
}
