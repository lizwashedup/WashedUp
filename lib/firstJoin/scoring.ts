/**
 * First-join ranking: pure eligibility + scoring + ordering (spec a1).
 * No I/O in this file: everything takes plain data so it unit-tests
 * without the supabase client.
 */
import { isSameOrAdjacentNeighborhood } from './adjacency';
import type {
  FirstJoinCandidate,
  FirstJoinCreator,
  FirstJoinEventRow,
  FirstJoinScoreBreakdown,
  FirstJoinViewer,
} from './types';

// ─── Window ──────────────────────────────────────────────────────────────────

/** Candidates must start at least this far out (time to plan, no door-slam). */
export const WINDOW_MIN_HOURS = 12;
/** ...and no further out than this ("this week", not "someday"). */
export const WINDOW_MAX_DAYS = 10;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export function candidateWindow(now: Date): { startIso: string; endIso: string } {
  return {
    startIso: new Date(now.getTime() + WINDOW_MIN_HOURS * HOUR_MS).toISOString(),
    endIso: new Date(now.getTime() + WINDOW_MAX_DAYS * DAY_MS).toISOString(),
  };
}

// ─── Scoring weights (spec a1, tunable) ──────────────────────────────────────

export const WEIGHT_NEIGHBORHOOD = 3; // same or adjacent neighborhood
export const WEIGHT_LIKELIHOOD = 3; // likely to actually happen
export const WEIGHT_SOCIAL_PROOF = 2; // memberCount >= SOCIAL_PROOF_MIN
export const WEIGHT_BIG_ROOM = 2; // is_featured AND memberCount >= BIG_ROOM_MIN
export const WEIGHT_VIBE = 2; // primary_vibe in viewer's vibe_tags
export const WEIGHT_WEEKEND = 1; // starts Fri/Sat/Sun (LA clock)

export const SOCIAL_PROOF_MIN = 3;
export const BIG_ROOM_MIN = 6;

/** Statuses that count as an upcoming, joinable plan in this schema. */
const JOINABLE_STATUSES = new Set(['forming', 'active']);

// ─── Eligibility (spec a1 filter) ────────────────────────────────────────────

/** Age in whole years at `now`; null birthday passes every range (matches plan page). */
export function ageFromBirthday(birthday: string | null, now: Date): number | null {
  if (!birthday) return null;
  const b = new Date(`${birthday.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(b.getTime())) return null;
  let age = now.getUTCFullYear() - b.getUTCFullYear();
  const beforeBirthdayThisYear =
    now.getUTCMonth() < b.getUTCMonth() ||
    (now.getUTCMonth() === b.getUTCMonth() && now.getUTCDate() < b.getUTCDate());
  if (beforeBirthdayThisYear) age -= 1;
  return age;
}

/** Same rule set as the plan page gate; null viewer gender only passes mixed. */
export function passesGenderRule(
  rule: FirstJoinEventRow['gender_rule'],
  gender: FirstJoinViewer['gender'],
): boolean {
  if (rule === 'women_only') return gender === 'woman';
  if (rule === 'men_only') return gender === 'man';
  if (rule === 'nonbinary_only') return gender === 'non_binary';
  return true; // mixed / null
}

export function passesAgeRange(event: FirstJoinEventRow, age: number | null): boolean {
  if (age === null) return true;
  if (event.target_age_min !== null && age < event.target_age_min) return false;
  if (event.target_age_max !== null && age > event.target_age_max) return false;
  return true;
}

export interface EligibilityInput {
  event: FirstJoinEventRow;
  creator: FirstJoinCreator | null;
  /** Real joined count (event_members), already floored at 1. */
  memberCount: number;
  viewer: FirstJoinViewer;
  joinedEventIds: Set<string>;
  now: Date;
}

/**
 * A plan a first-timer can actually join and that will not strand them.
 * Every check here is also a unit-tested reason a plan drops out.
 */
export function isEligible({ event, creator, memberCount, viewer, joinedEventIds, now }: EligibilityInput): boolean {
  if (!JOINABLE_STATUSES.has(event.status)) return false;

  const start = new Date(event.start_time).getTime();
  if (Number.isNaN(start)) return false;
  if (start < now.getTime() + WINDOW_MIN_HOURS * HOUR_MS) return false;
  if (start > now.getTime() + WINDOW_MAX_DAYS * DAY_MS) return false;

  if (!passesGenderRule(event.gender_rule, viewer.gender)) return false;
  if (!passesAgeRange(event, ageFromBirthday(viewer.birthday, now))) return false;

  // Open capacity: null max_invites means uncapped.
  if (event.max_invites !== null && memberCount >= event.max_invites) return false;
  if (event.waitlist_closed === true) return false;

  // Never rank a plan that would strand them.
  if (event.invite_locked === true) return false;
  if (creator?.suspended_until && new Date(creator.suspended_until).getTime() > now.getTime()) return false;

  // Circle-only plans are invisible to strangers; a new user is a stranger.
  if (event.circle_visibility === 'circle_only') return false;

  // Their own plan, or one they already joined, is not a first-join candidate.
  if (event.creator_user_id && event.creator_user_id === viewer.id) return false;
  if (joinedEventIds.has(event.id)) return false;

  return true;
}

// ─── Match predicates (also drive the fallback tiers) ────────────────────────

export function vibeMatches(vibeTags: string[] | null, primaryVibe: string | null): boolean {
  if (!vibeTags?.length || !primaryVibe) return false;
  // primary_vibe casing is inconsistent on prod ("Music" vs "music").
  const wanted = primaryVibe.trim().toLowerCase();
  return vibeTags.some((t) => t.trim().toLowerCase() === wanted);
}

export const geoMatches = isSameOrAdjacentNeighborhood;

/** Fri/Sat/Sun on the LA clock: plans live on LA time regardless of device tz. */
export function startsOnLAWeekend(startTimeIso: string): boolean {
  const start = new Date(startTimeIso);
  if (Number.isNaN(start.getTime())) return false;
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'short',
  }).format(start);
  return weekday === 'Fri' || weekday === 'Sat' || weekday === 'Sun';
}

// ─── Score ───────────────────────────────────────────────────────────────────

export interface ScoreInput {
  event: FirstJoinEventRow;
  creator: FirstJoinCreator | null;
  memberCount: number;
  viewer: FirstJoinViewer;
}

export function scoreCandidate({ event, creator, memberCount, viewer }: ScoreInput): FirstJoinCandidate {
  const likelyToHappen =
    (event.min_invites !== null && memberCount >= event.min_invites) ||
    event.drop_in === true ||
    event.is_featured === true ||
    creator?.is_official_host === true;

  const bigRoom = event.is_featured === true && memberCount >= BIG_ROOM_MIN;

  const breakdown: FirstJoinScoreBreakdown = {
    neighborhood: geoMatches(viewer.neighborhood, event.neighborhood) ? WEIGHT_NEIGHBORHOOD : 0,
    likelihood: likelyToHappen ? WEIGHT_LIKELIHOOD : 0,
    socialProof: memberCount >= SOCIAL_PROOF_MIN ? WEIGHT_SOCIAL_PROOF : 0,
    bigRoom: bigRoom ? WEIGHT_BIG_ROOM : 0,
    vibe: vibeMatches(viewer.vibe_tags, event.primary_vibe) ? WEIGHT_VIBE : 0,
    weekend: startsOnLAWeekend(event.start_time) ? WEIGHT_WEEKEND : 0,
  };

  const score =
    breakdown.neighborhood +
    breakdown.likelihood +
    breakdown.socialProof +
    breakdown.bigRoom +
    breakdown.vibe +
    breakdown.weekend;

  return { event, creator, memberCount, score, breakdown, bigRoom };
}

// ─── Order ───────────────────────────────────────────────────────────────────

/**
 * Score desc, then soonest start, then id (deterministic). After sorting, the
 * best big-room candidate (is_featured AND memberCount >= 6) is promoted to
 * slot 1 when one exists: bigger rooms are better first rooms.
 */
export function rankCandidates(candidates: FirstJoinCandidate[]): FirstJoinCandidate[] {
  const sorted = [...candidates].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const startDiff = new Date(a.event.start_time).getTime() - new Date(b.event.start_time).getTime();
    if (startDiff !== 0) return startDiff;
    return a.event.id < b.event.id ? -1 : a.event.id > b.event.id ? 1 : 0;
  });

  const bigRoomIndex = sorted.findIndex((c) => c.bigRoom);
  if (bigRoomIndex > 0) {
    const [bigRoomCandidate] = sorted.splice(bigRoomIndex, 1);
    sorted.unshift(bigRoomCandidate);
  }
  return sorted;
}
