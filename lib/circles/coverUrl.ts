/**
 * buildCircleCoverUrl - resolve a circle's cover_upload_id to a public URL.
 *
 * Covers live in the public `circle-covers` bucket at {circle_id}/{cover_upload_id}
 * (storage live, batch 2 file 5). Returns null when there is no manual cover, so
 * CircleCover falls back to the monogram / cream tile. (Living cover from the
 * latest plan album is a backend follow-up; see the tracker.)
 */
import { supabase } from '../supabase';

export function buildCircleCoverUrl(
  circleId: string,
  coverUploadId: string | null | undefined,
): string | null {
  if (!coverUploadId) return null;
  const { data } = supabase.storage
    .from('circle-covers')
    .getPublicUrl(`${circleId}/${coverUploadId}`);
  return data.publicUrl;
}
