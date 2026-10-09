import { decode } from 'base64-arraybuffer';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from './supabase';
import { isStorageObjectConflict } from './storageObjectConflict';

const CHAT_AUDIO_BUCKET = 'chat-audio';

/**
 * Upload a locally recorded voice message (m4a) to Supabase Storage and return
 * its public URL.
 *
 * Reads the file as base64 and uploads via base64-arraybuffer's decode(), the
 * same proven path as uploadPhoto.ts. We deliberately avoid fetch(uri).blob()/
 * arrayBuffer(), which is broken in React Native for file:// URIs.
 *
 * Path: {event_id}/{user_id}/{uploadId or timestamp}.m4a (matches the chat-audio RLS
 * policies: own-folder + joined-member check).
 */
export async function uploadAudioToStorage(
  eventId: string,
  userId: string,
  uri: string,
  scope?: { isCurrent: () => boolean },
  // A stable UUID owned by this unchanged recording session, reused on retry.
  uploadId?: string,
): Promise<string> {
  const assertCurrent = () => { if (scope && !scope.isCurrent()) throw new Error('Conversation changed'); };
  assertCurrent();
  if (uploadId !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uploadId)) {
    throw new Error('Invalid recording upload identity');
  }
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  assertCurrent();
  const arrayBuffer = decode(base64);
  const path = `${eventId}/${userId}/${uploadId ?? Date.now()}.m4a`;

  const { error } = await supabase.storage
    .from(CHAT_AUDIO_BUCKET)
    .upload(path, arrayBuffer, { contentType: 'audio/mp4', upsert: false });

  assertCurrent();
  // The first upload may have committed before its response was lost. Never
  // overwrite it or invent another object when explicitly retrying that ID.
  if (error && !(uploadId && isStorageObjectConflict(error))) throw error;

  const { data } = supabase.storage.from(CHAT_AUDIO_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
