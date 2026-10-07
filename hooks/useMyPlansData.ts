import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { COMMUNITIES_ENABLED, GROUPS_ENABLED } from '../constants/FeatureFlags';
import { fetchInterestedPlans, fetchRealMemberCounts, type Plan } from '../lib/fetchPlans';
import { populateCreatorMarks } from '../lib/creatorMarks';
import { requestWithDeadline } from '../lib/requestWithDeadline';

// These hooks hold the personal-plans data that used to live inline on the
// public feed (app/(tabs)/plans/index.tsx). Moved verbatim so the My Plans
// surface (Yours tab) owns them and the feed stays pure discovery. queryKeys
// are unchanged where they existed before so react-query cache carries over.

const MY_PLANS_TIMEOUT_MS = 12000;
const SAVED_TIMEOUT_MS = 8000;
const CIRCLE_COLUMNS = GROUPS_ENABLED ? ', circle_id, circle_visibility, stranger_cap' : '';

// Personal collections know provenance, but do not return outsider availability.
// Leave it unknown until the plan detail loads its current Circle context.
function circleFields(event: any): Pick<Plan, 'circle_id' | 'circle_visibility' | 'stranger_cap' | 'circle_metadata_known' | 'spots_remaining'> {
  return {
    circle_id: event.circle_id,
    circle_visibility: event.circle_visibility,
    stranger_cap: event.stranger_cap,
    circle_metadata_known: !GROUPS_ENABLED || event.circle_id === null || (typeof event.circle_id === 'string' && event.circle_id.trim().length > 0),
    spots_remaining: null,
  };
}

/** The creator's saved plan drafts (status 'draft': composer-only, never on the feed). */
export interface PlanDraft {
  id: string;
  title: string;
  start_time: string;
  end_time: string | null;
  description: string | null;
  host_message: string | null;
  location_text: string | null;
  location_lat: number | null;
  location_lng: number | null;
  neighborhood: string | null;
  primary_vibe: string | null;
  image_url: string | null;
  gender_rule: string | null;
  target_age_min: number | null;
  target_age_max: number | null;
  max_invites: number | null;
  tickets_url: string | null;
  drop_in: boolean | null;
  allow_duplicate: boolean | null;
  explore_event_id: string | null;
}

export function useMyPlanDrafts(userId: string | null | undefined) {
  return useQuery<PlanDraft[]>({
    queryKey: ['my-plan-drafts', userId],
    queryFn: () => requestWithDeadline((async () => {
      if (!userId) return [];
      const { data, error } = await supabase
        .from('events')
        .select('id, title, start_time, end_time, description, host_message, location_text, location_lat, location_lng, neighborhood, primary_vibe, image_url, gender_rule, target_age_min, target_age_max, max_invites, tickets_url, drop_in, allow_duplicate, explore_event_id')
        .eq('creator_user_id', userId)
        .eq('status', 'draft')
        .order('start_time', { ascending: true });
      if (error) throw error;
      return (data ?? []) as PlanDraft[];
    })(), MY_PLANS_TIMEOUT_MS),
    retry: false,
    enabled: !!userId && COMMUNITIES_ENABLED,
  });
}

/** Plans the user joined or created (excluding ones they left), upcoming + past. */
export function useMyPlans(userId: string | null | undefined) {
  return useQuery<Plan[]>({
    queryKey: ['my-plans', userId],
    // Whole multi-step body bounded so a stuck sub-request can't pin the gate.
    queryFn: () => requestWithDeadline((async () => {
      if (!userId) return [];

      const { data: memberships, error: memError } = await supabase
        .from('event_members')
        .select(`
          event_id,
          events (
            id, title, start_time, end_time, location_text, location_lat, location_lng,
            image_url, primary_vibe, gender_rule, max_invites, min_invites,
            member_count, status, creator_user_id, host_message, neighborhood, slug,
            is_featured, featured_type${CIRCLE_COLUMNS}
          )
        `)
        .eq('user_id', userId)
        .eq('status', 'joined');

      if (memError) throw memError;

      const { data: created, error: createdError } = await supabase
        .from('events')
        .select('id, title, start_time, end_time, location_text, location_lat, location_lng, image_url, primary_vibe, gender_rule, max_invites, min_invites, member_count, status, creator_user_id, host_message, neighborhood, slug, is_featured, featured_type' + CIRCLE_COLUMNS)
        .eq('creator_user_id', userId)
        .in('status', ['forming', 'active', 'full', 'completed']);

      if (createdError) throw createdError;

      // Fetch event_ids the user has explicitly LEFT. The joined branch above
      // already filters status='joined', but the created branch pulls events
      // straight from the events table without checking member status, so a
      // creator who walks away from their own plan would still see it here.
      // We exclude any left events from the merged list below.
      const { data: leftRows, error: leftError } = await supabase
        .from('event_members')
        .select('event_id')
        .eq('user_id', userId)
        .eq('status', 'left');
      if (leftError) throw leftError;
      const leftEventIds = new Set((leftRows ?? []).map((r: any) => r.event_id as string));

      const joinedEvents = (memberships ?? [])
        .map((m: any) => m.events)
        .filter((e: any) => e && ['forming', 'active', 'full', 'completed'].includes(e.status));

      const seen: Record<string, boolean> = {};
      const allEvents: any[] = [];
      [...joinedEvents, ...(created ?? [])].forEach((e: any) => {
        if (e && !seen[e.id] && !leftEventIds.has(e.id)) {
          seen[e.id] = true;
          allEvents.push(e);
        }
      });

      if (!allEvents.length) return [];

      const creatorIds = allEvents.map((e: any) => e.creator_user_id).filter(Boolean);
      const uniqueCreatorIds = creatorIds.filter((id: string, i: number) => creatorIds.indexOf(id) === i);

      const { data: profilesData, error: profileError } = uniqueCreatorIds.length > 0
        ? await supabase.from('profiles_public').select('id, first_name_display, profile_photo_url').in('id', uniqueCreatorIds)
        : { data: [] as any[], error: null };

      if (profileError) throw profileError;
      const profileMap: Record<string, any> = {};
      (profilesData ?? []).forEach((p: any) => { profileMap[p.id] = p; });

      const realCounts = await fetchRealMemberCounts(allEvents.map((e: any) => e.id));

      // Fetch creator milestone marks into the shared cache (read by toPlanCardPlan).
      await populateCreatorMarks(uniqueCreatorIds);

      return allEvents.map((e: any) => {
        const hp = profileMap[e.creator_user_id] ?? null;
        return {
          ...circleFields(e),
          id: e.id,
          title: e.title,
          start_time: e.start_time,
          end_time: e.end_time ?? null,
          location_text: e.location_text ?? null,
          location_lat: e.location_lat ?? null,
          location_lng: e.location_lng ?? null,
          image_url: e.image_url ?? null,
          category: e.primary_vibe ?? null,
          gender_rule: e.gender_rule ?? null,
          max_invites: e.max_invites ?? null,
          min_invites: e.min_invites ?? null,
          member_count: Math.max(1, realCounts[e.id] ?? e.member_count ?? 0),
          status: e.status ?? 'forming',
          host_message: e.host_message ?? null,
          is_featured: e.is_featured ?? false,
          featured_type: (e.featured_type as 'washedup_event' | 'birthday_party' | null) ?? null,
          creator: hp ? { id: hp.id, first_name_display: hp.first_name_display ?? null, profile_photo_url: hp.profile_photo_url ?? null } : null,
        } as Plan;
      });
    })(), MY_PLANS_TIMEOUT_MS),
    retry: false,
    enabled: !!userId,
    staleTime: 10_000,
    // NOTE: no refetchOnMount:'always'. This is an expensive multi-step fetch
    // (joined+created events, dedup, profiles, member counts); forcing it on
    // every remount was a major contributor to the 2026-05-18 freeze/slowness
    // incident. staleTime still refreshes it shortly after it goes stale.
  });
}

/** Plans the user is waitlisted on (active/forming/full). */
export function useWaitlistedPlans(userId: string | null | undefined) {
  return useQuery<Plan[]>({
    queryKey: ['waitlisted-plans', userId],
    queryFn: () => requestWithDeadline((async () => {
      if (!userId) return [];

      // Step 1: get waitlisted event IDs (no FK on event_waitlist, so join won't work)
      const { data: waitlistRows, error: waitlistError } = await supabase
        .from('event_waitlist')
        .select('event_id')
        .eq('user_id', userId);

      if (waitlistError) throw waitlistError;
      const eventIds = (waitlistRows ?? []).map((w: any) => w.event_id as string);
      if (eventIds.length === 0) return [];

      // Step 2: fetch the actual events
      const { data: eventsData, error: eventsError } = await supabase
        .from('events')
        .select('id, title, start_time, end_time, location_text, location_lat, location_lng, image_url, primary_vibe, gender_rule, max_invites, min_invites, member_count, status, creator_user_id, host_message, neighborhood, slug' + CIRCLE_COLUMNS)
        .in('id', eventIds)
        .in('status', ['forming', 'active', 'full']);

      if (eventsError) throw eventsError;
      const active = eventsData ?? [];
      if (active.length === 0) return [];

      const creatorIds = [...new Set(active.map((e: any) => e.creator_user_id).filter(Boolean))] as string[];
      const { data: profiles, error: profileError } = creatorIds.length > 0
        ? await supabase.from('profiles_public').select('id, first_name_display, profile_photo_url').in('id', creatorIds)
        : { data: [] as any[], error: null };

      if (profileError) throw profileError;
      const profileMap: Record<string, any> = {};
      (profiles ?? []).forEach((p: any) => { profileMap[p.id] = p; });

      const realCounts = await fetchRealMemberCounts(active.map((e: any) => e.id));

      // Fetch creator milestone marks into the shared cache.
      await populateCreatorMarks(creatorIds);

      return active.map((e: any) => {
        const hp = profileMap[e.creator_user_id] ?? null;
        return {
          ...circleFields(e),
          id: e.id, title: e.title, start_time: e.start_time, end_time: e.end_time ?? null,
          location_text: e.location_text ?? null, location_lat: e.location_lat ?? null, location_lng: e.location_lng ?? null,
          image_url: e.image_url ?? null, category: e.primary_vibe ?? null, gender_rule: e.gender_rule ?? null,
          max_invites: e.max_invites ?? null, min_invites: e.min_invites ?? null,
          member_count: Math.max(1, realCounts[e.id] ?? e.member_count ?? 0), status: e.status ?? 'forming', host_message: e.host_message ?? null,
          creator: hp ? { id: hp.id, first_name_display: hp.first_name_display ?? null, profile_photo_url: hp.profile_photo_url ?? null } : null,
        } as Plan;
      });
    })(), MY_PLANS_TIMEOUT_MS),
    retry: false,
    enabled: !!userId,
    staleTime: 30_000,
  });
}

/** Plans the user marked interested ("I'd go next time"). */
export function useInterestedPlans(userId: string | null | undefined) {
  return useQuery<Plan[]>({
    queryKey: ['plans.myInterested', userId],
    queryFn: () => requestWithDeadline(fetchInterestedPlans({ throwOnError: true }), MY_PLANS_TIMEOUT_MS),
    retry: false,
    enabled: !!userId,
    staleTime: 60_000,
  });
}

/**
 * Plans the user has saved (wishlisted). Unlike the old feed behaviour (which
 * could only show saved plans that were ALSO in the current feed payload), this
 * fetches the saved events directly, so the Saved section is complete. The view
 * still filters the result by the live wishlist cache so optimistic un-save is
 * instant. Saved is a personal COLLECTION (not a discovery filter), so it
 * includes completed saves too (rendered past-style), newest-first; cancelled
 * events are excluded.
 */
export function useSavedPlans(userId: string | null | undefined) {
  return useQuery<Plan[]>({
    queryKey: ['saved-plans', userId],
    queryFn: () => requestWithDeadline((async () => {
      if (!userId) return [];

      const { data: wishlistRows, error: wishlistError } = await supabase
        .from('wishlists')
        .select('event_id')
        .eq('user_id', userId);

      if (wishlistError) throw wishlistError;
      const eventIds = (wishlistRows ?? []).map((w: any) => w.event_id as string);
      if (eventIds.length === 0) return [];

      const { data: eventsData, error: eventsError } = await supabase
        .from('events')
        .select('id, title, start_time, end_time, location_text, location_lat, location_lng, image_url, primary_vibe, gender_rule, max_invites, min_invites, member_count, status, creator_user_id, host_message, neighborhood, slug' + CIRCLE_COLUMNS)
        .in('id', eventIds)
        .in('status', ['forming', 'active', 'full', 'completed'])
        .order('start_time', { ascending: false });

      if (eventsError) throw eventsError;
      const active = eventsData ?? [];
      if (active.length === 0) return [];

      const creatorIds = [...new Set(active.map((e: any) => e.creator_user_id).filter(Boolean))] as string[];
      const { data: profiles, error: profileError } = creatorIds.length > 0
        ? await supabase.from('profiles_public').select('id, first_name_display, profile_photo_url').in('id', creatorIds)
        : { data: [] as any[], error: null };

      if (profileError) throw profileError;
      const profileMap: Record<string, any> = {};
      (profiles ?? []).forEach((p: any) => { profileMap[p.id] = p; });

      const realCounts = await fetchRealMemberCounts(active.map((e: any) => e.id));

      await populateCreatorMarks(creatorIds);

      return active.map((e: any) => {
        const hp = profileMap[e.creator_user_id] ?? null;
        return {
          ...circleFields(e),
          id: e.id, title: e.title, start_time: e.start_time, end_time: e.end_time ?? null,
          location_text: e.location_text ?? null, location_lat: e.location_lat ?? null, location_lng: e.location_lng ?? null,
          image_url: e.image_url ?? null, category: e.primary_vibe ?? null, gender_rule: e.gender_rule ?? null,
          max_invites: e.max_invites ?? null, min_invites: e.min_invites ?? null,
          member_count: Math.max(1, realCounts[e.id] ?? e.member_count ?? 0), status: e.status ?? 'forming', host_message: e.host_message ?? null,
          creator: hp ? { id: hp.id, first_name_display: hp.first_name_display ?? null, profile_photo_url: hp.profile_photo_url ?? null } : null,
        } as Plan;
      });
    })(), SAVED_TIMEOUT_MS),
    retry: false,
    enabled: !!userId,
    staleTime: 30_000,
  });
}
