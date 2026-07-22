/**
 * The member-facing community page (doc 09: one block tree, three
 * projections). This is the RN app-home projection; the web twin lives in
 * washedup-web src/lib/communities/data.ts and the block content shapes are
 * a shared contract with lib/communityBlocks.ts. RLS drives what comes
 * back: visible blocks of active communities are world-readable; the LOCK
 * VIEW subset for non-members (cover, header, about, member count, next
 * event, join) is app logic here, matching web.
 */

import { supabase } from './supabase';
import type { CommunityBlock } from './communityBlocks';

export interface CommunityPageCommunity {
  id: string;
  handle: string;
  name: string;
  description: string | null;
  accent_color: string | null;
  status: 'draft' | 'active' | 'archived';
}

export interface CommunityPageEvent {
  id: string;
  title: string;
  event_date: string | null;
  venue: string | null;
  image_url: string | null;
  // category picks the generated-poster ground when there is no photo
  category: string | null;
  ticket_price: number | null;
  public_name: string | null;
}

export interface CommunityPageData {
  community: CommunityPageCommunity;
  blocks: CommunityBlock[];
  events: CommunityPageEvent[];
  memberCount: number | null;
}

export async function getCommunityPage(communityId: string): Promise<CommunityPageData | null> {
  const { data: community, error } = await supabase
    .from('communities')
    .select('id, handle, name, description, accent_color, status')
    .eq('id', communityId)
    .maybeSingle();
  if (error) throw error;
  if (!community) return null;

  const [{ data: blocks }, { data: events }, { data: memberCount }] = await Promise.all([
    supabase
      .from('community_blocks')
      .select('id, community_id, block_type, position, visible, content')
      .eq('community_id', communityId)
      .eq('visible', true)
      .order('position', { ascending: true }),
    supabase
      .from('explore_events')
      .select('id, title, event_date, venue, image_url, category, ticket_price, public_name')
      .eq('community_id', communityId)
      .eq('status', 'Live')
      .order('event_date', { ascending: true })
      .limit(6),
    supabase.rpc('get_community_member_count', { p_community_id: communityId }),
  ]);

  return {
    community: community as CommunityPageCommunity,
    blocks: (blocks ?? []) as CommunityBlock[],
    events: (events ?? []) as CommunityPageEvent[],
    memberCount: typeof memberCount === 'number' ? memberCount : null,
  };
}

// -- Yours: my communities (decision 7: communities get a page on Yours) --------

export interface MyCommunity {
  id: string;
  handle: string;
  name: string;
  accent_color: string | null;
  role: 'leader' | 'co_leader' | 'member';
  cover_image: string | null;
  member_count: number | null;
}

export async function getMyCommunities(): Promise<MyCommunity[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data: rows, error } = await supabase
    .from('community_members')
    .select('role, communities ( id, handle, name, accent_color, status )')
    .eq('user_id', user.id)
    .eq('status', 'active');
  if (error) throw error;
  const memberships = (rows ?? [])
    .map((r: any) => ({ role: r.role, c: r.communities }))
    .filter((r: any) => r.c && r.c.status === 'active');
  if (memberships.length === 0) return [];

  const ids = memberships.map((m: any) => m.c.id);
  const [{ data: covers }, counts] = await Promise.all([
    supabase
      .from('community_blocks')
      .select('community_id, content, position')
      .in('community_id', ids)
      .eq('block_type', 'cover')
      .eq('visible', true)
      .order('position', { ascending: true }),
    Promise.all(
      ids.map((cid: string) =>
        supabase
          .rpc('get_community_member_count', { p_community_id: cid })
          .then(({ data }) => [cid, typeof data === 'number' ? data : null] as const),
      ),
    ),
  ]);
  const coverById = new Map<string, string>();
  for (const b of (covers ?? []) as any[]) {
    const first = Array.isArray(b.content?.images) ? b.content.images[0] : null;
    if (first && !coverById.has(b.community_id)) coverById.set(b.community_id, first);
  }
  const countById = new Map(counts);

  return memberships.map((m: any) => ({
    id: m.c.id,
    handle: m.c.handle,
    name: m.c.name,
    accent_color: m.c.accent_color ?? null,
    role: m.role,
    cover_image: coverById.get(m.c.id) ?? null,
    member_count: countById.get(m.c.id) ?? null,
  }));
}

/** A handful of member faces for the members_auto block (active only). */
export async function getMemberFaces(
  communityId: string,
): Promise<{ id: string; name: string | null; photo: string | null }[]> {
  const { data: members } = await supabase
    .from('community_members')
    .select('user_id')
    .eq('community_id', communityId)
    .eq('status', 'active')
    .limit(12);
  const ids = (members ?? []).map((m: any) => m.user_id);
  if (ids.length === 0) return [];
  const { data: profiles } = await supabase
    .from('profiles_public')
    .select('id, first_name_display, profile_photo_url')
    .in('id', ids);
  return (profiles ?? []).map((p: any) => ({
    id: p.id,
    name: p.first_name_display ?? null,
    photo: p.profile_photo_url ?? null,
  }));
}
