/**
 * Community page blocks: the leader-facing data layer for the block editor.
 *
 * All writes go straight at community_blocks through phase 1 RLS (leaders,
 * co-leaders, and admins only). Content jsonb shapes are the shared contract
 * with the web page at /c/[handle] — they live in washedup-web
 * src/lib/communities/data.ts and MUST stay in lockstep. Change both or
 * neither:
 *   cover:        { images: string[] }
 *   header:       { tagline?: string; logo_url?: string }
 *   about:        { text: string }
 *   events_auto:  {}   (renders itself from explore_events)
 *   members_auto: {}   (renders itself from membership data)
 *   gallery:      { images: string[] }
 *   links:        { links: { label: string; url: string }[] }
 *   pinned:       { title?: string; text: string }
 *
 * Image uploads target the community-media bucket (folder = community id,
 * leader-gated by storage policy). That bucket rides a HELD migration; until
 * it is applied, uploads fail with a friendly error and everything else in
 * the editor still works.
 */

import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Crypto from 'expo-crypto';
import { supabase } from './supabase';
import { uploadBase64ToStorage } from './uploadPhoto';

export type CommunityBlockType =
  | 'cover'
  | 'header'
  | 'about'
  | 'events_auto'
  | 'members_auto'
  | 'gallery'
  | 'links'
  | 'pinned';

export interface CommunityBlock {
  id: string;
  community_id: string;
  block_type: CommunityBlockType;
  position: number;
  visible: boolean;
  content: Record<string, unknown>;
}

export const COMMUNITY_MEDIA_BUCKET = 'community-media';
export const COVER_MAX_IMAGES = 6;
export const GALLERY_MAX_IMAGES = 12;

/** Display metadata for the editor. One block per type (cap the choices). */
export const BLOCK_TYPE_INFO: Record<
  CommunityBlockType,
  { label: string; hint: string; auto: boolean }
> = {
  cover: {
    label: 'cover photos',
    hint: 'up to 6 photos at the top of your page. the first one is the face of it.',
    auto: false,
  },
  header: {
    label: 'header',
    hint: 'your one-liner and logo, under your community name.',
    auto: false,
  },
  about: {
    label: 'about',
    hint: 'what this community is, in your words.',
    auto: false,
  },
  events_auto: {
    label: 'upcoming events',
    hint: 'fills itself from your events. nothing to write.',
    auto: true,
  },
  members_auto: {
    label: 'members',
    hint: 'fills itself with your member count and faces. nothing to write.',
    auto: true,
  },
  gallery: {
    label: 'photo gallery',
    hint: 'past events, the vibe. up to 12 photos.',
    auto: false,
  },
  links: {
    label: 'links',
    hint: 'socials, merch, anything with a url.',
    auto: false,
  },
  pinned: {
    label: 'pinned note',
    hint: 'your featured announcement or house rules.',
    auto: false,
  },
};

/** The one-column order offered in the add sheet, doc 09's block set. */
export const BLOCK_TYPE_ORDER: CommunityBlockType[] = [
  'cover',
  'header',
  'about',
  'events_auto',
  'members_auto',
  'gallery',
  'links',
  'pinned',
];

export function defaultContentFor(type: CommunityBlockType): Record<string, unknown> {
  switch (type) {
    case 'cover':
    case 'gallery':
      return { images: [] };
    case 'header':
      return {};
    case 'about':
      return { text: '' };
    case 'links':
      return { links: [] };
    case 'pinned':
      return { text: '' };
    case 'events_auto':
    case 'members_auto':
      return {};
  }
}

/** Every block, hidden ones included. Leader RLS grants the full read. */
export async function getBlocksForEditor(communityId: string): Promise<CommunityBlock[]> {
  const { data, error } = await supabase
    .from('community_blocks')
    .select('id, community_id, block_type, position, visible, content')
    .eq('community_id', communityId)
    .order('position', { ascending: true });
  if (error) throw error;
  return (data ?? []) as CommunityBlock[];
}

/** Visible blocks only: what a member sees, the app-home projection. */
export async function getVisibleBlocks(communityId: string): Promise<CommunityBlock[]> {
  const { data, error } = await supabase
    .from('community_blocks')
    .select('id, community_id, block_type, position, visible, content')
    .eq('community_id', communityId)
    .eq('visible', true)
    .order('position', { ascending: true });
  if (error) throw error;
  return (data ?? []) as CommunityBlock[];
}

export async function addBlock(
  communityId: string,
  type: CommunityBlockType,
  position: number,
): Promise<CommunityBlock> {
  const { data, error } = await supabase
    .from('community_blocks')
    .insert({
      community_id: communityId,
      block_type: type,
      position,
      visible: true,
      content: defaultContentFor(type),
    })
    .select('id, community_id, block_type, position, visible, content')
    .single();
  if (error) throw error;
  return data as CommunityBlock;
}

export async function updateBlockContent(
  blockId: string,
  content: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase
    .from('community_blocks')
    .update({ content })
    .eq('id', blockId);
  if (error) throw error;
}

/**
 * Append or remove an image against the FRESH server-side content, not the
 * caller's possibly stale copy, so back-to-back uploads never drop a photo.
 */
export async function mutateBlockImages(
  blockId: string,
  mutate: (images: string[]) => string[],
): Promise<void> {
  const { data, error } = await supabase
    .from('community_blocks')
    .select('content')
    .eq('id', blockId)
    .single();
  if (error) throw error;
  const content = (data?.content ?? {}) as Record<string, unknown>;
  const images = Array.isArray(content.images) ? (content.images as string[]) : [];
  await updateBlockContent(blockId, { ...content, images: mutate(images) });
}

export async function setBlockVisible(blockId: string, visible: boolean): Promise<void> {
  const { error } = await supabase
    .from('community_blocks')
    .update({ visible })
    .eq('id', blockId);
  if (error) throw error;
}

export async function deleteBlock(blockId: string): Promise<void> {
  const { error } = await supabase.from('community_blocks').delete().eq('id', blockId);
  if (error) throw error;
}

/**
 * Persist a full ordering: rewrites position 0..n-1 to match the given id
 * order. At most 8 blocks, so a burst of single-row updates is fine.
 */
export async function saveBlockOrder(orderedIds: string[]): Promise<void> {
  const results = await Promise.all(
    orderedIds.map((id, index) =>
      supabase.from('community_blocks').update({ position: index }).eq('id', id),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) throw failed.error;
}

/**
 * Pick, compress, and upload one image for a block. Returns the public URL,
 * or null on cancel / permission denial. Mirrors the proven circle-cover
 * path (ImagePicker -> ImageManipulator base64 -> storage upload).
 */
export async function pickAndUploadBlockImage(communityId: string): Promise<string | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return null;
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 1,
  });
  if (res.canceled || !res.assets?.[0]) return null;
  const manipulated = await ImageManipulator.manipulateAsync(
    res.assets[0].uri,
    [{ resize: { width: 1600 } }],
    { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG, base64: true },
  );
  if (!manipulated.base64) return null;
  const path = `${communityId}/${Crypto.randomUUID()}.jpg`;
  return uploadBase64ToStorage(COMMUNITY_MEDIA_BUCKET, path, manipulated.base64);
}
