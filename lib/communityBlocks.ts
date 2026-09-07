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
 *   cadence:      { text: string }
 *   events_auto:  {}   (renders itself from explore_events)
 *   members_auto: {}   (renders itself from membership data)
 *   gallery:      { images: string[] }
 *   links:        { links: { label: string; url: string }[] }
 *   pinned:       { title?: string; text: string }
 *   founder:      { text: string }   (the face + name are LIVE-RESOLVED
 *                 from the leader's profile via proposal 41, never stored)
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
  | 'founder'
  | 'about'
  | 'cadence'
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
  founder: {
    // LIZ COPY (the people-first pack): the leader's face rides in
    // automatically from her profile; only the words are written here
    label: 'why i started this',
    hint: 'your face and a few honest lines. the photo comes from your profile on its own.',
    auto: false,
  },
  about: {
    label: 'about',
    hint: 'what this community is, in your words.',
    auto: false,
  },
  cadence: {
    // LIZ COPY (proposed)
    label: 'what membership feels like',
    hint: 'how often people hear from you, and what being a part of this actually feels like.',
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
  'founder',
  'about',
  'cadence',
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
    case 'founder':
    case 'cadence':
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

// -- Identity fields (name + purpose live on communities, not a block) ------

export interface CommunityIdentity {
  name: string;
  purpose: string | null;
}

export const IDENTITY_NAME_MIN = 2;
export const IDENTITY_NAME_MAX = 60;
export const IDENTITY_PURPOSE_MIN = 10;
export const IDENTITY_PURPOSE_MAX = 140;

export async function getCommunityIdentity(communityId: string): Promise<CommunityIdentity> {
  const { data, error } = await supabase
    .from('communities')
    .select('name, purpose')
    .eq('id', communityId)
    .single();
  if (error) throw error;
  return { name: data.name as string, purpose: (data.purpose as string | null) ?? null };
}

/** Leader-only via the existing communities_update RLS policy; no new grant needed. */
export async function updateCommunityIdentity(
  communityId: string,
  fields: { name: string; purpose: string },
): Promise<void> {
  const { error } = await supabase
    .from('communities')
    .update({ name: fields.name, purpose: fields.purpose })
    .eq('id', communityId);
  if (error) throw error;
}

// -- Link validation (Build 35 screen 36) ------------------------------------

export interface LinkUrlCheck {
  /** true for a blank field (not yet filled in) or a genuinely safe https link. */
  ok: boolean;
  /** the resolved destination host, shown back to the creator as a quiet confirmation. */
  host: string | null;
  problem: string | null;
}

/**
 * https-only, no embedded credentials -- same bar as
 * lib/tickets/creatorBrandContract.ts's validLogoUrl. These links render as
 * tappable destinations on the public page, so a malformed or unsafe one
 * must block save rather than publish silently.
 */
export function checkLinkUrl(url: string): LinkUrlCheck {
  const trimmed = url.trim();
  if (!trimmed) return { ok: true, host: null, problem: null };
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, host: null, problem: "that doesn't look like a real link" };
  }
  if (parsed.protocol !== 'https:') {
    return { ok: false, host: null, problem: 'links need to start with https://' };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, host: null, problem: 'that link is not safe to save' };
  }
  return { ok: true, host: parsed.hostname, problem: null };
}

/**
 * Pick, compress, and upload one image for a block. Returns the public URL,
 * or null on cancel / permission denial. Mirrors the proven circle-cover
 * path (ImagePicker -> ImageManipulator base64 -> storage upload).
 *
 * `aspect`, when given, turns on the OS-native crop/zoom/reposition step
 * (allowsEditing) locked to that ratio -- e.g. [4, 5] for a cover, matching
 * washedup-web's own locked 4:5 cover contract, or [1, 1] for a logo.
 * Omit it for a free-form crop (gallery photos). This is real crop/zoom/
 * reposition parity with web's CoverCropper, not the full nondestructive
 * contract (original preservation, rotation, focal point, variants) --
 * that piece is unbuilt anywhere and shared with screens 22/42/50 outside
 * this pass's scope.
 */
export async function pickAndUploadBlockImage(
  communityId: string,
  options?: { aspect?: [number, number] },
): Promise<string | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return null;
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 1,
    allowsEditing: true,
    aspect: options?.aspect,
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
