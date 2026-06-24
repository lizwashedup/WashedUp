import { supabase } from './supabase';
import type { Plan } from './fetchPlans';

// ─── Creator milestone marks ───────────────────────────────────────────────
// Shared module-level cache of creator milestone marks (slug/name/icon),
// keyed by creator user id. Populated by whichever surface fetches plans and
// reads back by toPlanCardPlan when building a card. Extracted from the feed
// so the My Plans surface (Yours tab) can populate + read the same cache.
//
// The public feed deliberately does NOT populate this anymore. A reliable
// creator track-record signal on the feed is a separate (WS-5) item with its
// own approved copy. When the map has no entry for a creator, toPlanCardPlan
// returns null marks and PlanCard renders no badge (clean no-op).
const _creatorMarksMap: Record<string, { slug: string; name: string; icon: string }> = {};

/**
 * Fetch creator milestone marks for the given creator ids and merge them into
 * the shared cache. Best-effort: failures leave the cache untouched (cards
 * simply render without a badge). Callers should pass a de-duped id list.
 */
export async function populateCreatorMarks(creatorIds: string[]): Promise<void> {
  if (creatorIds.length === 0) return;
  const { data: marksData } = await supabase.rpc('get_creator_milestone_marks', {
    p_user_ids: creatorIds,
  });
  if (marksData) {
    (marksData as any[]).forEach((m: any) => {
      _creatorMarksMap[m.user_id] = { slug: m.mark_slug, name: m.mark_name, icon: m.mark_icon_name };
    });
  }
}

// Plan shape expected by PlanCard (person-first).
export interface PlanCardPlan {
  id: string;
  title: string;
  host_message: string | null;
  start_time: string;
  location_text: string | null;
  neighborhood: string | null;
  slug: string | null;
  category: string | null;
  gender_rule?: string | null;
  max_invites: number;
  member_count: number;
  is_featured?: boolean;
  featured_type?: 'washedup_event' | 'birthday_party' | null;
  allow_duplicate?: boolean;
  creator: {
    id: string;
    first_name_display: string;
    profile_photo_url: string | null;
    member_since?: string;
    plans_posted?: number;
    milestone_slug?: string | null;
    milestone_name?: string | null;
    milestone_icon?: string | null;
  };
}

export function toPlanCardPlan(plan: Plan): PlanCardPlan {
  const mark = _creatorMarksMap[plan.creator?.id ?? ''];
  return {
    id: plan.id,
    title: plan.title,
    host_message: plan.host_message ?? null,
    start_time: plan.start_time,
    location_text: plan.location_text ?? null,
    neighborhood: plan.neighborhood ?? null,
    slug: plan.slug ?? null,
    category: plan.category ?? null,
    gender_rule: plan.gender_rule ?? null,
    max_invites: plan.max_invites ?? 0,
    member_count: plan.member_count ?? 0,
    is_featured: plan.is_featured ?? false,
    featured_type: plan.featured_type ?? null,
    allow_duplicate: plan.allow_duplicate ?? true,
    creator: {
      id: plan.creator?.id ?? '',
      first_name_display: plan.creator?.first_name_display ?? 'Creator',
      profile_photo_url: plan.creator?.profile_photo_url ?? null,
      plans_posted: plan.creator?.plans_posted ?? undefined,
      milestone_slug: mark?.slug ?? null,
      milestone_name: mark?.name ?? null,
      milestone_icon: mark?.icon ?? null,
    },
  };
}
