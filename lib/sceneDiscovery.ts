/**
 * Scene discovery data (doc 10 phase 5): the events feed and the
 * communities rail. Events are the world-readable Live explore_events rows
 * (the revive-not-rebuild pilot table); communities come from the
 * get_discoverable_communities aggregate (batch 15). The rail hides itself
 * when empty (Liz's call: no empty state, launch ships with communities).
 */

import { supabase } from './supabase';
import { laWallTimeToUTC } from './laDate';

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
  // proposal 35: the organizer's place-picker pin, null on legacy rows
  latitude: number | null;
  longitude: number | null;
}

export async function getSceneEvents(): Promise<SceneEvent[]> {
  const { data, error } = await supabase
    .from('explore_events')
    .select('id, title, description, image_url, event_date, start_time, end_time, venue, category, ticket_price, external_url, public_name, community_id, latitude, longitude')
    .eq('status', 'Live')
    .limit(60);
  if (error) throw error;
  const now = Date.now();
  // Past events roll off (the server cron catches up hourly; the feed never
  // waits for it) and the soonest upcoming event leads. Dateless rows sink
  // to the end: they cannot be ranked.
  return ((data ?? []) as SceneEvent[])
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
}

export interface DiscoverableCommunity {
  id: string;
  handle: string;
  name: string;
  description: string | null;
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
