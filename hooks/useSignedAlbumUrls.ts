/**
 * useSignedAlbumUrls - batch-sign album-media storage paths to displayable URLs.
 *
 * Photos in get_circle().recent_together (and the living cover derived from the
 * newest one) arrive as album-media storage paths, not URLs. The album-media
 * bucket is private, so each path needs a short-lived signed URL. This signs the
 * whole set in one call and returns a path -> signedUrl map. Mirrors the album
 * grid's signing (album-media, 2h TTL).
 */
import { useLayoutEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { requestWithDeadline } from '../lib/requestWithDeadline';
import type { CirclePlansScope } from './useCirclePlans';

const ALBUM_BUCKET = 'album-media';
const SIGNED_URL_TTL_SEC = 7200; // 2h, matches the albums grid / detail screens
// Re-sign a few minutes before expiry so a long-lived screen never shows a dead URL.
const REFRESH_BEFORE_SEC = 600;

export function useSignedAlbumUrls(paths: (string | null | undefined)[], scope?: CirclePlansScope) {
  const clean = Array.from(new Set(paths.filter((p): p is string => !!p)));
  // The caller owns the confirmed Circle account generation. Never reuse an
  // unscoped URL, even when two accounts request the same private storage path.
  const key = [...clean].sort();
  const ready = clean.length > 0 && !!scope?.userId;
  const pathKey = JSON.stringify(key);
  const owner = useMemo(() => ({}), [scope?.userId, scope?.epoch, pathKey]);
  const [committedOwner, setCommittedOwner] = useState<object | null>(null);
  // Parent visit guards become active in layout effects. Recheck a warm URL
  // after that commit instead of either leaking it or hiding it indefinitely.
  useLayoutEffect(() => { setCommittedOwner(owner); }, [owner]);

  const query = useQuery({
    queryKey: ['album-signed-urls', scope?.userId ?? '', scope?.epoch ?? null, key],
    enabled: ready,
    staleTime: (SIGNED_URL_TTL_SEC - REFRESH_BEFORE_SEC) * 1000,
    queryFn: async ({ signal }): Promise<Record<string, string>> => {
      const requireCurrent = () => {
        if (!scope?.userId || !scope.isCurrent() || signal.aborted || clean.length === 0) {
          throw new Error('This photo request is no longer current.');
        }
      };
      requireCurrent();
      const { data: auth, error: authError } = await requestWithDeadline(supabase.auth.getUser(), 12_000);
      requireCurrent();
      if (authError) throw authError;
      if (auth.user?.id !== scope!.userId) throw new Error('This account changed. Please try again.');
      const { data, error } = await requestWithDeadline(supabase.storage
        .from(ALBUM_BUCKET)
        .createSignedUrls(clean, SIGNED_URL_TTL_SEC), 12_000);
      requireCurrent();
      if (error) throw error;
      const map: Record<string, string> = {};
      for (const row of data ?? []) {
        if (row.path && row.signedUrl) map[row.path] = row.signedUrl;
      }
      return map;
    },
  });
  return { ...query, data: ready && committedOwner === owner && scope?.isCurrent() && !query.isError ? query.data : undefined };
}
