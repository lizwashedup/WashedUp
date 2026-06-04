/**
 * Yours page — single source for animation timings, sim-eyeball tuning
 * constants, and all user-facing copy.
 *
 * SIM-EYEBALL items are the four things flagged for on-device tuning:
 *   #1 ring colors (mid states)        -> RING_COLORS
 *   #2 ping inline auto-fade duration  -> PING_AUTOFADE_MS
 *   #3 in-context copy gut-check       -> COPY (marked inline)
 *   #4 header "+" vs bottom-nav "+"    -> YOURS_HEADER_ACTION
 *
 * Copy rule: no em/en dashes as connectors anywhere user-facing. Use
 * commas, periods, or "to".
 */
import Colors from '../../../constants/Colors';
import type { RingBucket } from '../../../lib/yours/types';

// ── Animation (durations ms / spring) — from the design vision table ───────
export const ANIM = {
  sheetInMs: 300,
  sheetOutMs: 250,
  ringDrawMs: 600,
  welcomeFadeMs: 300,
  ghostCrossfadeMs: 400,
  ghostRingDrawMs: 600,
  avatarSelectMs: 200,
  pingConfirmMs: 400,
  shimmerCycleMs: 2000,
  cardFlyMs: 450,
  cardSnapBackMs: 300,
} as const;

export const SWIPE = {
  maxRotateDeg: 8,
  thresholdRatio: 0.4,
  springDamping: 0.7,
} as const;

// ── SIM-EYEBALL #1 — activity ring colors ─────────────────────────────────
// Per spec golden amber is reserved for featured/urgency; mid states use
// terracotta opacities. Eyeball on device that 50/75 read as "ring".
export const RING_COLORS: Record<RingBucket, string | null> = {
  full: Colors.ringFull,
  '75': Colors.ringHigh,
  '50': Colors.ringMid,
  '25': Colors.ringLow,
  none: null,
};
export const RING_GHOST_COLOR = Colors.ringGhost;

export const RING_FRACTION: Record<RingBucket, number> = {
  full: 1,
  '75': 0.75,
  '50': 0.5,
  '25': 0.25,
  none: 0,
};

export const RING_A11Y_LABEL: Record<RingBucket, string> = {
  full: 'Active in the last 2 weeks',
  '75': 'Active in the last month',
  '50': 'Active in the last 2 months',
  '25': 'Active a few months ago',
  none: 'No shared plans yet',
};

// ── SIM-EYEBALL #2 — ping inline auto-fade ────────────────────────────────
// Spec flags this as possibly too fast. Tune on device.
export const PING_AUTOFADE_MS = 8000;

// ── SIM-EYEBALL #4 — header action button style ───────────────────────────
// 'fill' = solid terracotta 32pt (matches "+ is terracotta" rule).
// 'outline' = terracotta 1.5px ring, de-conflicts from the solid 48pt
// bottom-nav "+". Leaning 'outline'; resolve on device.
export const YOURS_HEADER_ACTION: 'fill' | 'outline' = 'outline';

// ── Copy ──────────────────────────────────────────────────────────────────
export const COPY = {
  wordmark: 'yours',
  tabPeople: 'Your People',
  tabAlbums: 'Albums',

  // SIM-EYEBALL #3: request banner phrasing
  requestBannerOne: 'Someone wants to join yours',
  requestBannerMany: (n: number) => `${n} people want to join yours`,

  requestAdd: 'Add them',
  requestNotNow: 'Not now',
  // SIM-EYEBALL #3: block prompt
  blockPromptTitle: (name: string) => `Want to block ${name} too?`,
  blockPromptBlock: 'Block',
  blockPromptKeep: "No, I'm good",

  freshTitle: 'We rebuilt this from scratch.',
  freshTitle2: "It's better now.",
  freshSub: "Here are the people you've already done stuff with. Add the ones you want to keep.",
  freshCardPlansLabel: 'people from your plans',
  freshCardInviteTitle: 'know someone who wants to get out more?',
  freshCardInviteSub: 'invite them to washedup',

  emptyTitle: 'This is where your people live.',
  emptySub: 'Do a plan, then decide who stays.',
  nearbyHeader: "What's happening near you",
  inviteCardTitle: 'know someone who wants to get out more?',
  inviteCardSub: 'invite them to washedup',

  // SIM-EYEBALL #3: + sheet path labels
  pathPlansTitle: "People you've already done stuff with",
  pathPlansCount: (n: number) =>
    n === 1 ? '1 person' : `${n} people`,
  pathInviteTitle: 'Text someone a link',
  pathInviteSub: 'They show up here when they join',
  pathSearchTitle: 'Find by handle',
  handleLookupEmpty: 'No match for that handle. Double-check the spelling.',
  pathQRTitle: 'Show your code',
  pathQRSub: 'Let someone scan to add you',

  backlogPlansTogether: (n: number) =>
    n === 1 ? '1 plan together' : `${n} plans together`,
  stateRequested: 'Requested',
  addButton: 'Add',

  profileInviteToPlan: 'Invite to a plan',
  profileComingUp: 'Coming up',
  profileAdventures: 'Your adventures',
  profileRemove: 'Remove from your people',
  // SIM-EYEBALL #3: remove confirmation
  removeConfirm:
    "They won't be notified. You'll quietly be removed from each other's people.",
  privacyToggle: (name: string) => `Hide my upcoming plans from ${name}`,

  pingPrompt: 'Let your people know',
  pingButton: 'Ping them',
  pingSheetPrompt: 'Who should know about this',
  pingSeeAll: 'See all',

  surveyHow: 'How was it?',
  surveyGood: 'Really good',
  surveyFine: 'It was fine',
  surveyBad: 'Not great',
  surveyBadFollowup: 'Want to tell us what happened?',
  surveyWhoMadeIt: 'Who made it?',
  surveyDidntMakeIt: "Didn't make it",
  surveyNext: 'Next',
  surveyAddPrompt: 'You did something together. They might be your people.',
  surveyAddButton: 'Add them',
  surveySkip: 'Skip',

  albumOpenFailed: "This album didn't open. Try again in a moment.",
  albumRetry: 'Try again',
  albumCollecting: 'Collecting photos',
  albumAddYours: 'Add yours',
  albumAddYoursBanner: 'Looking back on these will be fun. Add yours.',

  // ── People hub search (find the people you already have) ───────────────
  searchPlaceholder: 'Search your people, or a handle',
  searchYoursSection: 'in your people',
  searchNewSection: 'not in your people',
  searchNoResults: 'No one by that name.',
  searchNoResultsSub: 'Search a full handle to find someone new.',

  // ── "you & [name]" keep page (the relationship view) ───────────────────
  // Lexicon: never "friend"/"friendship". The page is "you & [name]" and
  // the framing word is "kept". No em/en dashes; commas or "to".
  keepBack: 'Back',
  keepMore: 'More',
  // Hero. "you and [name]" renders [name] in terracotta display italic.
  keepYouAnd: 'you and',
  keepSince: (dateLabel: string) => `kept since ${dateLabel}`,
  // Duration suffix, e.g. "two months in". Empty when too new to bother.
  keepDuration: (durLabel: string) => `${durLabel} in`,
  // Stat row labels (the big number sits above each).
  keepStatPlans: 'plans together',
  keepStatAlbums: 'albums shared',
  keepStatComingUp: 'coming up',
  // Actions. Ping only shows when there is an upcoming shared plan to ping
  // about (ping_person is event-anchored). Invite always shows.
  keepPing: 'ping',
  keepInvite: 'invite to a plan',
  keepPingSent: (name: string) => `${name} knows about it.`,
  // Section labels.
  keepComingUpTogether: 'coming up together',
  keepStorySoFar: 'your story so far',
  // Timeline. The oldest shared plan is marked as the beginning.
  keepFirstPlan: 'first plan',
  keepTheBeginning: 'the beginning',
  // Connected but no album-backed shared plans yet.
  keepStoryEmpty: 'Your story is just getting started.',
  keepStoryEmptySub: (name: string) => `Invite ${name} to something.`,
  // Closing whisper at the foot of the page.
  keepClosing: 'Quietly building, one plan at a time.',
} as const;
