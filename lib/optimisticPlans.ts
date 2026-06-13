import type { QueryClient } from '@tanstack/react-query';
import type { Plan } from './fetchPlans';

/**
 * Real React Query optimistic posting for the two plan composers.
 *
 * Both the feed (`['events','feed',userId]`) and "my plans"
 * (`['my-plans',userId]`) caches are typed `Plan[]` (see lib/fetchPlans.ts), so a
 * single builder feeds both. We prepend an optimistic `Plan` the instant a post is
 * submitted, swap its temporary id for the real one once the event + host member
 * rows have both committed, and restore the exact prior snapshot if the insert
 * fails. The composers' existing `invalidateQueries` calls act as the onSettled
 * reconcile: `get_filtered_feed` always returns the creator's own plan, so the
 * committed row converges to its true server shape with no duplicate.
 *
 * This module is purely additive: it never changes the composers' insert / member /
 * invite / recovery flow. It only manipulates the cache around it.
 */

/** Minimal creator face needed to render the optimistic card. */
export interface OptimisticCreator {
  id: string;
  first_name_display: string | null;
  profile_photo_url: string | null;
}

/**
 * The `row` each composer already builds for the `events` insert. Typed loosely so
 * both composers' row shapes fit without changing them; only a few fields are read.
 */
type EventInsertRow = Record<string, any>;

const TEMP_PREFIX = 'optimistic-';

/** True for an optimistic row that has not yet been committed to a real id. */
export function isOptimisticPlanId(id: string): boolean {
  return id.startsWith(TEMP_PREFIX);
}

/**
 * Map a composer's `events` insert row to the exact `Plan` shape `mapRowToPlan`
 * produces, so the optimistic card renders identically to a real feed card. The
 * creator auto-joins, so `member_count` is 1. Standalone plans only; every circle
 * field is null (circle plans go through a different create path).
 */
export function buildOptimisticPlan(
  row: EventInsertRow,
  userId: string,
  creator: OptimisticCreator | null,
): Plan {
  return {
    id: `${TEMP_PREFIX}${Date.now()}`,
    title: row.title ?? '',
    start_time: row.start_time,
    location_text: row.location_text ?? null,
    location_lat: row.location_lat ?? null,
    location_lng: row.location_lng ?? null,
    image_url: row.image_url ?? null,
    category: row.primary_vibe ?? null,
    gender_rule: row.gender_rule ?? null,
    max_invites: row.max_invites ?? null,
    min_invites: row.min_invites ?? null,
    neighborhood: row.neighborhood ?? null,
    slug: null,
    member_count: 1,
    status: row.status ?? 'forming',
    host_message: row.host_message ?? null,
    is_featured: false,
    featured_type: null,
    cluster_root_id: null,
    allow_duplicate: row.allow_duplicate ?? true,
    circle_id: null,
    circle_visibility: null,
    stranger_cap: null,
    circle_size: null,
    circle_in_count: null,
    creator: {
      id: creator?.id ?? userId,
      first_name_display: creator?.first_name_display ?? null,
      profile_photo_url: creator?.profile_photo_url ?? null,
    },
  };
}

/** Handle returned by `prependOptimisticPlan` to commit or roll back the write. */
export interface OptimisticHandle {
  tempId: string;
  /** Swap the temp id for the real event id in both caches (call after member-insert succeeds). */
  commit: (realId: string) => void;
  /** Restore both caches to the exact pre-prepend snapshot (call on insert failure). */
  rollback: () => void;
}

function feedKey(userId: string) {
  return ['events', 'feed', userId] as const;
}
function myPlansKey(userId: string) {
  return ['my-plans', userId] as const;
}

/**
 * onMutate: cancel in-flight queries on both keys, snapshot both, and prepend the
 * optimistic plan to both. Returns a handle for commit / rollback.
 *
 * The exact keys (including `userId`) are required; partial keys work for
 * invalidate but silently no-op for setQueryData. `cancelQueries` is fired but not
 * awaited so the cache write stays synchronous and the post moment shows instantly;
 * staleTime 60s + no refetch-on-mount makes a racing refetch a non-issue, and the
 * onSettled invalidate reconciles regardless.
 */
export function prependOptimisticPlan(
  queryClient: QueryClient,
  userId: string,
  plan: Plan,
): OptimisticHandle {
  const fKey = feedKey(userId);
  const mKey = myPlansKey(userId);

  queryClient.cancelQueries({ queryKey: fKey });
  queryClient.cancelQueries({ queryKey: mKey });

  const prevFeed = queryClient.getQueryData<Plan[]>(fKey);
  const prevMine = queryClient.getQueryData<Plan[]>(mKey);

  queryClient.setQueryData<Plan[]>(fKey, (old) => [plan, ...(old ?? [])]);
  queryClient.setQueryData<Plan[]>(mKey, (old) => [plan, ...(old ?? [])]);

  const tempId = plan.id;

  return {
    tempId,
    commit: (realId: string) => {
      const swap = (old: Plan[] | undefined) =>
        (old ?? []).map((p) => (p.id === tempId ? { ...p, id: realId } : p));
      queryClient.setQueryData<Plan[]>(fKey, swap);
      queryClient.setQueryData<Plan[]>(mKey, swap);
    },
    rollback: () => {
      queryClient.setQueryData<Plan[]>(fKey, prevFeed);
      queryClient.setQueryData<Plan[]>(mKey, prevMine);
    },
  };
}
