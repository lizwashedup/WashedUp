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

  const [{ data: profiles }, realCounts] = await Promise.all([
    creatorIds.length > 0
      ? supabase.from('profiles_public').select('id, first_name_display, profile_photo_url').in('id', creatorIds)
      : Promise.resolve({ data: [] as any[] }),
    fetchRealMemberCounts(eventIds),
  ]);

  const profileMap: Record<string, any> = {};
  (profiles ?? []).forEach((p: any) => { profileMap[p.id] = p; });

  // Direct event_members reads are member-only under RLS. Featured viewers
  // usually have not joined: use the same privacy-filtered public roster as
  // plan details, so a real group never looks empty to an eligible outsider.
  const attendeesByEvent: Record<string, { profile_photo_url: string | null }[]> = {};
  // Bound concurrent roster reads even if the featured list grows.
  for (let offset = 0; offset < eventIds.length; offset += 8) {
    await Promise.all(eventIds.slice(offset, offset + 8).map(async eventId => {
      const { data: members, error: memberError } = await supabase
        .rpc('get_event_members_public', { p_event_id: eventId });
      if (memberError) throw new Error(memberError.message ?? 'Could not load featured members');
      attendeesByEvent[eventId] = (members ?? []).map((member: { profile_photo_url?: string | null }) => ({
        profile_photo_url: member.profile_photo_url ?? null,
      }));
    }));
  }

  return events
    .filter((e: any) => !isPlanPast(e.start_time, e.end_time))
    .map((e: any) => {
    const hp = profileMap[e.creator_user_id] ?? null;
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
      featured_type: (e.featured_type as 'washedup_event' | 'birthday_party' | 'special_event' | 'plan_in_making' | null) ?? null,
      creator: {
        id: e.creator_user_id,
        first_name_display: hp?.first_name_display ?? 'Creator',
        profile_photo_url: hp?.profile_photo_url ?? null,
      },
      attendees: attendeesByEvent[e.id] ?? [],
    } as FeaturedPlan;
  });
}
