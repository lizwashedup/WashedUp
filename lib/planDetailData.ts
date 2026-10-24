import { supabase } from './supabase';

/** Existing plan-detail reads and response mapping. Query keys, account scope,
 * query enablement and handle visibility remain with the screen. */
// ─── Types ────────────────────────────────────────────────────────────────────

export interface PlanDetail {
  id: string;
  title: string;
  description: string | null;
  host_message: string | null;
  start_time: string;
  location_text: string | null;
  location_lat: number | null;
  location_lng: number | null;
  image_url: string | null;
  primary_vibe: string | null;
  gender_rule: string | null;
  max_invites: number | null;
  min_invites: number | null;
  target_age_min: number | null;
  target_age_max: number | null;
  end_time: string | null;
  drop_in: boolean;
  allow_duplicate: boolean;
  neighborhood: string | null;
  slug: string | null;
  status: string;
  creator_user_id: string;
  tickets_url: string | null;
  is_featured: boolean;
  featured_type: 'washedup_event' | 'birthday_party' | 'special_event' | null;
  explore_event_id: string | null;
  circle_id?: string | null;
  creator: {
    id: string;
    first_name_display: string | null;
    profile_photo_url: string | null;
    bio: string | null;
  } | null;
  member_count: number;
}

export interface Member {
  id: string;
  user_id: string;
  first_name_display: string | null;
  profile_photo_url: string | null;
  joined_at: string;
  handle?: string | null;
}

// ─── Data Fetching ────────────────────────────────────────────────────────────

export async function fetchPlanDetail(id: string): Promise<PlanDetail> {
  const { data, error } = await supabase
    .from('events')
    .select(`
      id, title, description, host_message, start_time, end_time, drop_in, allow_duplicate,
      location_text, location_lat, location_lng,
      image_url, primary_vibe, gender_rule,
      max_invites, min_invites, target_age_min, target_age_max,
      status, member_count, creator_user_id, tickets_url, neighborhood, slug, is_featured, featured_type,
      explore_event_id, circle_id
    `)
    .eq('id', id)
    .single();

  if (error) throw error;

  const row = data as any;

  // Fetch creator via profiles_public view (bypasses profiles RLS for other users)
  let creator: PlanDetail['creator'] = null;
  if (row.creator_user_id) {
    const { data: profileRow } = await supabase
      .from('profiles_public')
      .select('id, first_name_display, profile_photo_url, bio')
      .eq('id', row.creator_user_id)
      .maybeSingle();

    if (profileRow) {
      creator = {
        id: profileRow.id,
        first_name_display: profileRow.first_name_display ?? null,
        profile_photo_url: profileRow.profile_photo_url ?? null,
        bio: profileRow.bio ?? null,
      };
    }
  }

  return {
    id: row.id,
    title: row.title,
    description: row.description ?? null,
    host_message: row.host_message ?? null,
    start_time: row.start_time,
    end_time: row.end_time ?? null,
    drop_in: row.drop_in ?? true,
    allow_duplicate: row.allow_duplicate ?? true,
    location_text: row.location_text ?? null,
    location_lat: row.location_lat ?? null,
    location_lng: row.location_lng ?? null,
    image_url: row.image_url ?? null,
    primary_vibe: row.primary_vibe ?? null,
    gender_rule: row.gender_rule ?? null,
    max_invites: row.max_invites ?? null,
    min_invites: row.min_invites ?? null,
    target_age_min: row.target_age_min ?? null,
    target_age_max: row.target_age_max ?? null,
    neighborhood: row.neighborhood ?? null,
    slug: row.slug ?? null,
    status: row.status,
    creator_user_id: row.creator_user_id ?? null,
    tickets_url: row.tickets_url ?? null,
    is_featured: row.is_featured ?? false,
    featured_type: (row.featured_type as 'washedup_event' | 'birthday_party' | null) ?? null,
    explore_event_id: row.explore_event_id ?? null,
    circle_id: row.circle_id,
    member_count: row.member_count ?? 0,
    creator,
  };
}

export async function fetchMembers(planId: string): Promise<Member[]> {
  const { data: rpcData, error: rpcError } = await supabase
    .rpc('get_event_members_reveal', { p_event_id: planId });

  if (!rpcError && rpcData && Array.isArray(rpcData)) {
    return rpcData.map((row: any) => ({
      id: row.id,
      user_id: row.user_id,
      first_name_display: row.first_name ?? row.first_name_display ?? null,
      profile_photo_url: row.avatar_url ?? row.profile_photo_url ?? null,
      joined_at: row.joined_at ?? '',
      handle: row.handle ?? null,
    }));
  }

  // Fallback: get_event_members_reveal requires membership and throws for a
  // non-member viewer (most viewers of a plan they haven't joined yet), which
  // is how we land here. get_event_members_public has no membership gate by
  // design — see 20260824200000_get_event_members_public_reveal_for_nonmembers.sql.
  const { data: publicRows, error: publicError } = await supabase
    .rpc('get_event_members_public', { p_event_id: planId });

  if (publicError) throw publicError;
  if (!publicRows || publicRows.length === 0) return [];

  return publicRows.map((row: any) => ({
    id: row.id,
    user_id: row.user_id,
    first_name_display: row.first_name_display ?? null,
    profile_photo_url: row.profile_photo_url ?? null,
    joined_at: row.joined_at ?? '',
    handle: row.handle ?? null,
  }));
}
