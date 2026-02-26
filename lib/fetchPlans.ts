import { supabase } from './supabase';

export interface Plan {
  id: string;
  title: string;
  start_time: string;
  location_text: string | null;
  location_lat: number | null;
  location_lng: number | null;
  // Aliases for map component compatibility
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
  host: {
    id: string;
    first_name: string | null;
    avatar_url: string | null;
  } | null;
}

// All ghost protocol filtering (gender, age, blocked users) is handled server-side by the RPC.
export async function fetchPlans(userId: string): Promise<Plan[]> {
  const { data, error } = await supabase
    .rpc('get_filtered_feed', { p_user_id: userId });

  if (error) {
    console.error('[fetchPlans] RPC error:', error.code, '|', error.message);
    throw error;
  }

  // DEBUG — remove after confirming image issue
  if (data && data.length > 0) {
    console.log('[fetchPlans] RPC sample keys:', Object.keys(data[0]));
    console.log('[fetchPlans] RPC sample image_url:', data[0].image_url);
    console.log('[fetchPlans] RPC sample host:', JSON.stringify(data[0].host));
  }

  return (data ?? []).map((item: any) => ({
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
    host: item.host_id ? {
      id: item.host_id,
      first_name: item.host_name ?? null,
      avatar_url: item.host_photo ?? null,
    } : null,
  }));
}
