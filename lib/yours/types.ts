/**
 * Yours page — typed data layer.
 *
 * Shapes mirror the RPC return columns in supabase/migrations/20260517*
 * exactly (PostgREST returns snake_case). Built against the agreed schema;
 * the backing migrations are review-only and not yet applied.
 */

export type RingBucket = 'full' | '75' | '50' | '25' | 'none';

export type ConnectionContext = 'plan_history' | 'handle_lookup' | 'referral_invite';

/** State of a person row inside the plan-history backlog list. */
export type BacklogState = 'none' | 'requested';

/** State of a person row inside global search. */
export type SearchConnectionState =
  | 'none'
  | 'requested'
  | 'incoming'
  | 'connected';

export type ProfileCardKind = 'full' | 'minimal';

/** get_yours_grid row. */
export interface YoursGridPerson {
  user_id: string;
  first_name_display: string | null;
  profile_photo_url: string | null;
  handle: string | null;
  ring_bucket: RingBucket;
  shared_count: number;
  milestone: string | null;
  upcoming_event_id: string | null;
  upcoming_title: string | null;
  upcoming_start: string | null;
  connected_at: string;
}

/** get_plan_history_backlog row. */
export interface BacklogPerson {
  user_id: string;
  first_name_display: string | null;
  profile_photo_url: string | null;
  handle: string | null;
  shared_count: number;
  state: BacklogState;
}

/** search_people row. */
export interface SearchPerson {
  user_id: string;
  first_name_display: string | null;
  profile_photo_url: string | null;
  handle: string | null;
  shared_count: number;
  connection_state: SearchConnectionState;
}

/** get_incoming_people_requests row. */
export interface IncomingRequest {
  connection_id: string;
  requester_user_id: string;
  first_name_display: string | null;
  profile_photo_url: string | null;
  handle: string | null;
  context: ConnectionContext;
  context_event_id: string | null;
  context_event_title: string | null;
  context_line: string;
  requested_at: string;
}

export interface ProfileCardUpcoming {
  event_id: string;
  title: string;
  start_time: string;
}

export interface ProfileCardAdventure {
  album_id: string;
  event_id: string;
  title: string;
  date: string;
  thumb_url: string | null;
}

/** get_person_profile upcoming row (viewer-visible, neighborhood-level place). */
export interface PersonProfileUpcoming {
  event_id: string;
  title: string;
  start_time: string;
  neighborhood: string | null;
}

/** get_person_profile past row (date + title only). */
export interface PersonProfilePast {
  event_id: string;
  title: string;
  date: string;
}

/**
 * get_person_profile payload (the individual profile page, "just {name}").
 * The RPC returns a single jsonb object, or NULL for a non-mutual / blocked
 * viewer (the page's not-found state). No albums (those are keep-page only).
 */
export interface PersonProfile {
  user_id: string;
  first_name_display: string | null;
  profile_photo_url: string | null;
  handle: string | null;
  upcoming: PersonProfileUpcoming[];
  upcoming_count: number;
  past: PersonProfilePast[];
  past_total: number;
}

/** get_profile_card row. upcoming/adventures/since_date null when minimal. */
export interface ProfileCard {
  kind: ProfileCardKind;
  user_id: string;
  first_name_display: string | null;
  profile_photo_url: string | null;
  handle: string | null;
  shared_count: number;
  milestone: string | null;
  since_date: string | null;
  upcoming: ProfileCardUpcoming[] | null;
  adventures: ProfileCardAdventure[] | null;
}
