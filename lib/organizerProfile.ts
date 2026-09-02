/**
 * The minimal organizer profile (proposal 36, Liz's addendum 2026-07-13).
 *
 * One persistent organizer identity per host, separate from the personal
 * profile (decision 15: listings front a brand/venue name). Four fields:
 * display name, optional logo, short bio, one link. It fronts STANDALONE
 * listings ("put on by [name]"); the per-event public_name stays as the
 * optional override, and community events keep fronting with the community.
 *
 * SUPERSEDED note (Scene handoff, WashedUp_The_Scene_User_Facing_Implementation
 * _Handoff.pdf §12, 2026-09-01): this file's original header said "explicitly
 * NOT a platform: no /o/ page, no follow, no roster, no handle." Follow
 * already shipped (lib/organizerFollows.ts, proposal 68) and the public page
 * ships in this same build (app/organization/[id].tsx, getOrganizationPage
 * below) - both were "the orgs track" this comment once deferred. No roster
 * and no handle are still correct; only those two remain deferred.
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
import { getTodayInLA } from './laDate';

export interface OrganizerProfile {
  user_id: string;
  display_name: string;
  logo_url: string | null;
  bio: string | null;
  link_url: string | null;
  /**
   * Self-flipping companion column (see getOrganizerCity below) - null
   * until supabase/migrations/20260901130000_organizer_profile_city.sql
   * (DRAFT) is applied, or simply unset. Never fetched by the batch byline
   * lookup (getOrganizerProfiles): only the owner's own editor and the
   * public organization page need it.
   */
  city: string | null;
}

const COLUMNS = 'user_id, display_name, logo_url, bio, link_url';

/**
 * The city column lives on its own isolated select/update, same technique
 * as lib/creatorMode.ts's getCommunityDiscoverable/getJoinPolicy: a 42703
 * (column not applied yet) can only ever affect this one field, never the
 * four-field profile fetch/save above it.
 */
export async function getOrganizerCity(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('organizer_profiles')
    .select('city')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return null; // column absent (42703) or unreadable = dormant
  const v = (data as { city?: unknown }).city;
  return typeof v === 'string' && v.trim() ? v : null;
}

/** Owner-only by the existing organizer_profiles_update RLS policy. */
export async function setOrganizerCity(city: string | null): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { error, count } = await supabase
    .from('organizer_profiles')
    .update({ city: city?.trim().slice(0, 60) || null }, { count: 'exact' })
    .eq('user_id', user.id);
  return !error && !!count;
}

/** The signed-in creator's own profile; null when none (or pre-apply). */
export async function getMyOrganizerProfile(): Promise<OrganizerProfile | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const [{ data, error }, city] = await Promise.all([
    supabase.from('organizer_profiles').select(COLUMNS).eq('user_id', user.id).maybeSingle(),
    getOrganizerCity(user.id),
  ]);
  if (error || !data) return null;
  return { ...(data as OrganizerProfile), city };
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
  // city is never part of COLUMNS here (see the field's doc comment) - fill
  // it in explicitly so every OrganizerProfile this module hands out has the
  // same real shape, never a silently-missing property.
  return new Map(
    ((data ?? []) as OrganizerProfile[]).map((p) => [p.user_id, { ...p, city: null }]),
  );
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

// -- Public organization profile page (Scene handoff §12/13/16/17) -----------

/**
 * "Organization" events only: standalone (no community_id) events hosted by
 * this user. A community's own events front with the community, never with
 * an organizer profile (the proposal-36 fronting split), so they're excluded
 * here even when this same user also leads that community.
 */
export interface OrganizationPageEvent {
  id: string;
  title: string;
  event_date: string | null;
  venue: string | null;
  image_url: string | null;
  category: string | null;
  ticket_price: number | string | null;
}

export interface OrganizationPageData {
  profile: OrganizerProfile;
  upcomingEvents: OrganizationPageEvent[];
  pastEvents: OrganizationPageEvent[];
}

const ORG_EVENT_COLUMNS = 'id, title, event_date, venue, image_url, category, ticket_price';
const ORG_UPCOMING_LIMIT = 30;
const ORG_PAST_LIMIT = 10;

/** YYYY-MM-DD anchored to LA "today" - same shape as the local helper already duplicated in app/event/[id].tsx. */
function laTodayIsoDate(): string {
  const t = getTodayInLA();
  return `${t.y}-${String(t.m + 1).padStart(2, '0')}-${String(t.d).padStart(2, '0')}`;
}

/**
 * The public organization profile (Scene handoff §12: name/logo/city/bio,
 * follow, upcoming + past events - the "new surface" §16 found no complete
 * equivalent for). Null = no saved organizer_profiles row for this id: a
 * bad/stale link, or an approved operator who has never opened the editor.
 * In normal use that second case is unreachable through the app's own tap
 * target - app/event/[id].tsx only renders the tappable identity once
 * bylineName (the organizer's own display_name) is non-empty - so null here
 * is effectively "not a real link." The caller renders a plain not-found
 * state, the same shape as lib/communityPage.ts's getCommunityPage().
 *
 * Past events read through the same RLS "Anyone can view live explore
 * events" policy the rest of the app already reads through: status='Live'
 * carries no date condition, so an ended-but-still-Live event stays public;
 * status='Completed' is owner-read only today (a real, logged gap - see
 * lib/creatorMode.ts's phase-5 note - not something this page can fix by
 * itself). Never guaranteed, never fabricated: an empty past section is
 * "nothing to show," not an error, the same self-flipping shape as every
 * other read in this module.
 */
export async function getOrganizationPage(organizerId: string): Promise<OrganizationPageData | null> {
  const { data: row, error } = await supabase
    .from('organizer_profiles')
    .select(COLUMNS)
    .eq('user_id', organizerId)
    .maybeSingle();
  if (error || !row) return null;

  const today = laTodayIsoDate();
  const [{ data: upcoming }, { data: past }, city] = await Promise.all([
    supabase
      .from('explore_events')
      .select(ORG_EVENT_COLUMNS)
      .eq('host_user_id', organizerId)
      .is('community_id', null)
      .eq('status', 'Live')
      .gte('event_date', today)
      .order('event_date', { ascending: true })
      .limit(ORG_UPCOMING_LIMIT),
    supabase
      .from('explore_events')
      .select(ORG_EVENT_COLUMNS)
      .eq('host_user_id', organizerId)
      .is('community_id', null)
      .in('status', ['Live', 'Completed'])
      .lt('event_date', today)
      .order('event_date', { ascending: false })
      .limit(ORG_PAST_LIMIT),
    getOrganizerCity(organizerId),
  ]);

  return {
    profile: { ...(row as OrganizerProfile), city },
    upcomingEvents: (upcoming ?? []) as OrganizationPageEvent[],
    pastEvents: (past ?? []) as OrganizationPageEvent[],
  };
}
