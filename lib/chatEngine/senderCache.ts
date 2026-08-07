/**
 * Module-level sender profile cache for the chat engine (doc 123).
 *
 * One profiles_public row per user, shared across every chat surface for the
 * life of the JS session. First paint of a thread resolves senders
 * synchronously from here (no profile round-trip on the render path); misses
 * are fetched once, deduped across concurrent callers, and cached.
 *
 * The cache holds display data only (first name + avatar URL) -- nothing
 * sensitive -- and is keyed by user id. Profile edits mid-session show stale
 * until the next cold start, the same tradeoff the chat list's sender-name
 * cache already makes.
 */
import { supabase } from '../supabase';
import { logError } from '../logger';

export interface CachedSender {
  id: string;
  first_name: string | null;
  avatar_url: string | null;
}

const cache = new Map<string, CachedSender>();
// In-flight fetch per user id so concurrent threads don't duplicate requests.
const pending = new Map<string, Promise<void>>();

export function getCachedSender(userId: string): CachedSender | null {
  return cache.get(userId) ?? null;
}

export function seedSender(sender: CachedSender): void {
  cache.set(sender.id, sender);
}

/**
 * Ensure every id is cached, fetching only the misses in one batch. Resolves
 * when all requested ids are settled (a missing profiles_public row caches as
 * a null-name sender so it is never re-fetched in a loop).
 */
export async function ensureSenders(userIds: string[]): Promise<void> {
  const misses = userIds.filter(id => id && !cache.has(id) && !pending.has(id));
  if (misses.length > 0) {
    const fetchPromise = (async () => {
      try {
        const { data } = await supabase
          .from('profiles_public')
          .select('id, first_name_display, profile_photo_url')
          .in('id', misses);
        const found = new Set<string>();
        (data ?? []).forEach((p: any) => {
          found.add(p.id);
          cache.set(p.id, {
            id: p.id,
            first_name: p.first_name_display ?? null,
            avatar_url: p.profile_photo_url ?? null,
          });
        });
        // Cache the not-found ids too so a deleted account can't cause a
        // refetch on every render pass.
        misses.forEach(id => {
          if (!found.has(id)) cache.set(id, { id, first_name: null, avatar_url: null });
        });
      } catch (err) {
        logError(err, 'chatEngine.ensureSenders');
      } finally {
        misses.forEach(id => pending.delete(id));
      }
    })();
    misses.forEach(id => pending.set(id, fetchPromise));
  }
  const waits = userIds.map(id => pending.get(id)).filter(Boolean) as Promise<void>[];
  if (waits.length > 0) await Promise.all(waits);
}
