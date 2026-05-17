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
  shimmerCycleMs: 1200,
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
  freshCardInviteTitle: 'Know someone who would be into this?',
  freshCardInviteSub: 'Invite them to WashedUp',

  emptyTitle: 'This is where your people live.',
  emptySub: 'They show up after your first plan. Go do something, then come back.',
  nearbyHeader: "What's happening near you",
  inviteCardTitle: 'Know someone who should be here?',
  inviteCardSub: 'Send them a link',

  // SIM-EYEBALL #3: + sheet path labels
  pathPlansTitle: "People you've already done stuff with",
  pathInviteTitle: 'Text someone a link',
  pathInviteSub: 'They show up here when they join',
  pathSearchTitle: 'Find someone on WashedUp',
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
} as const;
