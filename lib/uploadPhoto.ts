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
 * path), with REAL progress and cancel (doc 78 law 16, ruled 2026-07-22).
 *
 * Deliberately NOT base64: a 100 MB mp4 becomes a ~133 MB JS string that
 * way and can take the app down. And deliberately NOT supabase-js: its
 * upload() exposes no progress stream, which is a client-library
 * limitation, not a platform one - createUploadTask streams the same
 * bytes from disk AND reports progress, so native holds parity with
 * web's XHR rather than conceding an indeterminate bar.
 */
export interface CancellableUpload {
  /** resolves to the public URL, or null if the caller cancelled */
  done: Promise<string | null>;
  cancel: () => void;
}

export function uploadUriToStorage(
  bucket: string,
  path: string,
  uri: string,
  contentType: string,
  onProgress?: (fraction: number) => void,
): CancellableUpload {
  let cancelled = false;
  let task: FileSystem.UploadTask | null = null;

  const done = (async (): Promise<string | null> => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Not signed in');
    if (cancelled) return null;

    task = FileSystem.createUploadTask(
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
      (data) => {
        if (data.totalBytesExpectedToSend > 0) {
          onProgress?.(data.totalBytesSent / data.totalBytesExpectedToSend);
        }
      },
    );

    const result = await task.uploadAsync();
    // a cancelled task resolves undefined/null rather than throwing
    if (cancelled || !result) return null;
    if (result.status < 200 || result.status >= 300) {
      throw new Error(`upload failed (${result.status})`);
    }
    return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
  })();

  return {
    done,
    cancel: () => {
      cancelled = true;
      task?.cancelAsync().catch(() => {});
    },
  };
}
