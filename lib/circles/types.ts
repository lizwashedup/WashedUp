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
