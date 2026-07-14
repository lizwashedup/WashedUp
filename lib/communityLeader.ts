/**
 * The leader card (proposal 41, the people-first pack's server piece):
 * display name + avatar for the PRIMARY leader of ACTIVE communities,
 * resolved live from her main profile (one identity, never a second
 * upload, no snapshots — a changed profile picture propagates everywhere).
 *
 * World-callable definer read because strangers cannot resolve who leads
 * a community under row RLS, and "who is behind it" is the trust question
 * a stranger at the door is asking. Until proposal 41 applies, this
 * resolves to an empty map on any error and every face simply does not
 * render (graceful degrade, the house pattern).
 */

import { supabase } from './supabase';

export interface LeaderCard {
  community_id: string;
  display_name: string | null;
  avatar_url: string | null;
}

export async function getLeaderCards(communityIds: (string | null | undefined)[]): Promise<Map<string, LeaderCard>> {
  const ids = Array.from(new Set(communityIds.filter(Boolean))) as string[];
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase.rpc('get_community_leader_cards', {
    p_community_ids: ids,
  });
  if (error) return new Map();
  return new Map(((data ?? []) as LeaderCard[]).map((c) => [c.community_id, c]));
}
