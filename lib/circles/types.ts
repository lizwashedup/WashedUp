/**
 * Circles - client types.
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
  /** Optional cover photo (compressed base64); uploaded after the circle exists. */
  coverBase64?: string | null;
}

/**
 * One row from `get_my_circles()` - a circle the caller has joined. Powers the
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
  /**
   * Client-resolved title for an UNNAMED circle (name=''), set by useMyCircles
   * from the other members' names so the directory never shows a blank row.
   * Undefined for named circles (use `name`).
   */
  display_name?: string;
}

/**
 * One member preview for a directory card's overlapping-avatar row. Batch-resolved
 * client-side by useCircleMemberPreviews (get_my_circles returns no member faces).
 */
export interface MemberPreview {
  user_id: string;
  name: string | null;
  photo_url: string | null;
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
 * The next upcoming circle plan, as embedded in `get_circle().pinned_plan`
 * (backend batch 3). `circle_size` is the joined-member count; `circle_in_count`
 * is how many of those members are already on the plan. Together they drive the
 * "{filled} of {size} in" capacity line. Note: the payload carries no
 * visibility / stranger_cap, so the open-plan "up to N others welcome" line is
 * derived by matching this id against the useCirclePlans row.
 */
export interface PinnedPlan {
  id: string;
  title: string;
  start_time: string;
  image_url: string | null;
  circle_size: number;
  circle_in_count: number;
}

/**
 * One recent shared photo, as embedded in `get_circle().recent_together`
 * (backend batch 3, cap 9, newest first). `media_path` is an album-media storage
 * path (needs a signed URL, see useSignedAlbumUrls). The newest row is the living
 * cover source when no manual cover is set. NOTE: the shipped RPC returns
 * individual photos, not plan-grouped "{title} · {n} photos" album rows.
 */
export interface RecentTogetherPhoto {
  upload_id: string;
  media_path: string;
  content_type: string;
  created_at: string;
  user_id: string;
  first_name_display: string | null;
  profile_photo_url: string | null;
}

/**
 * The noticeboard payload from `get_circle()`. `pinned_plan` and
 * `recent_together` are hydrated as of backend batch 3 (null / [] when the
 * circle has no upcoming plan / no shared photos yet).
 */
export interface CirclePayload {
  circle: CircleDetail;
  members: CircleMember[];
  pinned_plan: PinnedPlan | null;
  recent_together: RecentTogetherPhoto[];
}
