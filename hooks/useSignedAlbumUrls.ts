/**
 * useSignedAlbumUrls - batch-sign album-media storage paths to displayable URLs.
 *
 * Photos in get_circle().recent_together (and the living cover derived from the
 * newest one) arrive as album-media storage paths, not URLs. The album-media
 * bucket is private, so each path needs a short-lived signed URL. This signs the
 * whole set in one call and returns a path -> signedUrl map. Mirrors the album
 * grid's signing (album-media, 2h TTL).
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

const ALBUM_BUCKET = 'album-media';
const SIGNED_URL_TTL_SEC = 7200; // 2h, matches the albums grid / detail screens
// Re-sign a few minutes before expiry so a long-lived screen never shows a dead URL.
const REFRESH_BEFORE_SEC = 600;

export function useSignedAlbumUrls(paths: (string | null | undefined)[]) {
  const clean = Array.from(new Set(paths.filter((p): p is string => !!p)));
  // Stable key independent of order so re-renders with the same set hit cache.
  const key = [...clean].sort().join('|');

  return useQuery({
    queryKey: ['album-signed-urls', key],
    enabled: clean.length > 0,
    staleTime: (SIGNED_URL_TTL_SEC - REFRESH_BEFORE_SEC) * 1000,
    queryFn: async (): Promise<Record<string, string>> => {
      const { data, error } = await supabase.storage
        .from(ALBUM_BUCKET)
        .createSignedUrls(clean, SIGNED_URL_TTL_SEC);
      if (error) throw error;
      const map: Record<string, string> = {};
      for (const row of data ?? []) {
        if (row.path && row.signedUrl) map[row.path] = row.signedUrl;
      }
      return map;
    },
  });
}
