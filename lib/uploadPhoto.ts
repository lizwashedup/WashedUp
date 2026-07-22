import { decode } from 'base64-arraybuffer';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase, SUPABASE_URL } from './supabase';

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
  const contentType = path.endsWith('.png') ? 'image/png' : 'image/jpeg';

  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, arrayBuffer, {
      contentType,
      upsert: options?.upsert ?? false,
    });

  if (error) throw error;

  const { data: urlData } = supabase.storage
    .from(bucket)
    .getPublicUrl(path);

  return `${urlData.publicUrl}?t=${Date.now()}`;
}

/**
 * Upload a file:// URI straight to Storage as binary (proposal 77's video
 * path). Deliberately NOT base64: a 100 MB mp4 becomes a ~133 MB JS string
 * that way and can take the app down. expo-file-system streams it from
 * disk instead, so memory stays flat regardless of file size.
 */
export async function uploadUriToStorage(
  bucket: string,
  path: string,
  uri: string,
  contentType: string,
): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not signed in');

  const result = await FileSystem.uploadAsync(
    `${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`,
    uri,
    {
      httpMethod: 'POST',
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': contentType,
        'x-upsert': 'false',
      },
    },
  );
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`upload failed (${result.status})`);
  }
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}
