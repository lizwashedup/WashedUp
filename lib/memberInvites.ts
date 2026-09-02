/**
 * Member invites (Build 35 Screen 56). An existing leader/co_leader of a
 * community invites an existing WashedUp profile to join as a plain member.
 * Acceptance grants community_members role='member' directly -- see the
 * migration header for why this activates immediately rather than landing in
 * the join-request review queue.
 *
 * All server-side enforcement lives in
 * supabase/migrations/20260901020000_build35_screen56_member_invites.sql
 * (DRAFT, not yet applied -- create_/preview_/accept_/revoke_member_invite
 * RPCs). This file is the client data layer PLUS a pure, DB-independent
 * re-expression of the exact same binding predicate the SQL enforces -- see
 * decideMemberInviteBindingOutcome() below, mirroring
 * lib/coCreatorInvites.ts' decideInviteBindingOutcome(). Keep the two in
 * lockstep if either changes; lib/__tests__/memberInvites.test.ts unit-tests
 * the pure form directly, since this sandbox has no live Postgres to run the
 * SQL self-test against.
 *
 * V1 SCOPE: existing-profile invites only (searchProfilesForInvite(), reused
 * from lib/coCreatorInvites.ts rather than duplicated here -- it was never
 * co-creator-specific). Phone-contact invites (the PDF's "optionally phone
 * contacts" action) are an explicit open product decision per the Screen 56
 * scope doc, not built here -- see MEMBER_INVITES_ENABLED in
 * constants/FeatureFlags.ts and the migration header for detail.
 */

import { supabase } from './supabase';

// -- pure binding logic (mirrors the SQL RPC; DB-independent, unit-tested) ---

export type MemberInviteStatus = 'pending' | 'viewed' | 'accepted' | 'revoked' | 'expired';

export interface MemberInviteRecord {
  id: string;
  communityId: string;
  targetUserId: string;
  status: MemberInviteStatus;
  expiresAt: string;
}

export interface MemberInviteCallerIdentity {
  userId: string;
}

export type MemberInviteBindingOutcome =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'expired' | 'not_pending' | 'not_your_invite' };

/**
 * True only when the caller IS the invite's own target_user_id. Simpler than
 * community_creator_invites' isBindingMatch: v1 has no email/phone target
 * path, so there is no confirmed-contact matching to fall back on -- just
 * identity. A caller's identity is only ever taken from auth.uid()
 * server-side, never a client-supplied claim (see the RPC).
 */
export function isMemberInviteBindingMatch(
  invite: MemberInviteRecord,
  caller: MemberInviteCallerIdentity,
): boolean {
  return invite.targetUserId === caller.userId;
}

/**
 * The full acceptance decision: not-found / expired / already-used / bound
 * check, in the same order accept_member_invite() evaluates them. Pure
 * function, no I/O -- pass in whatever invite row and caller identity you
 * have (real ones from a DB, or synthetic ones from a test).
 */
export function decideMemberInviteBindingOutcome(
  invite: MemberInviteRecord | null,
  caller: MemberInviteCallerIdentity,
  now: Date = new Date(),
): MemberInviteBindingOutcome {
  if (!invite) return { ok: false, reason: 'not_found' };
  if (invite.status === 'expired') return { ok: false, reason: 'expired' };
  // 'viewed' (opened via preview_member_invite but not yet accepted) is still
  // acceptable, same as 'pending' -- mirrors the SQL RPC's own
  // `status IN ('pending', 'viewed')` check.
  if (invite.status !== 'pending' && invite.status !== 'viewed') return { ok: false, reason: 'not_pending' };
  if (new Date(invite.expiresAt).getTime() <= now.getTime()) return { ok: false, reason: 'expired' };
  if (!isMemberInviteBindingMatch(invite, caller)) return { ok: false, reason: 'not_your_invite' };
  return { ok: true };
}

// -- status buckets for the inviter's review view (scope doc §2: "a status
// view (Invited / Joined / Expired)") ----------------------------------------

export type MemberInviteBucket = 'invited' | 'joined' | 'past';

/** pending+viewed -> outstanding "Invited"; accepted -> "Joined"; revoked/expired -> past. */
export function memberInviteBucket(status: MemberInviteStatus): MemberInviteBucket {
  if (status === 'pending' || status === 'viewed') return 'invited';
  if (status === 'accepted') return 'joined';
  return 'past';
}

// -- RPC wrappers --------------------------------------------------------------

export interface CreateMemberInviteResult {
  inviteId: string;
  rawToken: string;
  expiresAt: string;
}

/** Leader/co_leader-only server-side (is_community_leader). Returns the raw token ONCE; nothing here sends it anywhere. */
export async function createMemberInvite(
  communityId: string,
  targetUserId: string,
  message?: string,
): Promise<CreateMemberInviteResult> {
  const args: Record<string, unknown> = { p_community_id: communityId, p_target_user_id: targetUserId };
  const trimmed = message?.trim();
  if (trimmed) args.p_message = trimmed;

  const { data, error } = await supabase.rpc('create_member_invite', args).single();
  if (error) throw error;
  const row = data as { invite_id: string; raw_token: string; expires_at: string };
  return { inviteId: row.invite_id, rawToken: row.raw_token, expiresAt: row.expires_at };
}

/** In-app deep link (the existing `washedupapp://` scheme; no new universal-link domain wired here). */
export function buildMemberInviteLink(rawToken: string): string {
  return `washedupapp://invite/member/${encodeURIComponent(rawToken)}`;
}

export interface MemberInvitePreview {
  inviteId: string;
  communityId: string;
  communityName: string;
  communityHandle: string;
  invitedByName: string;
  status: MemberInviteStatus;
  expiresAt: string;
  inviteMessage: string | null;
}

/** Anon-callable. Read-only: looking a token up never consumes or grants it. */
export async function previewMemberInvite(token: string): Promise<MemberInvitePreview | null> {
  const { data, error } = await supabase.rpc('preview_member_invite', { p_token: token }).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as {
    invite_id: string; community_id: string; community_name: string; community_handle: string;
    invited_by_name: string; status: MemberInviteStatus; expires_at: string; invite_message: string | null;
  };
  return {
    inviteId: row.invite_id,
    communityId: row.community_id,
    communityName: row.community_name,
    communityHandle: row.community_handle,
    invitedByName: row.invited_by_name,
    status: row.status,
    expiresAt: row.expires_at,
    inviteMessage: row.invite_message,
  };
}

export interface AcceptMemberInviteResult {
  communityId: string;
}

/** The binding check happens server-side inside this call, unconditionally -- see the SQL RPC. */
export async function acceptMemberInviteByToken(token: string): Promise<AcceptMemberInviteResult> {
  const { data, error } = await supabase.rpc('accept_member_invite', { p_token: token }).single();
  if (error) throw error;
  const row = data as { community_id: string };
  return { communityId: row.community_id };
}

export async function acceptMemberInviteById(inviteId: string): Promise<AcceptMemberInviteResult> {
  const { data, error } = await supabase.rpc('accept_member_invite', { p_invite_id: inviteId }).single();
  if (error) throw error;
  const row = data as { community_id: string };
  return { communityId: row.community_id };
}

/** Inviter, any active leader/co_leader of the community, or admin (server-checked). Idempotent. */
export async function revokeMemberInvite(inviteId: string): Promise<void> {
  const { error } = await supabase.rpc('revoke_member_invite', { p_invite_id: inviteId });
  if (error) throw error;
}

export interface MemberInviteRow {
  id: string;
  communityId: string;
  invitedByUserId: string;
  targetUserId: string;
  inviteMessage: string | null;
  status: MemberInviteStatus;
  expiresAt: string;
  createdAt: string;
  targetName: string | null;
  targetPhoto: string | null;
}

/** Leader/co_leader/inviter/admin-visible by RLS; no RPC needed for the read path. */
export async function listCommunityMemberInvites(communityId: string): Promise<MemberInviteRow[]> {
  const { data, error } = await supabase
    .from('community_member_invites')
    .select('id, community_id, invited_by_user_id, target_user_id, invite_message, status, expires_at, created_at')
    .eq('community_id', communityId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  const rows = (data ?? []) as Array<{
    id: string; community_id: string; invited_by_user_id: string; target_user_id: string;
    invite_message: string | null; status: MemberInviteStatus; expires_at: string; created_at: string;
  }>;

  const ids = Array.from(new Set(rows.map((r) => r.target_user_id)));
  let byId = new Map<string, { first_name_display: string | null; profile_photo_url: string | null }>();
  if (ids.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles_public')
      .select('id, first_name_display, profile_photo_url')
      .in('id', ids);
    byId = new Map((profiles ?? []).map((p: any) => [p.id, p]));
  }

  return rows.map((r) => ({
    id: r.id,
    communityId: r.community_id,
    invitedByUserId: r.invited_by_user_id,
    targetUserId: r.target_user_id,
    inviteMessage: r.invite_message,
    status: r.status,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
    targetName: byId.get(r.target_user_id)?.first_name_display ?? null,
    targetPhoto: byId.get(r.target_user_id)?.profile_photo_url ?? null,
  }));
}
