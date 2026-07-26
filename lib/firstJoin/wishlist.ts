/**
 * The "tell me when something opens near me" capture (spec a2 secondary
 * action). Two effects:
 *
 *  1. profiles.push_new_plans_area = true (real, idempotent: an UPDATE to a
 *     boolean; two taps land on the same value, no rows are created).
 *  2. A demand-signal row (neighborhood + vibe snapshot at raise-hand time,
 *     the a4b creator-side "9 people near silver lake" surface). The existing
 *     `wishlists` table is the EVENT-save feature (user_id + event_id, no
 *     area/vibe columns; verified on prod 2026-07-16), so this row lives in
 *     area_wishlists (migration applied 2026-07-18 with Liz's approval).
 *
 * Deps are injected so the write path unit-tests without the supabase client.
 */
import { supabase } from '../supabase';

/** Migration applied to prod 2026-07-18 (Liz-approved); demand rows live. */
export const AREA_WISHLIST_TABLE_READY = true;

export interface AreaWishlistDeps {
  setPushNewPlansArea(userId: string): Promise<{ error: { message: string } | null }>;
  /** Upsert on user_id: a second tap can never duplicate the row. */
  upsertDemandSignal(userId: string): Promise<{ error: { message: string } | null }>;
  tableReady: boolean;
}

export interface AreaWishlistResult {
  ok: boolean;
  /** True when the demand-signal row was skipped because the table is pending. */
  demandSignalPending: boolean;
}

export async function saveAreaWishlistWithDeps(
  userId: string,
  deps: AreaWishlistDeps,
): Promise<AreaWishlistResult> {
  if (!userId) return { ok: false, demandSignalPending: !deps.tableReady };

  try {
    const { error: flagError } = await deps.setPushNewPlansArea(userId);
    if (flagError) {
      console.warn('[saveAreaWishlist] push_new_plans_area update failed:', flagError.message);
      return { ok: false, demandSignalPending: !deps.tableReady };
    }

    if (!deps.tableReady) return { ok: true, demandSignalPending: true };

    const { error: rowError } = await deps.upsertDemandSignal(userId);
    if (rowError) {
      // The flag is on, which is the user-visible promise; the demand row is
      // analytics-side. Log, do not fail the capture.
      console.warn('[saveAreaWishlist] demand-signal upsert failed:', rowError.message);
      return { ok: true, demandSignalPending: true };
    }
    return { ok: true, demandSignalPending: false };
  } catch (err) {
    console.warn('[saveAreaWishlist]', err instanceof Error ? err.message : err);
    return { ok: false, demandSignalPending: !deps.tableReady };
  }
}

export const supabaseAreaWishlistDeps: AreaWishlistDeps = {
  async setPushNewPlansArea(userId) {
    const { error } = await supabase
      .from('profiles')
      .update({ push_new_plans_area: true })
      .eq('id', userId);
    return { error };
  },
  async upsertDemandSignal(userId) {
    // Snapshot neighborhood + vibe_tags at raise-hand time so the demand
    // signal survives later profile edits (a4b creator-side surface).
    const { data: profile } = await supabase
      .from('profiles')
      .select('neighborhood, vibe_tags')
      .eq('id', userId)
      .maybeSingle();
    const { error } = await supabase.from('area_wishlists').upsert(
      {
        user_id: userId,
        neighborhood: profile?.neighborhood ?? null,
        vibe_tags: profile?.vibe_tags ?? null,
        active: true,
      },
      { onConflict: 'user_id' },
    );
    return { error };
  },
  tableReady: AREA_WISHLIST_TABLE_READY,
};

/** The production entry point the screen calls. */
export function saveAreaWishlist(userId: string): Promise<AreaWishlistResult> {
  return saveAreaWishlistWithDeps(userId, supabaseAreaWishlistDeps);
}

// ─── Vibe tags (confirmation-screen chips, founder ruling 7-19) ──────────────
// No onboarding step: the confirmation chips are the vibe edit surface.
// A toggle writes profiles.vibe_tags and refreshes the area_wishlists
// snapshot so the demand signal tracks the new picks.

export interface VibeTagsDeps {
  setVibeTags(userId: string, tags: string[]): Promise<{ error: { message: string } | null }>;
  refreshDemandSnapshot(userId: string): Promise<{ error: { message: string } | null }>;
  tableReady: boolean;
}

export async function updateVibeTagsWithDeps(
  userId: string,
  tags: string[],
  deps: VibeTagsDeps,
): Promise<{ ok: boolean }> {
  if (!userId) return { ok: false };
  try {
    const { error } = await deps.setVibeTags(userId, tags);
    if (error) {
      console.warn('[updateVibeTags] profile update failed:', error.message);
      return { ok: false };
    }
    if (deps.tableReady) {
      const { error: snapErr } = await deps.refreshDemandSnapshot(userId);
      if (snapErr) console.warn('[updateVibeTags] snapshot refresh failed:', snapErr.message);
    }
    return { ok: true };
  } catch (err) {
    console.warn('[updateVibeTags]', err instanceof Error ? err.message : err);
    return { ok: false };
  }
}

export const supabaseVibeTagsDeps: VibeTagsDeps = {
  async setVibeTags(userId, tags) {
    const { error } = await supabase.from('profiles').update({ vibe_tags: tags }).eq('id', userId);
    return { error };
  },
  refreshDemandSnapshot: (userId) => supabaseAreaWishlistDeps.upsertDemandSignal(userId),
  tableReady: AREA_WISHLIST_TABLE_READY,
};

export function updateVibeTags(userId: string, tags: string[]): Promise<{ ok: boolean }> {
  return updateVibeTagsWithDeps(userId, tags, supabaseVibeTagsDeps);
}
