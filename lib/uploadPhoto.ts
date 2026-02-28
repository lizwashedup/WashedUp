import { decode } from 'base64-arraybuffer';
import { supabase } from './supabase';

/**
 * Upload a base64-encoded image to Supabase Storage.
 *
 * Accepts the base64 string directly from ImageManipulator's output
 * (when called with { base64: true }). This avoids fetch().blob() which
 * is broken in React Native — it produces empty/corrupt blobs for file:// URIs.
 *
 * No native modules required — uses base64-arraybuffer (pure JS).
 */
export async function uploadBase64ToStorage(
  bucket: string,
  path: string,
  base64: string,
  options?: { upsert?: boolean }
): Promise<string> {
  const arrayBuffer = decode(base64);

  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, arrayBuffer, {
      contentType: 'image/jpeg',
      upsert: options?.upsert ?? false,
    });

  if (error) throw error;

  const { data: urlData } = supabase.storage
    .from(bucket)
    .getPublicUrl(path);

  return `${urlData.publicUrl}?t=${Date.now()}`;
}
