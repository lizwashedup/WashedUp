/**
 * Co-creator invites (R21, qa/requirements.json: "Co-creators and multiple
 * admins" -- foundation and test only, scopeClass yellow, releaseGate
 * block_b). A primary community leader invites a co-creator; acceptance
 * grants the EXISTING community_members role `co_leader` -- no new role
 * shape, is_community_leader() already treats leader/co_leader as peers
 * everywhere in the phase-1 skeleton.
 *
 * All server-side enforcement lives in
 * supabase/migrations/20260817180000_community_co_creator_invites.sql
 * (create_/preview_/accept_/revoke_co_creator_invite RPCs). This file is the
 * client data layer PLUS a pure, DB-independent re-expression of the exact
 * same binding predicate the SQL enforces -- see decideInviteBindingOutcome()
 * below and its header note. Keep the two in lockstep if either changes;
 * lib/__tests__/coCreatorInvites.test.ts unit-tests the pure form directly,
 * since this sandbox has no live Postgres to run the SQL self-test against.
 *
 * THE BINDING GUARANTEE: forwarding or leaking the invite link/token changes
 * who HOLDS it, never who it is FOR. A caller's identity is only ever taken
 * from their own confirmed contact info (never a client-supplied claim) --
 * see CallerIdentity below, and never trust anything except confirmedEmail /
 * confirmedPhone as proof of ownership.
 */

import { supabase } from './supabase';

// -- pure binding logic (mirrors the SQL RPC; DB-independent, unit-tested) ---

export type InviteStatus = 'pending' | 'accepted' | 'revoked' | 'expired';

export interface CoCreatorInviteRecord {
  id: string;
  communityId: string;
  /** Set at creation for the existing-profile path; null until acceptance for the email/phone path. */
  targetUserId: string | null;
  /** Normalized (lower + trim) at creation. Null when the invite targets an existing profile directly. */
  targetEmail: string | null;
  /** Normalized (digits only) at creation. Null when the invite targets an existing profile directly. */
  targetPhone: string | null;
  status: InviteStatus;
  /** ISO timestamp. */
  expiresAt: string;
}

export interface CallerIdentity {
  userId: string;
  /**
   * The caller's OWN confirmed email, from auth.users.email where
   * email_confirmed_at is set -- server-truthed, never a value the client
   * merely typed into a form. Null if absent or unconfirmed.
   */
  confirmedEmail: string | null;
  /** Same rule as confirmedEmail, for auth.users.phone / phone_confirmed_at. */
  confirmedPhone: string | null;
}

export type InviteBindingOutcome =
  | { ok: true; grantedRole: 'co_leader' }
  | { ok: false; reason: 'not_found' | 'expired' | 'not_pending' | 'not_your_invite' };

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizePhoneDigits(phone: string): string {
  return phone.replace(/[^0-9]/g, '');
}

/**
 * True only when the caller's OWN server-verified identity satisfies the
 * invite's target. Never takes a shortcut on "a token/id was presented" --
 * presenting the right token proves you HOLD the link, not that the invite
 * is FOR you. This is the one function a forwarded-link attack must defeat
 * and cannot.
 */
export function isBindingMatch(invite: CoCreatorInviteRecord, caller: CallerIdentity): boolean {
  if (invite.targetUserId) {
    return invite.targetUserId === caller.userId;
  }
  const emailMatch =
    !!invite.targetEmail &&
    !!caller.confirmedEmail &&
    invite.targetEmail === normalizeEmail(caller.confirmedEmail);
  const phoneMatch =
    !!invite.targetPhone &&
    !!caller.confirmedPhone &&
    invite.targetPhone === normalizePhoneDigits(caller.confirmedPhone);
  return emailMatch || phoneMatch;
}

/**
 * The full acceptance decision: not-found / expired / already-used / bound
 * check, in the same order the SQL RPC evaluates them. Pure function, no I/O
 * -- pass in whatever invite row and caller identity you have (real ones from
 * a DB, or synthetic ones from a test).
 */
export function decideInviteBindingOutcome(
  invite: CoCreatorInviteRecord | null,
  caller: CallerIdentity,
  now: Date = new Date(),
): InviteBindingOutcome {
  if (!invite) return { ok: false, reason: 'not_found' };
  if (invite.status === 'expired') return { ok: false, reason: 'expired' };
  if (invite.status !== 'pending') return { ok: false, reason: 'not_pending' };
  if (new Date(invite.expiresAt).getTime() <= now.getTime()) return { ok: false, reason: 'expired' };
  if (!isBindingMatch(invite, caller)) return { ok: false, reason: 'not_your_invite' };
  return { ok: true, grantedRole: 'co_leader' };
}

// -- client-side validation helpers (form input, not security boundaries) ----

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function looksLikeEmail(value: string): boolean {
  return EMAIL_SHAPE.test(value.trim());
}

export function looksLikePhone(value: string): boolean {
  return normalizePhoneDigits(value).length >= 10;
}

// -- RPC wrappers --------------------------------------------------------------

export interface CreateCoCreatorInviteResult {
  inviteId: string;
  rawToken: string;
  expiresAt: string;
}

export type CoCreatorInviteTarget =
  | { kind: 'profile'; userId: string }
  | { kind: 'email'; email: string }
  | { kind: 'phone'; phone: string };

/** Primary-leader-only server-side. Returns the raw token ONCE; nothing here sends it anywhere. */
export async function createCoCreatorInvite(
  communityId: string,
  target: CoCreatorInviteTarget,
): Promise<CreateCoCreatorInviteResult> {
  const args: Record<string, unknown> = { p_community_id: communityId };
  if (target.kind === 'profile') args.p_target_user_id = target.userId;
  if (target.kind === 'email') args.p_target_email = target.email;
  if (target.kind === 'phone') args.p_target_phone = target.phone;

  const { data, error } = await supabase.rpc('create_co_creator_invite', args).single();
  if (error) throw error;
  const row = data as { invite_id: string; raw_token: string; expires_at: string };
  return { inviteId: row.invite_id, rawToken: row.raw_token, expiresAt: row.expires_at };
}

/** In-app deep link (the existing `washedupapp://` scheme; no new universal-link domain wired here). */
export function buildCoCreatorInviteLink(rawToken: string): string {
  return `washedupapp://invite/co-creator/${encodeURIComponent(rawToken)}`;
}

export interface CoCreatorInvitePreview {
  inviteId: string;
  communityId: string;
  communityName: string;
  communityHandle: string;
  invitedByName: string;
  status: InviteStatus;
  expiresAt: string;
  /** Masked contact ("j***@example.com" / "***1234"), never the full address. Null for the existing-profile path. */
  targetHint: string | null;
}

/** Anon-callable. Read-only: looking a token up never consumes or grants it. */
export async function previewCoCreatorInvite(token: string): Promise<CoCreatorInvitePreview | null> {
  const { data, error } = await supabase.rpc('preview_co_creator_invite', { p_token: token }).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as {
    invite_id: string; community_id: string; community_name: string; community_handle: string;
    invited_by_name: string; status: InviteStatus; expires_at: string; target_hint: string | null;
  };
  return {
    inviteId: row.invite_id,
    communityId: row.community_id,
    communityName: row.community_name,
    communityHandle: row.community_handle,
    invitedByName: row.invited_by_name,
    status: row.status,
    expiresAt: row.expires_at,
    targetHint: row.target_hint,
  };
}

export interface AcceptCoCreatorInviteResult {
  communityId: string;
  role: 'co_leader';
}

/** The binding check happens server-side inside this call, unconditionally -- see the SQL RPC. */
export async function acceptCoCreatorInviteByToken(token: string): Promise<AcceptCoCreatorInviteResult> {
  const { data, error } = await supabase.rpc('accept_co_creator_invite', { p_token: token }).single();
  if (error) throw error;
  return data as AcceptCoCreatorInviteResult;
}

export async function acceptCoCreatorInviteById(inviteId: string): Promise<AcceptCoCreatorInviteResult> {
  const { data, error } = await supabase.rpc('accept_co_creator_invite', { p_invite_id: inviteId }).single();
  if (error) throw error;
  return data as AcceptCoCreatorInviteResult;
}

/** Inviter, any active leader/co_leader of the community, or admin (server-checked). Idempotent. */
export async function revokeCoCreatorInvite(inviteId: string): Promise<void> {
  const { error } = await supabase.rpc('revoke_co_creator_invite', { p_invite_id: inviteId });
  if (error) throw error;
}

export interface CoCreatorInviteRow {
  id: string;
  communityId: string;
  invitedByUserId: string;
  targetUserId: string | null;
  targetEmail: string | null;
  targetPhone: string | null;
  status: InviteStatus;
  expiresAt: string;
  createdAt: string;
  targetName: string | null;
  targetPhoto: string | null;
}

/** Leader/co_leader/inviter/admin-visible by RLS; no RPC needed for the read path. */
export async function listCommunityCoCreatorInvites(communityId: string): Promise<CoCreatorInviteRow[]> {
  const { data, error } = await supabase
    .from('community_creator_invites')
    .select(
      'id, community_id, invited_by_user_id, target_user_id, target_email, target_phone, status, expires_at, created_at',
    )
    .eq('community_id', communityId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  const rows = (data ?? []) as Array<{
    id: string; community_id: string; invited_by_user_id: string; target_user_id: string | null;
    target_email: string | null; target_phone: string | null; status: InviteStatus;
    expires_at: string; created_at: string;
  }>;

  const ids = Array.from(new Set(rows.map((r) => r.target_user_id).filter((v): v is string => !!v)));
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
    targetEmail: r.target_email,
    targetPhone: r.target_phone,
    status: r.status,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
    targetName: r.target_user_id ? (byId.get(r.target_user_id)?.first_name_display ?? null) : null,
    targetPhoto: r.target_user_id ? (byId.get(r.target_user_id)?.profile_photo_url ?? null) : null,
  }));
}

export interface ProfileSearchResult {
  id: string;
  name: string;
  photo: string | null;
}

/** Reuses the existing, live search_users_by_handle RPC (20260406000000) -- "finds an existing profile". */
export async function searchProfilesForInvite(
  query: string,
  currentUserId: string,
): Promise<ProfileSearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  const { data, error } = await supabase.rpc('search_users_by_handle', {
    p_query: trimmed,
    p_user_id: currentUserId,
  });
  if (error) return [];
  return ((data ?? []) as Array<{ id: string; first_name_display: string | null; profile_photo_url: string | null }>).map(
    (r) => ({ id: r.id, name: r.first_name_display ?? 'Someone', photo: r.profile_photo_url ?? null }),
  );
}
