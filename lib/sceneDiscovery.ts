/**
 * Scene discovery data (doc 10 phase 5): the events feed and the
 * communities rail. Events are the world-readable Live explore_events rows
 * (the revive-not-rebuild pilot table); communities come from the
 * get_discoverable_communities aggregate (batch 15). The rail hides itself
 * when empty (Liz's call: no empty state, launch ships with communities).
 */

import { supabase } from './supabase';

export interface SceneEvent {
  id: string;
  title: string;
  description: string | null;
  image_url: string | null;
  event_date: string | null;
  start_time: string | null;
  venue: string | null;
  category: string | null;
  ticket_price: number | null;
  external_url: string | null;
  public_name: string | null;
  community_id: string | null;
}

export async function getSceneEvents(): Promise<SceneEvent[]> {
  const { data, error } = await supabase
    .from('explore_events')
    .select('id, title, description, image_url, event_date, start_time, venue, category, ticket_price, external_url, public_name, community_id')
    .eq('status', 'Live')
    .order('event_date', { ascending: true, nullsFirst: false })
    .limit(60);
  if (error) throw error;
  return (data ?? []) as SceneEvent[];
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
