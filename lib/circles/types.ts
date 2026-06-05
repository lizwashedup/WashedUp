/**
 * Circles — client types.
 *
 * These mirror the jsonb shapes returned by the circle RPCs in
 * supabase/migrations/20260530220300_circles_rpcs.sql. The RPCs return jsonb
 * (already-parsed by PostgREST), so unlike the table-returning Yours RPCs these
 * need no row-shape assertion; the fields below match the SQL exactly.
 */

export type CircleRole = 'admin' | 'member';
export type CircleStatus = 'forming' | 'active' | 'archived';

/**
 * Who can add people to a circle (spec section 3, the role-based admin model):
 *   only_me  - the creator stays the sole admin (create_circle's default).
 *   chosen   - the creator picks specific members to also be admins.
 *   everyone - every member is an admin (the intentional network-extension
 *              mode: a member can add someone the creator doesn't know).
 */
export type CircleInvitePolicy = 'only_me' | 'chosen' | 'everyone';

export interface CreateCircleArgs {
  name: string;
  description: string | null;
  memberUserIds: string[];
  invitePolicy: CircleInvitePolicy;
  /** Members to promote to admin when invitePolicy === 'chosen'. */
  adminUserIds: string[];
}

/**
 * One row from `get_my_circles()` — a circle the caller has joined. Powers the
 * Yours > Circles directory.
 */
export interface MyCircle {
  id: string;
  name: string;
  description: string | null;
  cover_upload_id: string | null;
  status: CircleStatus;
  room_enabled: boolean;
  created_at: string;
  my_role: CircleRole;
  member_count: number;
  /** Newest message in the whole-circle chat, or null if it has none yet. */
  last_message_at: string | null;
}

/** A person inside a co-attendance suggestion (resolved by get_circle_suggestions). */
export interface SuggestionPerson {
  user_id: string;
  first_name_display: string | null;
  handle: string | null;
  profile_photo_url: string | null;
}

/** One pending co-attendance suggestion (spec section 3, "start a circle?"). */
export interface CircleSuggestion {
  id: string;
  suggested_user_ids: string[];
  shared_event_ids: string[];
  shared_count: number;
  created_at: string;
  people: SuggestionPerson[];
}

/** The full circles row, as embedded in `get_circle().circle`. */
export interface CircleDetail {
  id: string;
  name: string;
  description: string | null;
  creator_user_id: string | null;
  cover_upload_id: string | null;
  status: CircleStatus;
  room_enabled: boolean;
  created_at: string;
  updated_at: string;
}

/** One joined member, as embedded in `get_circle().members`. */
export interface CircleMember {
  user_id: string;
  role: CircleRole;
  joined_at: string;
  first_name_display: string | null;
  last_name: string | null;
  handle: string | null;
  profile_photo_url: string | null;
}

/**
 * The noticeboard payload from `get_circle()`. `pinned_plan` and
 * `recent_together` are stable extension points: the RPC returns them as
 * null / [] in v1 (wired in later steps), so the shape never has to change.
 */
export interface CirclePayload {
  circle: CircleDetail;
  members: CircleMember[];
  pinned_plan: unknown | null;
  recent_together: unknown[];
}
