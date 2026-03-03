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
    plans_posted?: number;
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

export async function fetchPlans(userId: string): Promise<Plan[]> {
  if (!userId) return [];

  const { data, error } = await supabase.rpc('get_filtered_feed', {
    p_user_id: userId,
  });

  if (error) {
    console.warn('[fetchPlans] RPC failed:', error.message);
    throw new Error(error.message ?? 'Failed to load plans');
  }

  const plans = (Array.isArray(data) ? data : []).map((item: any) => mapRowToPlan(item));
  if (plans.length === 0) return plans;

  // Override member_count with actual count from event_members — DB trigger can be out of sync
  const planIds = plans.map((p) => p.id);
  const { data: memberRows } = await supabase
    .from('event_members')
    .select('event_id')
    .in('event_id', planIds)
    .eq('status', 'joined');

  const countByEvent: Record<string, number> = {};
  (memberRows ?? []).forEach((r: { event_id: string }) => {
    countByEvent[r.event_id] = (countByEvent[r.event_id] ?? 0) + 1;
  });

  const withCounts = plans.map((p) => ({
    ...p,
    member_count: countByEvent[p.id] ?? p.member_count,
  }));

  // Enrich creator with plan count
  const creatorIds = [...new Set(withCounts.map((p) => p.creator?.id).filter(Boolean))] as string[];
  if (creatorIds.length > 0) {
    const { data: creatorEvents } = await supabase
      .from('events')
      .select('creator_user_id')
      .in('creator_user_id', creatorIds);

    const planCountByCreator: Record<string, number> = {};
    (creatorEvents ?? []).forEach((e: { creator_user_id: string }) => {
      planCountByCreator[e.creator_user_id] = (planCountByCreator[e.creator_user_id] ?? 0) + 1;
    });

    return withCounts.map((p) => ({
      ...p,
      creator: p.creator
        ? { ...p.creator, plans_posted: planCountByCreator[p.creator.id] ?? 0 }
        : null,
    }));
  }

  return withCounts;
}
