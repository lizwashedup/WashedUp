/**
 * Scene discovery data (doc 10 phase 5): the events feed and the
 * communities rail. Events are the world-readable Live explore_events rows
 * (the revive-not-rebuild pilot table); communities come from the
 * get_discoverable_communities aggregate (batch 15). The rail hides itself
 * when empty (Liz's call: no empty state, launch ships with communities).
 */

import { supabase } from './supabase';
import { laWallTimeToUTC } from './laDate';
import { getOrganizerProfiles } from './organizerProfile';
import { getLeaderCards } from './communityLeader';

/**
 * When an event stops being "upcoming", mirroring proposal 28's S3 clock:
 * coalesce(end_time, start_time, end of the event_date day IN LA) plus a
 * 6 hour grace. Null for rows with no date at all (they cannot be ranked;
 * C9 flags them for manual fix).
 */
const ROLL_OFF_GRACE_MS = 6 * 60 * 60 * 1000;

function eventClockMs(e: Pick<SceneEvent, 'event_date' | 'start_time'> & { end_time?: string | null }): number | null {
  if (e.end_time) {
    const t = Date.parse(e.end_time);
    if (!isNaN(t)) return t;
  }
  if (e.start_time) {
    const t = Date.parse(e.start_time);
    if (!isNaN(t)) return t;
  }
  if (e.event_date) {
    const m = e.event_date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    // midnight LA after the event day, never the UTC cast (the LA-date bug family)
    if (m) return laWallTimeToUTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1, 0, 0).getTime();
  }
  return null;
}

export interface SceneEvent {
  id: string;
  title: string;
  description: string | null;
  image_url: string | null;
  event_date: string | null;
  start_time: string | null;
  end_time: string | null;
  venue: string | null;
  category: string | null;
  ticket_price: number | null;
  external_url: string | null;
  public_name: string | null;
  community_id: string | null;
  host_user_id: string | null;
  // proposal 35: the organizer's place-picker pin, null on legacy rows
  latitude: number | null;
  longitude: number | null;
  // proposal 36: byline fallback for standalone listings with no
  // public_name override; resolved here, one batched read
  organizer_name?: string | null;
  // the people-first pack corner chip, one grammar: person = face
  // (community events, via the proposal-41 leader card), business = logo
  // (standalone via the organizer profile). Never both; a public_name
  // override means a different brand, so no chip at all then.
  organizer_logo?: string | null;
  leader_avatar_url?: string | null;
}

export async function getSceneEvents(): Promise<SceneEvent[]> {
  const { data, error } = await supabase
    .from('explore_events')
    .select('id, title, description, image_url, event_date, start_time, end_time, venue, category, ticket_price, external_url, public_name, community_id, host_user_id, latitude, longitude')
    .eq('status', 'Live')
    .limit(60);
  if (error) throw error;
  const now = Date.now();
  // Past events roll off (the server cron catches up hourly; the feed never
  // waits for it) and the soonest upcoming event leads. Dateless rows sink
  // to the end: they cannot be ranked.
  const events = ((data ?? []) as SceneEvent[])
    .filter((e) => {
      const clock = eventClockMs(e);
      return clock === null || clock > now - ROLL_OFF_GRACE_MS;
    })
    .sort((a, b) => {
      const ca = eventClockMs(a);
      const cb = eventClockMs(b);
      if (ca === null && cb === null) return 0;
      if (ca === null) return 1;
      if (cb === null) return -1;
      return ca - cb;
    });

  // proposal 36: standalone listings with no public_name override front
  // with the host's organizer profile (name for the byline, logo for the
  // corner chip). One batched read; on any error the map is empty and
  // bylines/chips simply stay off.
  const needsOrganizer = events.filter((e) => !e.community_id && !e.public_name && e.host_user_id);
  if (needsOrganizer.length > 0) {
    const profiles = await getOrganizerProfiles(needsOrganizer.map((e) => e.host_user_id!));
    for (const e of needsOrganizer) {
      const p = profiles.get(e.host_user_id!);
      e.organizer_name = p?.display_name ?? null;
      e.organizer_logo = p?.logo_url ?? null;
    }
  }

  // the people-first pack: community events wear the leader's face as the
  // corner chip (proposal 41, live-resolved). Same graceful degrade.
  const communityEvents = events.filter((e) => e.community_id);
  if (communityEvents.length > 0) {
    const cards = await getLeaderCards(communityEvents.map((e) => e.community_id));
    for (const e of communityEvents) {
      e.leader_avatar_url = cards.get(e.community_id!)?.avatar_url ?? null;
    }
  }
  return events;
}

export interface DiscoverableCommunity {
  id: string;
  handle: string;
  name: string;
  description: string | null;
  // proposal 46: the creator's one-line card message; absent until 46
  // applies, when the discovery RPC starts returning it (self-flipping —
  // the card falls back to the trimmed description meanwhile)
  tagline?: string | null;
  accent_color: string | null;
  cover_image: string | null;
  member_count: number;
  next_event_title: string | null;
  next_event_date: string | null;
}

export async function getDiscoverableCommunities(): Promise<DiscoverableCommunity[]> {
  const { data, error } = await supabase.rpc('get_discoverable_communities');
  if (error) throw error;
  return (data ?? []) as DiscoverableCommunity[];
}
