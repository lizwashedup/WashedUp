/**
 * O-03: follower communication. A broadcast to a community's or standalone
 * organizer's FOLLOWERS (proposal 68 organizer_follows) -- never its
 * members, never email/SMS (no provider configured). Native sends
 * immediately only; scheduling is web-only (see washedup-web's mirror of
 * this file).
 */

import { supabase } from './supabase';

export interface FollowerBroadcast {
  id: string;
  senderUserId: string;
  communityId: string | null;
  organizerUserId: string | null;
  body: string;
  visibleAt: string;
  createdAt: string;
}

interface Row {
  id: string;
  sender_user_id: string;
  community_id: string | null;
  organizer_user_id: string | null;
  body: string;
  visible_at: string;
  created_at: string;
}

function mapRow(r: Row): FollowerBroadcast {
  return {
    id: r.id,
    senderUserId: r.sender_user_id,
    communityId: r.community_id,
    organizerUserId: r.organizer_user_id,
    body: r.body,
    visibleAt: r.visible_at,
    createdAt: r.created_at,
  };
}

const SELECT_COLS = 'id, sender_user_id, community_id, organizer_user_id, body, visible_at, created_at';

/**
 * C-15: best-effort real push via the existing OneSignal pipeline
 * (app_notifications -> claim_pending_push_notifications ->
 * send-push-notifications). Swallows its own failure -- the broadcast row
 * itself is already committed by the time this runs, so a missing RPC (the
 * fanout migration not applied yet, "self-flipping" like every other
 * undeployed-schema feature in this codebase) or a transient error must
 * never surface as a failed send to the sender.
 */
async function fanoutPushBestEffort(broadcastId: string): Promise<void> {
  try {
    await supabase.rpc('fanout_follower_broadcast_push', { p_broadcast_id: broadcastId });
  } catch {
    // best effort; the in-app row (readable via follower_broadcasts RLS) already shipped
  }
}

/** Native: quick, immediate send only (visible_at always defaults to now()). */
export async function sendFollowerBroadcast(
  target: { kind: 'organizer' } | { kind: 'community'; communityId: string },
  body: string,
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const trimmed = body.trim();
  if (!trimmed) throw new Error('Message is empty');
  if (trimmed.length > 2000) throw new Error('Message is too long');

  const { data, error } = await supabase
    .from('follower_broadcasts')
    .insert({
      sender_user_id: user.id,
      organizer_user_id: target.kind === 'organizer' ? user.id : null,
      community_id: target.kind === 'community' ? target.communityId : null,
      body: trimmed,
    })
    .select('id')
    .single();
  if (error) throw error;
  // native is always an immediate send (no scheduling), so push fans out now
  if (data?.id) await fanoutPushBestEffort(data.id);
}

/** My own sent history (sender always sees everything they sent, RLS-enforced). */
export async function getMyFollowerBroadcastHistory(
  target: { kind: 'organizer' } | { kind: 'community'; communityId: string },
): Promise<FollowerBroadcast[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  let q = supabase.from('follower_broadcasts').select(SELECT_COLS).eq('sender_user_id', user.id);
  q = target.kind === 'organizer' ? q.eq('organizer_user_id', user.id) : q.eq('community_id', target.communityId);
  const { data, error } = await q.order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapRow);
}
