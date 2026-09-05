/**
 * Refund authority delegation (Liz decision #14, 2026-09-03): an owner can
 * grant a community co-creator scoped, revocable, audited authority to issue
 * refunds on the community's events. COMMUNITY / CREATOR-ACCOUNT SCOPE ONLY
 * -- see constants/FeatureFlags.ts's REFUND_AUTHORITY_ENABLED doc comment for
 * why the event-level half is out of scope here.
 *
 * All server-side enforcement lives in
 * supabase/migrations/20260904010000_refund_authority_grants.sql
 * (grant_/revoke_refund_authority, has_refund_authority RPCs), already wired
 * into supabase/functions/ticket-refund/index.ts's `allowed` check. This
 * file is the client data layer only -- no independent authorization logic
 * to keep in lockstep here (contrast lib/coCreatorInvites.ts's binding
 * predicate), since every write is a thin RPC call the DB fully decides.
 *
 * TIMING: grant_refund_authority() requires the grantee to already hold an
 * active, non-member role in community_members -- a fresh co-creator invite
 * does not satisfy this until it is accepted. Grant/revoke here is therefore
 * only ever called against the Team roster (already-active co-creators),
 * never against a pending invite target.
 */

import { supabase } from './supabase';

export type RefundAuthorityScope = 'event' | 'creator_account';

export interface RefundAuthorityGrant {
  id: string;
  scope: RefundAuthorityScope;
  eventId: string | null;
  communityId: string | null;
  granteeUserId: string;
  grantedByUserId: string;
  active: boolean;
  grantedAt: string;
  revokedAt: string | null;
  revokedByUserId: string | null;
}

/**
 * Primary-leader-only server-side (grant_refund_authority raises otherwise).
 * p_acknowledged is always sent true: the confirmation dialog the caller
 * shows before this runs IS the acknowledgment -- Liz's "explain that this
 * permission can move real money" requirement -- there is no path here that
 * grants without the caller having already shown that warning.
 */
export async function grantCommunityRefundAuthority(
  communityId: string,
  granteeUserId: string,
): Promise<string> {
  const { data, error } = await supabase.rpc('grant_refund_authority', {
    p_grantee_user_id: granteeUserId,
    p_community_id: communityId,
    p_acknowledged: true,
  });
  if (error) throw error;
  return data as string;
}

/** The original granter, the community's current leader/co_leader, or admin (server-checked). Idempotent. */
export async function revokeRefundAuthority(grantId: string): Promise<void> {
  const { error } = await supabase.rpc('revoke_refund_authority', { p_grant_id: grantId });
  if (error) throw error;
}

/**
 * Active creator_account-scoped grants for this community, leader/co_leader
 * visible by RLS (is_community_leader treats them as peers). No name/photo
 * enrichment here -- callers already have the Team roster
 * (getCommunityMembers) loaded and match rows by grantee_user_id.
 */
export async function listCommunityRefundAuthorityGrants(
  communityId: string,
): Promise<RefundAuthorityGrant[]> {
  const { data, error } = await supabase
    .from('refund_authority_grants')
    .select(
      'id, scope, event_id, community_id, grantee_user_id, granted_by_user_id, active, granted_at, revoked_at, revoked_by_user_id',
    )
    .eq('community_id', communityId)
    .eq('scope', 'creator_account')
    .eq('active', true)
    .order('granted_at', { ascending: false });
  if (error) throw error;
  return ((data ?? []) as any[]).map((r) => ({
    id: r.id,
    scope: r.scope,
    eventId: r.event_id,
    communityId: r.community_id,
    granteeUserId: r.grantee_user_id,
    grantedByUserId: r.granted_by_user_id,
    active: r.active,
    grantedAt: r.granted_at,
    revokedAt: r.revoked_at,
    revokedByUserId: r.revoked_by_user_id,
  }));
}

/** Pure: the active grant (if any) for one grantee, from an already-loaded list. */
export function activeGrantForUser(
  grants: RefundAuthorityGrant[],
  userId: string,
): RefundAuthorityGrant | null {
  return grants.find((g) => g.active && g.granteeUserId === userId) ?? null;
}

export type RefundIssuanceKind = 'buyer_request' | 'organizer_cancel' | 'admin';

export interface RefundIssuanceLogRow {
  id: string;
  orderId: string;
  eventId: string | null;
  eventTitle: string | null;
  issuedByUserId: string;
  issuedByName: string | null;
  issuerIsOwner: boolean;
  reason: string | null;
  kind: RefundIssuanceKind;
  positionIndexes: number[] | null;
  refundAmountCents: number;
  stripeRefundId: string;
  createdAt: string;
}

/**
 * Every refund this VIEWER's RLS allows them to see for this community's
 * events -- the real owner sees the full history, a delegate sees only
 * refunds they themselves issued (refund_issuance_log_select policy). Same
 * two-step event-then-log shape getMemberEventHistory (lib/creatorMode.ts)
 * already uses, rather than a multi-level embedded filter, so this stays
 * correct without a live Postgres to verify a deeper nested filter against.
 */
export async function listCommunityRefundIssuanceLog(
  communityId: string,
): Promise<RefundIssuanceLogRow[]> {
  const { data: events, error: eventsErr } = await supabase
    .from('explore_events')
    .select('id, title')
    .eq('community_id', communityId);
  if (eventsErr) throw eventsErr;
  if (!events || events.length === 0) return [];

  const eventIds = events.map((e: any) => e.id);
  const eventById = new Map(events.map((e: any) => [e.id, e.title as string]));

  const { data, error } = await supabase
    .from('refund_issuance_log')
    .select(
      'id, order_id, issued_by_user_id, issuer_is_owner, reason, kind, position_indexes, refund_amount_cents, stripe_refund_id, created_at, ticket_orders!inner(event_id)',
    )
    .in('ticket_orders.event_id', eventIds)
    .order('created_at', { ascending: false });
  if (error) throw error;
  const rows = (data ?? []) as any[];
  if (rows.length === 0) return [];

  const issuerIds = Array.from(new Set(rows.map((r) => r.issued_by_user_id as string)));
  let nameById = new Map<string, string>();
  if (issuerIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles_public')
      .select('id, first_name_display')
      .in('id', issuerIds);
    nameById = new Map((profiles ?? []).map((p: any) => [p.id, p.first_name_display ?? 'Someone']));
  }

  return rows.map((r) => {
    const eventId = r.ticket_orders?.event_id ?? null;
    return {
      id: r.id,
      orderId: r.order_id,
      eventId,
      eventTitle: eventId ? (eventById.get(eventId) ?? null) : null,
      issuedByUserId: r.issued_by_user_id,
      issuedByName: nameById.get(r.issued_by_user_id) ?? null,
      issuerIsOwner: r.issuer_is_owner,
      reason: r.reason,
      kind: r.kind,
      positionIndexes: r.position_indexes,
      refundAmountCents: r.refund_amount_cents,
      stripeRefundId: r.stripe_refund_id,
      createdAt: r.created_at,
    };
  });
}

/** "$12.50" -- pure formatting, no network. */
export function formatRefundAmount(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** Plain, non-jargon label for the issuance log -- never surfaces the internal 'kind' string verbatim. */
export function refundKindLabel(kind: RefundIssuanceKind): string {
  switch (kind) {
    case 'buyer_request':
      return 'Refund';
    case 'organizer_cancel':
      return 'Event canceled';
    case 'admin':
      return 'Support refund';
    default:
      return 'Refund';
  }
}
