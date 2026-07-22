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
import { uploadBase64ToStorage, uploadUriToStorage } from './uploadPhoto';

export type DescriptionBlock =
  | { type: 'text'; content: string }
  | { type: 'image'; path: string; alt?: string }
  // 77's validator: video is hosted mp4 in v1 and shares the image
  // branch's folder-pin law. mp4 ONLY - never promise .mov (doc 78 law 16)
  | { type: 'video'; path: string; alt?: string }
  | { type: 'faq' };

// 70's validator limits, mirrored so the editor can explain them
export const BLOCKS_MAX = 30;
// doc 78 law 15: a soft image cap with a live count that counts BLOCKS,
// and sits UNDER 70's hard ceiling so the two counters can never disagree
export const GALLERY_SOFT_CAP = 20;
// 77 set the bucket guards; the client rejects before the upload starts
export const MEDIA_MAX_BYTES = 104857600;
export const IMAGE_MAX_BYTES = 10485760;
export const VIDEO_MIME = 'video/mp4';
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
export interface MediaUploadResult {
  paths: string[];
  /** doc 78 law 15: specific errors, never "upload failed" */
  problems: string[];
}

function describeSize(bytes: number): string {
  return bytes >= 1048576
    ? `${(bytes / 1048576).toFixed(bytes >= 10485760 ? 0 : 1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export async function pickAndUploadEventContentImages(
  eventId: string,
  maxCount: number,
): Promise<MediaUploadResult> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return { paths: [], problems: [] };
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 1,
    allowsMultipleSelection: true,
    selectionLimit: maxCount,
  });
  if (res.canceled || !res.assets?.length) return { paths: [], problems: [] };
  const paths: string[] = [];
  const problems: string[] = [];
  for (const asset of res.assets.slice(0, maxCount)) {
    try {
      // reject BEFORE the upload starts, with the real number (law 15)
      if (asset.fileSize && asset.fileSize > IMAGE_MAX_BYTES) {
        problems.push(`that photo is ${describeSize(asset.fileSize)}, the most is ${describeSize(IMAGE_MAX_BYTES)}.`);
        continue;
      }
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
      problems.push('one photo did not upload. try that one again.');
    }
  }
  return { paths, problems };
}

export function eventContentPublicUrl(path: string): string {
  return supabase.storage.from(EVENT_CONTENT_BUCKET).getPublicUrl(path).data.publicUrl;
}

/** Video pick (doc 78 law 16, proposal 77's allow-list): mp4 only, 100 MB
 *  ceiling, both checked CLIENT-SIDE before a byte uploads so a bad file
 *  never costs the organizer an upload. Returns the stored path. */
export async function pickAndUploadEventContentVideo(
  eventId: string,
): Promise<{ path: string | null; problem: string | null }> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return { path: null, problem: null };
  const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], quality: 1 });
  if (res.canceled || !res.assets?.[0]) return { path: null, problem: null };
  const asset = res.assets[0];

  // instant reject 1: format. The bucket allow-list is {jpeg,png,webp,mp4},
  // so anything else is refused server-side anyway - we say so first.
  const name = (asset.fileName ?? asset.uri).toLowerCase();
  if (!name.endsWith('.mp4')) {
    /* copy to the taste gate */
    return { path: null, problem: 'that one is not an mp4. mp4 is the format we take right now.' };
  }
  // instant reject 2: size, with the real number
  if (asset.fileSize && asset.fileSize > MEDIA_MAX_BYTES) {
    return {
      path: null,
      /* copy to the taste gate */
      problem: `that video is ${describeSize(asset.fileSize)}, the most is ${describeSize(MEDIA_MAX_BYTES)}.`,
    };
  }

  try {
    const path = `${eventId}/${Crypto.randomUUID()}.mp4`;
    await uploadUriToStorage(EVENT_CONTENT_BUCKET, path, asset.uri, VIDEO_MIME);
    return { path, problem: null };
  } catch {
    /* copy to the taste gate */
    return { path: null, problem: 'that video did not upload. give it another try.' };
  }
}
