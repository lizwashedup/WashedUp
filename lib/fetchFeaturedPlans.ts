import { supabase } from './supabase';
import { fetchRealMemberCounts } from './fetchPlans';
import type { PlanCardPlan } from './creatorMarks';
import { isPlanPast } from './planTime';

export interface FeaturedPlan extends PlanCardPlan {
  attendees: { profile_photo_url: string | null }[];
}

/** Preserve eligibility checks; request failures must remain retryable errors. */
export async function fetchFeaturedPlans(userId: string): Promise<FeaturedPlan[]> {
  if (!userId) return [];

  // Visibility filtering (gender / age / mutual_blocks) happens in the
  // RPC. Without this, the featured carousel would leak plans to users
  // who shouldn't see them (e.g. a man seeing a women_only plan).
  const { data: eligibleIdsRaw, error: eligErr } = await supabase
    .rpc('get_featured_eligible_ids', { p_user_id: userId });
  if (eligErr) {
    throw new Error(eligErr.message ?? 'Could not load featured eligibility');
  }
  const eligibleIds = (eligibleIdsRaw ?? []) as string[];
  if (eligibleIds.length === 0) return [];

  const { data: events, error } = await supabase
    .from('events')
    .select('id, title, start_time, end_time, location_text, location_lat, location_lng, image_url, primary_vibe, gender_rule, target_age_min, target_age_max, max_invites, min_invites, member_count, status, creator_user_id, host_message, slug, is_featured, featured_type')
    .in('id', eligibleIds)
    .order('start_time', { ascending: true });

  if (error) throw new Error(error.message ?? 'Could not load featured plans');
  if (!events || events.length === 0) return [];

  const creatorIds = [...new Set(events.map((e: any) => e.creator_user_id).filter(Boolean))];
  const eventIds = events.map((e: any) => e.id);

  const [{ data: profiles }, { data: members }, realCounts] = await Promise.all([
    creatorIds.length > 0
      ? supabase.from('profiles_public').select('id, first_name_display, profile_photo_url').in('id', creatorIds)
      : Promise.resolve({ data: [] as any[] }),
    supabase.from('event_members').select('event_id, user_id, status').in('event_id', eventIds).eq('status', 'joined'),
    fetchRealMemberCounts(eventIds),
  ]);

  const profileMap: Record<string, any> = {};
  (profiles ?? []).forEach((p: any) => { profileMap[p.id] = p; });

  // Gather member user IDs per event for avatar fetch
  const membersByEvent: Record<string, string[]> = {};
  (members ?? []).forEach((m: any) => {
    if (!membersByEvent[m.event_id]) membersByEvent[m.event_id] = [];
    membersByEvent[m.event_id].push(m.user_id);
  });

  const allMemberIds = [...new Set((members ?? []).map((m: any) => m.user_id))];
  const { data: memberProfiles } = allMemberIds.length > 0
    ? await supabase.from('profiles_public').select('id, profile_photo_url').in('id', allMemberIds)
    : { data: [] as any[] };

  const memberPhotoMap: Record<string, string | null> = {};
  (memberProfiles ?? []).forEach((p: any) => { memberPhotoMap[p.id] = p.profile_photo_url ?? null; });

  return events
    .filter((e: any) => !isPlanPast(e.start_time, e.end_time))
    .map((e: any) => {
    const hp = profileMap[e.creator_user_id] ?? null;
    const eventMembers = membersByEvent[e.id] ?? [];
    return {
      id: e.id,
      title: e.title,
      host_message: e.host_message ?? null,
      gender_rule: e.gender_rule ?? null,
      target_age_min: e.target_age_min,
      target_age_max: e.target_age_max,
      start_time: e.start_time,
      end_time: e.end_time ?? null,
      status: e.status,
      location_text: e.location_text ?? null,
      neighborhood: null,
      category: e.primary_vibe ?? null,
      max_invites: e.max_invites ?? 0,
      member_count: Math.max(1, realCounts[e.id] ?? e.member_count ?? 0),
      slug: e.slug ?? null,
      is_featured: true,
      featured_type: (e.featured_type as 'washedup_event' | 'birthday_party' | 'special_event' | null) ?? null,
      creator: {
        id: e.creator_user_id,
        first_name_display: hp?.first_name_display ?? 'Creator',
        profile_photo_url: hp?.profile_photo_url ?? null,
      },
      attendees: eventMembers.map((uid: string) => ({
        profile_photo_url: memberPhotoMap[uid] ?? null,
      })),
    } as FeaturedPlan;
  });
}
