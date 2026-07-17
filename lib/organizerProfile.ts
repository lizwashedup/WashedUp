/**
 * The minimal organizer profile (proposal 36, Liz's addendum 2026-07-13).
 *
 * One persistent organizer identity per host, separate from the personal
 * profile (decision 15: listings front a brand/venue name). Four fields:
 * display name, optional logo, short bio, one link. It fronts STANDALONE
 * listings ("put on by [name]"); the per-event public_name stays as the
 * optional override, and community events keep fronting with the community.
 *
 * Explicitly NOT a platform: no /o/ page, no follow, no roster, no handle
 * (those graduate to the orgs track, doc 21).
 *
 * Until proposal 36 applies, the table does not exist: reads resolve to
 * null/empty here (the block-editor precedent) and the editor's save
 * surfaces a friendly error.
 */

import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Crypto from 'expo-crypto';
import { supabase } from './supabase';
import { uploadBase64ToStorage } from './uploadPhoto';

export interface OrganizerProfile {
  user_id: string;
  display_name: string;
  logo_url: string | null;
  bio: string | null;
  link_url: string | null;
}

const COLUMNS = 'user_id, display_name, logo_url, bio, link_url';

/** The signed-in creator's own profile; null when none (or pre-apply). */
export async function getMyOrganizerProfile(): Promise<OrganizerProfile | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('organizer_profiles')
    .select(COLUMNS)
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) return null;
  return (data as OrganizerProfile | null) ?? null;
}

/** Batch fetch for byline fronting; empty map on any error (pre-apply safe). */
export async function getOrganizerProfiles(userIds: string[]): Promise<Map<string, OrganizerProfile>> {
  const ids = Array.from(new Set(userIds.filter(Boolean)));
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase
    .from('organizer_profiles')
    .select(COLUMNS)
    .in('user_id', ids);
  if (error) return new Map();
  return new Map(((data ?? []) as OrganizerProfile[]).map((p) => [p.user_id, p]));
}

/** Owner upsert through RLS (world-readable row, creator-gated writes). */
export async function upsertOrganizerProfile(fields: {
  display_name: string;
  logo_url: string | null;
  bio: string | null;
  link_url: string | null;
}): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const { error } = await supabase.from('organizer_profiles').upsert({
    user_id: user.id,
    display_name: fields.display_name.trim().slice(0, 80),
    logo_url: fields.logo_url?.trim() || null,
    bio: fields.bio?.trim().slice(0, 280) || null,
    link_url: fields.link_url?.trim().slice(0, 300) || null,
  });
  if (error) throw error;
}

/**
 * Pick, square-crop-ish resize, and upload a logo. Rides the existing
 * event-images bucket under the uploader's uid folder (existing policy,
 * no new bucket). Returns the public URL or null on cancel.
 */
export async function pickAndUploadOrganizerLogo(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return null;
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 1,
    allowsEditing: true,
    aspect: [1, 1],
  });
  if (res.canceled || !res.assets?.[0]) return null;
  const manipulated = await ImageManipulator.manipulateAsync(
    res.assets[0].uri,
    [{ resize: { width: 600 } }],
    { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG, base64: true },
  );
  if (!manipulated.base64) return null;
  return uploadBase64ToStorage('event-images', `${user.id}/logo-${Crypto.randomUUID()}.jpg`, manipulated.base64);
}
