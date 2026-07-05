/**
 * Creator mode data layer (phase 4 logic).
 *
 * Everything here runs against the live phase 1 schema through RLS:
 * leadership comes from community_members (role leader/co_leader, active),
 * join approvals are leader UPDATEs on pending member rows, broadcasts are
 * leader INSERTs into community_broadcasts. No new migrations required for
 * this slice. Screens are functionally minimal per decision 15a (logic
 * before design).
 */

import { supabase } from './supabase';
import type { OperatorGrantStatus, OperatorTrack } from './operatorApplications';

export interface LedCommunity {
  id: string;
  handle: string;
  name: string;
  status: 'draft' | 'active' | 'archived';
  role: 'leader' | 'co_leader';
}

export interface CreatorAccess {
  /** Communities this user actively leads or co-leads. */
  ledCommunities: LedCommunity[];
  hasLeaderGrant: boolean;
  hasEventHostGrant: boolean;
}

export function hasCreatorAccess(a: CreatorAccess | undefined | null): boolean {
  if (!a) return false;
  return a.ledCommunities.length > 0 || a.hasLeaderGrant || a.hasEventHostGrant;
}

export async function getCreatorAccess(): Promise<CreatorAccess> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ledCommunities: [], hasLeaderGrant: false, hasEventHostGrant: false };

  const [{ data: memberships }, { data: grants }] = await Promise.all([
    supabase
      .from('community_members')
      .select('role, communities ( id, handle, name, status )')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .in('role', ['leader', 'co_leader']),
    supabase
      .from('operator_grants')
      .select('track, status')
      .eq('user_id', user.id)
      .eq('status', 'approved'),
  ]);

  const ledCommunities: LedCommunity[] = (memberships ?? [])
    .map((m: any) => {
      const c = m.communities;
      if (!c) return null;
      return { id: c.id, handle: c.handle, name: c.name, status: c.status, role: m.role };
    })
    .filter(Boolean) as LedCommunity[];

  const approved = (grants ?? []) as { track: OperatorTrack; status: OperatorGrantStatus }[];
  return {
    ledCommunities,
    hasLeaderGrant: approved.some((g) => g.track === 'community_leader'),
    hasEventHostGrant: approved.some((g) => g.track === 'event_host'),
  };
}

// -- members ------------------------------------------------------------------

export interface CommunityMemberRow {
  id: string;
  user_id: string;
  role: 'leader' | 'co_leader' | 'member';
  status: 'pending' | 'active' | 'left' | 'removed' | 'banned';
  join_answers: Record<string, unknown> | null;
  joined_at: string | null;
  created_at: string;
  name: string | null;
  photo_url: string | null;
}

export async function getCommunityMembers(communityId: string): Promise<CommunityMemberRow[]> {
  const { data, error } = await supabase
    .from('community_members')
    .select('id, user_id, role, status, join_answers, joined_at, created_at')
    .eq('community_id', communityId)
    .in('status', ['pending', 'active'])
    .order('created_at', { ascending: false });
  if (error) throw error;
  const rows = data ?? [];
  if (rows.length === 0) return [];

  const ids = Array.from(new Set(rows.map((r) => r.user_id)));
  const { data: profiles } = await supabase
    .from('profiles_public')
    .select('id, first_name_display, profile_photo_url')
    .in('id', ids);
  const byId = new Map((profiles ?? []).map((p: any) => [p.id, p]));

  return rows.map((r) => ({
    ...r,
    name: byId.get(r.user_id)?.first_name_display ?? null,
    photo_url: byId.get(r.user_id)?.profile_photo_url ?? null,
  })) as CommunityMemberRow[];
}

/**
 * Approve or decline a pending join request. Leader-only by RLS.
 * Decline sets 'removed' for now; whether a declined person can re-request
 * is an open phase 3 question (the unique row currently blocks a second
 * request).
 */
export async function reviewJoinRequest(memberRowId: string, approve: boolean): Promise<void> {
  const patch = approve
    ? { status: 'active', joined_at: new Date().toISOString() }
    : { status: 'removed' };
  const { error, count } = await supabase
    .from('community_members')
    .update(patch, { count: 'exact' })
    .eq('id', memberRowId)
    .eq('status', 'pending');
  if (error) throw error;
  if (!count) throw new Error('That request is gone or already handled.');
}

/** Remove an active member (leader-only by RLS). */
export async function removeMember(memberRowId: string): Promise<void> {
  const { error, count } = await supabase
    .from('community_members')
    .update({ status: 'removed', role: 'member' }, { count: 'exact' })
    .eq('id', memberRowId)
    .eq('status', 'active')
    .eq('role', 'member'); // guard: never remove a leader row this way
  if (error) throw error;
  if (!count) throw new Error('Could not remove that member.');
}

// -- broadcasts ---------------------------------------------------------------

export interface BroadcastRow {
  id: string;
  body: string;
  pinned: boolean;
  created_at: string;
}

export async function getBroadcasts(communityId: string): Promise<BroadcastRow[]> {
  const { data, error } = await supabase
    .from('community_broadcasts')
    .select('id, body, pinned, created_at')
    .eq('community_id', communityId)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw error;
  return (data ?? []) as BroadcastRow[];
}

export async function sendBroadcast(communityId: string, body: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const { error } = await supabase.from('community_broadcasts').insert({
    community_id: communityId,
    sender_id: user.id,
    body: body.trim(),
  });
  if (error) throw error;
}

// -- events (read-only this slice) --------------------------------------------

export interface CommunityEventRow {
  id: string;
  title: string;
  event_date: string | null;
  venue: string | null;
  status: string;
  public_name: string | null;
}

/**
 * Live events attributed to the community or to the creator personally.
 * NOTE (phase 5 gap, logged): explore_events RLS only exposes status='Live'
 * to non-admins, so an operator cannot yet see their own drafts or past
 * events. Owner-read policy + operator create/edit RPCs ride phase 5.
 */
export async function getCreatorEvents(
  communityIds: string[],
  userId: string,
): Promise<CommunityEventRow[]> {
  const ors: string[] = [`host_user_id.eq.${userId}`];
  if (communityIds.length > 0) ors.push(`community_id.in.(${communityIds.join(',')})`);
  const { data, error } = await supabase
    .from('explore_events')
    .select('id, title, event_date, venue, status, public_name')
    .or(ors.join(','))
    .order('event_date', { ascending: true });
  if (error) throw error;
  return (data ?? []) as CommunityEventRow[];
}
