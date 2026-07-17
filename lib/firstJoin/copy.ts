/**
 * Every user-facing string on the first-join surfaces lives here so Voice QA
 * can lint one file (spec b5).
 *
 * Voice rules (spec b4, non-negotiable): lowercase, no exclamation points,
 * no em dashes, none of counsel's banned relationship words (spec b4 lists
 * them), never "curated", never an outcome
 * promise. The only permitted claims are database facts the send/render time
 * can verify: "{n} going", "{n} spots left", "past the minimum",
 * "biggest plan this week".
 */

export const FIRST_JOIN_COPY = {
  // ── FirstJoinPlanCard ──────────────────────────────────────────────────────
  // Cut by founder decision (7-16): the big-room tag and the "past the
  // minimum" pill. The "{n} going" number carries the proof.
  /** Creator row: "sofia's plan". Name is lowercased at render. */
  creatorPlan: (firstName: string) => `${firstName}'s plan`,
  /** Facts row count. Always true at render time (real event_members count). */
  going: (n: number) => `${n} going`,
  /** Gold pill. Only rendered when spots left <= 3 AND past the minimum (honest scarcity). */
  spotsLeft: (n: number) => (n === 1 ? '1 spot left' : `${n} spots left`),
  /** Primary CTA. Going somewhere together, never "join event". Navigates, never joins. */
  letsGo: "let's go",

  // ── YourFirstWeek screen ───────────────────────────────────────────────────
  headline: 'your first week',
  subline: "three things happening near you. tap one, show up, that's it.",
  /** Screen-level caption under the cards; names the real fear, states a norm. */
  psCaption: "ps. most people come alone. that's the point.",
  /** Text-only wishlist capture button under the cards. */
  wishlistPrompt: 'tell me when something opens near me',
  /** Small skip link under the wishlist link. Never block. */
  later: 'later',

  // ── Empty / fallback state ─────────────────────────────────────────────────
  emptyBody: 'plans near you are filling up. want a tap on the shoulder when one opens?',
  /** Single terracotta button on the empty state: same wishlist capture action. */
  emptyCta: 'tell me when something opens near me',

  // ── Wishlist confirmation screen ───────────────────────────────────────────
  confirmHeadline: "you're on the list",
  confirmSubline: "we'll tap you on the shoulder when something opens near you.",
  /** Section label on the "watching for" card. */
  watchingFor: 'watching for',
  /** Chip next to the neighborhood name. */
  nearby: 'nearby',
  /** Fallback when the profile has no neighborhood. */
  watchingAnywhere: 'anywhere in la',
  editPreferences: 'edit preferences',
  confirmCta: 'take me to scene',
  confirmFooter: 'you can change this anytime in notifications',

  // ── Wishlist save failure (facts only: never confirm an unsaved list) ──────
  saveFailedTitle: "couldn't save that",
  saveFailedBody: 'something went wrong on our end. try again in a moment.',
  saveFailedOk: 'ok',
} as const;
