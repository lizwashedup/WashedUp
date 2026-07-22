/**
 * The event page body (proposal 70, applied): an ordered block array on
 * explore_events.description_blocks, trigger-validated server-side.
 * Blocks: text (1..5000 chars), image (path pinned to the event's own
 * event-content folder), and at most ONE faq marker (where the faq
 * cards render). Null = legacy plain description. Writes are a direct
 * column update; the 70 trigger is the validator of record.
 */

import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Crypto from 'expo-crypto';
import { supabase } from './supabase';
import { uploadBase64ToStorage } from './uploadPhoto';

export type DescriptionBlock =
  | { type: 'text'; content: string }
  | { type: 'image'; path: string; alt?: string }
  | { type: 'faq' };

// 70's validator limits, mirrored so the editor can explain them
export const BLOCKS_MAX = 30;
export const TEXT_BLOCK_MAX = 5000;
export const IMAGE_ALT_MAX = 300;
export const EVENT_CONTENT_BUCKET = 'event-content';
const BLOCK_IMAGE_WIDTH = 1600;
const BLOCK_IMAGE_QUALITY = 0.85;

export async function getDescriptionBlocks(eventId: string): Promise<DescriptionBlock[]> {
  const { data, error } = await supabase
    .from('explore_events')
    .select('description_blocks')
    .eq('id', eventId)
    .maybeSingle();
  if (error || !data?.description_blocks) return [];
  return Array.isArray(data.description_blocks)
    ? (data.description_blocks as DescriptionBlock[])
    : [];
}

export async function saveDescriptionBlocks(
  eventId: string,
  blocks: DescriptionBlock[],
): Promise<{ ok: boolean; message: string | null }> {
  const { error } = await supabase
    .from('explore_events')
    .update({ description_blocks: blocks.length > 0 ? blocks : null })
    .eq('id', eventId);
  return { ok: !error, message: error?.message ?? null };
}

/** Picks, resizes, and uploads a body image into the event's own folder;
 *  returns the STORED PATH (what the block carries), not a URL. */
export async function pickAndUploadEventContentImage(eventId: string): Promise<string | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return null;
  const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
  if (res.canceled || !res.assets?.[0]) return null;
  const manipulated = await ImageManipulator.manipulateAsync(
    res.assets[0].uri,
    [{ resize: { width: BLOCK_IMAGE_WIDTH } }],
    { compress: BLOCK_IMAGE_QUALITY, format: ImageManipulator.SaveFormat.JPEG, base64: true },
  );
  if (!manipulated.base64) return null;
  const path = `${eventId}/${Crypto.randomUUID()}.jpg`;
  await uploadBase64ToStorage(EVENT_CONTENT_BUCKET, path, manipulated.base64);
  return path;
}

export function eventContentPublicUrl(path: string): string {
  return supabase.storage.from(EVENT_CONTENT_BUCKET).getPublicUrl(path).data.publicUrl;
}
