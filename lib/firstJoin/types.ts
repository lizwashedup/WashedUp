/**
 * First-join system, step 1: plan ranking service.
 *
 * Shapes for getFirstJoinCandidates (spec a1). The service only RETURNS
 * candidates; nothing here (or in any consumer) may auto-join a user to a
 * plan. Data access is injected via FirstJoinDeps so the ranking logic is
 * unit-testable without the supabase client; lib/firstJoin/index.ts wires
 * the real queries.
 */

export type FirstJoinTier = 'base' | 'wider_radius' | 'no_vibe';

export type ViewerGender = 'woman' | 'man' | 'non_binary' | null;

/** The new user we are ranking plans for. */
export interface FirstJoinViewer {
  id: string;
  neighborhood: string | null;
  vibe_tags: string[] | null;
  gender: ViewerGender;
  /** ISO date (profiles.birthday). Null passes every age range. */
  birthday: string | null;
}

/** Raw events row, only the columns the ranker needs. */
export interface FirstJoinEventRow {
  id: string;
  title: string;
  start_time: string;
  status: string;
  neighborhood: string | null;
  primary_vibe: string | null;
  gender_rule: 'mixed' | 'women_only' | 'men_only' | 'nonbinary_only' | null;
  target_age_min: number | null;
  target_age_max: number | null;
  max_invites: number | null;
  min_invites: number | null;
  /** Raw column value; drifts. The ranker uses the real joined count instead. */
  member_count: number | null;
  drop_in: boolean | null;
  is_featured: boolean | null;
  waitlist_closed: boolean | null;
  invite_locked: boolean | null;
  creator_user_id: string | null;
  image_url: string | null;
  location_text: string | null;
  slug: string | null;
  /** Only selected when GROUPS_ENABLED; circle_only plans are never candidates. */
  circle_visibility?: 'circle_only' | 'open' | null;
}

/** Creator profile fields needed for eligibility + likelihood scoring. */
export interface FirstJoinCreator {
  id: string;
  first_name_display: string | null;
  profile_photo_url: string | null;
  /** Internal DB flag name. Never surfaces in any user-facing copy. */
  is_official_host: boolean | null;
  suspended_until: string | null;
}

/** Per-weight contributions, logged so conversion per weight is measurable (spec a2). */
export interface FirstJoinScoreBreakdown {
  neighborhood: number;
  likelihood: number;
  socialProof: number;
  bigRoom: number;
  vibe: number;
  weekend: number;
}

export interface FirstJoinCandidate {
  event: FirstJoinEventRow;
  creator: FirstJoinCreator | null;
  /** Real joined count from event_members, floored at 1 (creator is a member). */
  memberCount: number;
  score: number;
  breakdown: FirstJoinScoreBreakdown;
  /** is_featured AND memberCount >= 6: takes card slot 1, carries the gold tag. */
  bigRoom: boolean;
}

export interface FirstJoinResult {
  candidates: FirstJoinCandidate[];
  /** Which fallback tier produced the list. */
  tier: FirstJoinTier;
  /** True only when every tier came back empty: show wishlist capture, never an error. */
  showWishlistPrompt: boolean;
}

/** Injected data access. lib/firstJoin/index.ts provides the supabase-backed set. */
export interface FirstJoinDeps {
  fetchViewer(userId: string): Promise<FirstJoinViewer | null>;
  fetchCandidateEvents(windowStartIso: string, windowEndIso: string): Promise<FirstJoinEventRow[]>;
  fetchCreators(creatorIds: string[]): Promise<FirstJoinCreator[]>;
  fetchRealMemberCounts(eventIds: string[]): Promise<Record<string, number>>;
  fetchJoinedEventIds(userId: string): Promise<string[]>;
  /** Clock, injectable for tests. */
  now(): Date;
}
