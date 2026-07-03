/**
 * Operator applications (creator platform, phase 2).
 *
 * Both application forms write one operator_grants row through the
 * submit_operator_application RPC. Question keys and all user-facing copy
 * come from Events_Communities/12-application-forms-draft.md; treat that
 * doc as the copy source of truth.
 */

import { supabase } from './supabase';

export type OperatorTrack = 'event_host' | 'community_leader';

export type OperatorGrantStatus =
  | 'applied'
  | 'in_review'
  | 'needs_more_info'
  | 'approved'
  | 'declined'
  | 'revoked';

export interface OperatorGrant {
  id: string;
  track: OperatorTrack;
  status: OperatorGrantStatus;
  application: Record<string, unknown>;
  /** Reviewer message to the applicant. Internal review notes are never fetched client-side. */
  applicant_message: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface Option {
  key: string;
  label: string;
}

// -- event host form options (doc 12 question keys) --------------------------

export const APPLICANT_TYPES: Option[] = [
  { key: 'just_me', label: 'just me, i throw things' },
  { key: 'producer_promoter', label: 'an event producer or promoter' },
  { key: 'venue', label: 'a venue' },
  { key: 'artist', label: 'an artist or performer' },
  { key: 'business_brand', label: 'a business or brand' },
  { key: 'other', label: 'something else' },
];

export const EVENT_CATEGORIES: Option[] = [
  { key: 'music', label: 'music' },
  { key: 'comedy', label: 'comedy' },
  { key: 'nightlife', label: 'nightlife' },
  { key: 'food_drink', label: 'food and drink' },
  { key: 'art', label: 'art' },
  { key: 'fitness_outdoors', label: 'fitness and outdoors' },
  { key: 'community', label: 'community' },
  { key: 'film', label: 'film' },
  { key: 'markets', label: 'markets' },
  { key: 'other', label: 'other' },
];

export const EVENT_FREQUENCIES: Option[] = [
  { key: 'one_off', label: 'one-off' },
  { key: 'few_per_year', label: 'a few times a year' },
  { key: 'monthly', label: 'monthly' },
  { key: 'weekly_plus', label: 'weekly or more' },
];

export const TICKETING_OPTIONS: Option[] = [
  { key: 'free', label: 'free events' },
  { key: 'other_site', label: 'ticketed on another site' },
  { key: 'both', label: 'both' },
  { key: 'first_time', label: 'first time selling' },
];

// -- community leader form options -------------------------------------------

export const COMMUNITY_CADENCES: Option[] = [
  { key: 'weekly', label: 'weekly' },
  { key: 'biweekly', label: 'every couple weeks' },
  { key: 'monthly', label: 'monthly' },
  { key: 'other', label: 'other' },
];

// -- data access --------------------------------------------------------------

export async function fetchMyGrants(): Promise<OperatorGrant[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('operator_grants')
    .select('id, track, status, application, applicant_message, reviewed_at, created_at')
    .eq('user_id', user.id);
  if (error) throw error;
  return (data ?? []) as OperatorGrant[];
}

export async function submitApplication(
  track: OperatorTrack,
  application: Record<string, unknown>,
): Promise<string> {
  const { data, error } = await supabase.rpc('submit_operator_application', {
    p_track: track,
    p_application: application,
    p_accept_terms: true,
  });
  if (error) throw error;
  return data as string;
}

/** Shared confirmation copy (doc 12). */
export const CONFIRMATION_TITLE = 'got it';
export const CONFIRMATION_BODY = "a real person is reading this, you'll hear from us within a day.";
