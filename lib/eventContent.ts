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

// NO standalone save: proposal 77 (applied) puts p_description_blocks on
// operator_create/update_explore_event, and every OTHER omitted param on
// that RPC still NULLS its column - so a blocks-only call would wipe the
// title, date, and venue. The body rides the form's complete field set
// instead (lib/creatorEvents), which is why this module has no writer.

/** Multi-select gallery pick (doc 76 §2: the Curtain Call mood board is
 *  many photos at once): resizes and uploads each into the event's own
 *  folder; returns the STORED PATHS in pick order, skipping any that
 *  fail rather than losing the batch. */
export async function pickAndUploadEventContentImages(
  eventId: string,
  maxCount: number,
): Promise<string[]> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return [];
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 1,
    allowsMultipleSelection: true,
    selectionLimit: maxCount,
  });
  if (res.canceled || !res.assets?.length) return [];
  const paths: string[] = [];
  for (const asset of res.assets.slice(0, maxCount)) {
    try {
      const manipulated = await ImageManipulator.manipulateAsync(
        asset.uri,
        [{ resize: { width: BLOCK_IMAGE_WIDTH } }],
        { compress: BLOCK_IMAGE_QUALITY, format: ImageManipulator.SaveFormat.JPEG, base64: true },
      );
      if (!manipulated.base64) continue;
      const path = `${eventId}/${Crypto.randomUUID()}.jpg`;
      await uploadBase64ToStorage(EVENT_CONTENT_BUCKET, path, manipulated.base64);
      paths.push(path);
    } catch {
      continue;
    }
  }
  return paths;
}

export function eventContentPublicUrl(path: string): string {
  return supabase.storage.from(EVENT_CONTENT_BUCKET).getPublicUrl(path).data.publicUrl;
}
