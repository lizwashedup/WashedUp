import { supabase } from './supabase';

export interface Plan {
  id: string;
  title: string;
  start_time: string;
  location_text: string | null;
  location_lat: number | null;
  location_lng: number | null;
  latitude: number | null;
  longitude: number | null;
  image_url: string | null;
  category: string | null;
  gender_rule: string | null;
  max_invites: number | null;
  min_invites: number | null;
  member_count: number;
  status: string;
  host_message: string | null;
  creator: {
    id: string;
    first_name: string | null;
    avatar_url: string | null;
  } | null;
}

function mapRowToPlan(item: any): Plan {
  return {
    id: item.id,
    title: item.title,
    start_time: item.start_time,
    location_text: item.location_text ?? null,
    location_lat: item.location_lat ?? null,
    location_lng: item.location_lng ?? null,
    latitude: item.location_lat ?? null,
    longitude: item.location_lng ?? null,
    image_url: item.image_url ?? null,
    category: item.primary_vibe ?? null,
    gender_rule: item.gender_rule ?? null,
    max_invites: item.max_invites ?? null,
    min_invites: item.min_invites ?? null,
    member_count: item.member_count ?? 0,
    status: item.status ?? 'forming',
    host_message: item.host_message ?? null,
    creator: (item.creator_user_id ?? item.host_id)
      ? {
          id: item.creator_user_id ?? item.host_id,
          first_name: item.creator_name ?? item.host_name ?? item.first_name_display ?? null,
          avatar_url: item.creator_photo ?? item.host_photo ?? item.profile_photo_url ?? null,
        }
      : null,
  };
}

async function fetchPlansFallback(_userId: string): Promise<Plan[]> {
  try {
    const { data: rows, error } = await supabase
      .from('events')
      .select('id, title, start_time, location_text, location_lat, location_lng, image_url, primary_vibe, gender_rule, max_invites, min_invites, member_count, status, host_message, creator_user_id')
      .in('status', ['forming', 'active', 'full'])
      .gte('start_time', new Date().toISOString())
      .order('start_time', { ascending: true });

    if (error) return [];
    if (!rows?.length) return [];

    const creatorIds = [...new Set(rows.map((r: any) => r.creator_user_id).filter(Boolean))];
    const profileMap: Record<string, { first_name_display: string | null; profile_photo_url: string | null }> = {};
    if (creatorIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles_public')
        .select('id, first_name_display, profile_photo_url')
        .in('id', creatorIds);
      (profiles ?? []).forEach((p: any) => { profileMap[p.id] = p; });
    }

    return rows.map((r: any) => {
      const p = profileMap[r.creator_user_id];
      return mapRowToPlan({
        ...r,
        creator_name: p?.first_name_display ?? null,
        creator_photo: p?.profile_photo_url ?? null,
      });
    });
  } catch {
    return [];
  }
}

export async function fetchPlans(userId: string): Promise<Plan[]> {
  if (!userId) return [];

  try {
    const { data, error } = await supabase.rpc('get_filtered_feed', {
      p_user_id: userId,
    });

    if (!error && data != null) {
      return (Array.isArray(data) ? data : []).map((item: any) => mapRowToPlan(item));
    }

    return fetchPlansFallback(userId);
  } catch {
    return fetchPlansFallback(userId);
  }
}
