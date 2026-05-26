import { decode } from 'base64-arraybuffer';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from './supabase';

const CHAT_AUDIO_BUCKET = 'chat-audio';

/**
 * Upload a locally recorded voice message (m4a) to Supabase Storage and return
 * its public URL.
 *
 * Reads the file as base64 and uploads via base64-arraybuffer's decode(), the
 * same proven path as uploadPhoto.ts. We deliberately avoid fetch(uri).blob()/
 * arrayBuffer(), which is broken in React Native for file:// URIs.
 *
 * Path: {event_id}/{user_id}/{timestamp}.m4a (matches the chat-audio RLS
 * policies: own-folder + joined-member check).
 */
export async function uploadAudioToStorage(
  eventId: string,
  userId: string,
  uri: string,
): Promise<string> {
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const arrayBuffer = decode(base64);
  const path = `${eventId}/${userId}/${Date.now()}.m4a`;

  const { error } = await supabase.storage
    .from(CHAT_AUDIO_BUCKET)
    .upload(path, arrayBuffer, { contentType: 'audio/mp4', upsert: false });

  if (error) throw error;

  const { data } = supabase.storage.from(CHAT_AUDIO_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
