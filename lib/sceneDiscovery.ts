import {eventCategories} from './eventCategories';
/**
 * Scene discovery data (doc 10 phase 5): the events feed and the
 * communities rail. Events are the world-readable Live explore_events rows
 * (the revive-not-rebuild pilot table); communities come from the
 * get_discoverable_communities aggregate (batch 15). The rail hides itself
 * when empty (Liz's call: no empty state, launch ships with communities).
 */

import { CREATOR_PAGES_ENABLED } from '../constants/FeatureFlags';
import { getPublishedCoverMediaIds } from './publishedPageCover';
import { supabase } from './supabase';
import { laWallTimeToUTC, getLADayParts } from './laDate';
import { getOrganizerProfiles } from './organizerProfile';
import { getLeaderCards } from './communityLeader';
import { checkPublishedPageScope, loadPublishedEventPageIdentities, type PublishedPageIdentity } from './publishedPageIdentity';
import type { PageImageScope } from './publishedPageCover';
import { eventPageIdentity } from './eventPageIdentity';

/**
 * When an event stops being "upcoming", mirroring proposal 28's S3 clock:
 * coalesce(end_time, start_time, end of the event_date day IN LA). Null for
 * rows with no date at all (they cannot be ranked;
 * C9 flags them for manual fix).
 */
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

export function applySceneFeedPolicy<T extends Pick<SceneEvent, 'event_date' | 'start_time' | 'end_time'>>(
  rows: readonly T[],
  nowMs = Date.now(),
): T[] {
  return rows
    .filter((event) => {
      const clock = eventClockMs(event);
      return clock === null || clock > nowMs;
    })
    .sort((a, b) => {
      const aClock = eventClockMs(a);
      const bClock = eventClockMs(b);
      if (aClock === null && bClock === null) return 0;
      if (aClock === null) return 1;
      if (bClock === null) return -1;
      return aClock - bClock;
    });
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
  venue_address?: string | null;
  category: string | null;
  categories?: string[] | null;
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
  // undefined preserves legacy attribution; null means a known page is unavailable.
  published_page?: PublishedPageIdentity | null;
}

/** Mirrors eventClockMs using the verified timestamptz/date columns, before paging. */
export function sceneUpcomingFilter(nowMs: number): string {
  const instant = new Date(nowMs).toISOString();
  const { y, m, d } = getLADayParts(nowMs);
  const day = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return `end_time.gt.${instant},and(end_time.is.null,start_time.gt.${instant}),and(end_time.is.null,start_time.is.null,or(event_date.gte.${day},event_date.is.null))`;
}

export async function getSceneEvents(includeCommunityEvents = false, scope?: PageImageScope): Promise<SceneEvent[]> {
  let pageScope = scope;
  if (CREATOR_PAGES_ENABLED) {
    if (!pageScope) {
      const session = await supabase.auth.getSession();
      if (session.error) throw session.error;
      pageScope = { userId: session.data.session?.user.id ?? null, isCurrent: () => true };
    }
    await checkPublishedPageScope(pageScope);
  }
  const nowMs = Date.now();
  const upcoming = sceneUpcomingFilter(nowMs);
  const rows: SceneEvent[] = [];
  let cursor: string | null = null;
  // Stable ID cursor avoids offset drift. Read to an empty page instead of
  // assuming a short page means completion (server caps may be lower than ours).
  while (true) {
    if (CREATOR_PAGES_ENABLED && pageScope) await checkPublishedPageScope(pageScope);
    let query = supabase
      .from('explore_events')
      .select('id, title, description, image_url, event_date, start_time, end_time, venue, venue_address, category, categories, ticket_price, external_url, public_name, community_id, host_user_id, latitude, longitude')
      .eq('status', 'Live').or(upcoming).order('id', { ascending: true }).limit(200);
    if (!includeCommunityEvents) query = query.is('community_id', null);
    if (cursor) query = query.gt('id', cursor);
    const { data, error } = await query;
    if (error) throw error;
    if (CREATOR_PAGES_ENABLED && pageScope) await checkPublishedPageScope(pageScope);
    const batch = (data ?? []) as SceneEvent[];
    if (!batch.length) break;
    for (const event of batch) {
      if (!event.id || (cursor !== null && event.id <= cursor)) throw new Error('Could not finish loading events. Please try again.');
      cursor = event.id;
      rows.push(event);
    }
  }
  // Past events roll off (the server cron catches up hourly; the feed never
  // waits for it) and the soonest upcoming event leads. Dateless rows sink
  // to the end: they cannot be ranked.
  let events = applySceneFeedPolicy(rows, nowMs);

  if (CREATOR_PAGES_ENABLED && pageScope) {
    const identities = await loadPublishedEventPageIdentities(events.map(event => event.id), pageScope);
    for (const event of events) event.published_page = eventPageIdentity(event, identities.get(event.id));
    // Manager access allows private editing, not inclusion in public discovery.
    events = events.filter(event => event.published_page !== null);
  }

  // proposal 36: standalone listings with no public_name override front
  // with the host's organizer profile (name for the byline, logo for the
  // corner chip). One batched read; on any error the map is empty and
  // bylines/chips simply stay off.
  const needsOrganizer = events.filter((e) => e.published_page === undefined && !e.community_id && !e.public_name && e.host_user_id);
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
  const communityEvents = events.filter((e) => e.community_id && (e.published_page === undefined || e.published_page?.kind === 'community'));
  if (communityEvents.length > 0) {
    const cards = await getLeaderCards(communityEvents.map((e) => e.community_id));
    for (const e of communityEvents) {
      e.leader_avatar_url = cards.get(e.community_id!)?.avatar_url ?? null;
    }
  }
  if (CREATOR_PAGES_ENABLED && pageScope) await checkPublishedPageScope(pageScope);
  return events;
}

export interface DiscoverableCommunity {
  discovery_area?: string | null;
  categories?: string[] | null;
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
  cover_media_id?: string | null;
  city?: string | null;
  member_count: number;
  next_event_title: string | null;
  next_event_date: string | null;
}

/**
 * The card-label grammar (Liz's law, 2026-07-15): a community event wears
 * "community"; a standalone listing wears its category; a community event
 * may ADD its category alongside the community label when the leader
 * picked one — "community · markets" — the leader's choice, never
 * required. One rule, every card.
 */
export function eventKickerLabel(e: {community_id?:string|null;category?:string|null;categories?:string[]|null}): string | null {
 return eventCategories(e).join(' · ') || null;
}

export async function getDiscoverableCommunities(scope?: PageImageScope): Promise<DiscoverableCommunity[]> {
  let pageScope = scope;
  if (CREATOR_PAGES_ENABLED && !pageScope) {
    const session = await supabase.auth.getSession();
    if (session.error) throw session.error;
    pageScope = { userId: session.data.session?.user.id ?? null, isCurrent: () => true };
  }
  const check = async () => { if (CREATOR_PAGES_ENABLED && pageScope) await checkPublishedPageScope(pageScope); };
  const rows: DiscoverableCommunity[] = [];
  const created = new Map<string, number>();
  let cursor: string | null = null;
  while (true) {
    await check();
    let query = supabase.rpc('get_discoverable_communities_v2').order('id', { ascending: true }).limit(100);
    if (cursor) query = query.gt('id', cursor);
    const { data, error } = await query;
    if (error) throw error;
    await check();
    const batch = (data ?? []) as DiscoverableCommunity[];
    if (!batch.length) break;
    for (const row of batch) {
      if (!row.id || (cursor !== null && row.id <= cursor)) throw new Error('Could not finish loading communities. Please try again.');
      cursor = row.id;
    }
    // Only enrich rows admitted by the existing public RPC, in bounded batches.
    const ids = batch.map(row => row.id);
    const cities = await supabase.from('communities').select('id,city,created_at').in('id', ids);
    if (cities.error) throw cities.error;
    await check();
    const byId = new Map<string, string | null>();
    for (const row of cities.data ?? []) {
      if (!ids.includes(row.id) || byId.has(row.id) || !(row.city === null || typeof row.city === 'string')) throw new Error('Could not read community locations.');
      byId.set(row.id, row.city);
      const time = Date.parse(row.created_at);
      if (!Number.isFinite(time)) throw new Error('Could not finish loading communities. Please try again.');
      created.set(row.id, time);
    }
    const covers = CREATOR_PAGES_ENABLED ? await getPublishedCoverMediaIds(ids) : null;
    await check();
    for (const row of batch) {
      // A row that ceased being readable during paging must not retain stale identity.
      if (!byId.has(row.id)) continue;
      rows.push({ ...row, city: byId.get(row.id) ?? null, ...(covers ? { cover_media_id: covers.get(row.id) ?? null } : {}) });
    }
  }
  await check();
  // Preserve discovery's established popularity, then oldest-page ordering.
  return rows.sort((a,b) => b.member_count - a.member_count || created.get(a.id)! - created.get(b.id)! || a.id.localeCompare(b.id));
}
