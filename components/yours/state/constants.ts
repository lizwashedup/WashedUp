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
  tabPeople: 'People',
  tabCircles: 'Circles',
  tabAlbums: 'Albums',

  // SIM-EYEBALL #3: request banner phrasing
  requestBannerOne: 'Someone wants to add you',
  requestBannerMany: (n: number) => `${n} people want to add you`,

  requestAdd: 'Add them',
  requestNotNow: 'Not now',
  // SIM-EYEBALL #3: block prompt
  blockPromptTitle: (name: string) => `Block ${name}?`,
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

  // ── Circles directory (Yours > Circles) ────────────────────────────────
  // A thin list of the circles you're in, each deep-linking to its home.
  // Lexicon: "circle" only, never group/crew/etc. No em/en dashes.
  // Row meta.
  circleMembers: (n: number) => (n === 1 ? '1 person' : `${n} people`),
  // Last-resort title for an unnamed circle if member names can't be resolved.
  circleUnnamed: 'New circle',
  // Shown in place of a last-activity time when a circle has no messages yet.
  circleQuiet: 'Quietly kept',
  // The first-class "make a circle" entry point (also lives on Chats).
  circleMakeCta: 'Make a circle',
  circleMakeSub: 'Gather a few of your people',
  // Summary header card (sits above the rich card list). The "plans this week"
  // half of the label fills in next chunk, once circle-plans data exists.
  circleDirCount: (n: number) => (n === 1 ? '1 circle' : `${n} circles`),
  circleDirTagline: 'your people. your plans.',
  circleDirNewCta: 'New circle',
  // Overflow chip on a card's overlapping-avatar row, e.g. "+3".
  circleDirOverflow: (n: number) => `+${n}`,
  // Empty state when you have people but no circles yet: a warm invitation.
  circlesEmptyTitle: 'Your circles live here.',
  circlesEmptySub: 'A few of your people, one running list of plans together.',
  // Empty state when you have no people yet: point at the prerequisite first.
  circlesNeedPeopleTitle: 'Circles start with your people.',
  circlesNeedPeopleSub: 'Add a few people first, then gather them into a circle.',
  circlesNeedPeopleCta: 'Add people',
  // Loading / error.
  circlesError: "Your circles didn't load.",
  circlesRetry: 'Try again',

  // ── Circle home (the stacked surface on Chats) ──────────────────────────
  // The noticeboard above the persistent circle chat. "Circle" only; no
  // group/crew/host; no em/en dashes.
  circleHomeBack: 'Back',
  circleHomeMore: 'More',
  // Members section.
  circleWhoLabel: "who's in it",
  // Fallback name under an avatar when a member has no display name or handle.
  circleMemberFallback: 'Someone',
  circleHomeMembers: (n: number) => (n === 1 ? '1 person' : `${n} people`),
  // Plans on the circle's calendar. Empty in v1 (circle plans land in Step 8).
  circlePlansLabel: 'coming up',
  circlePlansEmpty: 'No plans on the calendar yet.',
  circlePlansEmptySub: 'When the circle makes a plan, it shows up here.',
  // Circle page action row (unconditional) + the first-plan nudge.
  circleActionPost: 'post a plan',
  circleActionChat: 'open chat',
  circleActionInvite: 'invite',
  circleMakeFirstPlan: 'Make the first plan.',
  // Recently-together section (hidden until there is history).
  circleRecentLabel: 'recently together',
  // The Room: a reserved, opt-in planner. UI only this release, no logic.
  // Title is just "the room" (the "AI planner" label was dropped per the
  // 2026-06-08 copy system); the sub carries the "not on yet" framing.
  circleRoomTitle: 'the room',
  circleRoomSub: 'An optional planner for your circle. Not on yet.',
  // Leave a circle. Plan history is untouched (spec section 3).
  circleLeave: 'Leave circle',
  circleLeaveTitle: 'Leave this circle?',
  circleLeaveBody:
    'Your plans together stay in your history. You can be added back later.',
  circleLeaveStay: 'Stay',
  circleLeaveGo: 'Leave',
  circleLeaveError: "Couldn't leave just now. Try again.",
  // Load failure.
  circleLoadError: "This circle didn't load.",
  // Circle chat (the shared chat surface) + its header.
  circleChatStart: 'This is the beginning. Say something to get it going.',
  // Chat plan card (a system message carrying ref_event_id). Live cards reuse
  // circlePlanJoinLine; a dangling/wrapped ref renders this quiet inert line.
  chatPlanWrapped: 'This plan has wrapped.',
  // ── Composer INVITE PEOPLE section (composer-invite-section-spec.md) ───────
  // Header uses the uppercase label style, so the source stays sentence case.
  inviteSectionHeader: 'Invite people',
  inviteSectionSub: 'From your people, and anyone who raised a hand.',
  inviteProvenance: (title: string) => `said they'd go next time · ${title}`,
  invitePill: 'Invite',
  inviteSeeMore: 'See more',
  // Neutral pull affordance for your-people (the app never lists their names
  // proactively; reactance fix). Opens the people picker.
  inviteAddFromPeople: '+ Add from your people',
  peoplePickerTitle: 'Add from your people',
  peoplePickerConfirm: (n: number) => (n === 1 ? 'Add 1 person' : `Add ${n} people`),
  peoplePickerEmptyTitle: 'No people to add.',
  peoplePickerEmptySub: 'Everyone you know is already on this plan.',
  inviteDismissToast: "Removed. They'll show up again if they raise a hand.",
  inviteUndo: 'Undo',
  // Header "View circle" button (opens the circle detail page).
  circleViewButton: 'View circle',
  // Header "+" menu: add people now, or make a plan (placeholder this build).
  circlePlusAddPeople: 'Add people now',
  circlePlusMakePlan: 'Make a plan',
  // Neutral title for the Android "+" menu Alert (it offers both add-people and
  // make-a-plan, so it must not be titled "Add people").
  circlePlusMenuTitle: 'What would you like to do?',
  circlePlusCancel: 'Cancel',
  // Add-people sheet (also used to grow a DM into a circle).
  circleAddTitle: 'Add people',
  // Short label on the trailing "+add" chip in the members row.
  circleAddCell: 'add',
  circleAddSub: 'Pick from your people. They join the moment you add them.',
  circleAddConfirm: (n: number) =>
    n === 1 ? 'Add 1 person' : `Add ${n} people`,
  circleAddEmptyTitle: 'Everyone you know is already here.',
  circleAddEmptySub: 'Add more people on the People tab first, then add them here.',
  circleAddError: "Couldn't add them just now. Try again.",
  // Name a promoted/unnamed circle. A DM that grew a third person becomes an
  // unnamed circle (it reads as the member names); this is the front door to
  // give it an identity. Admin-only (backend update_circle is admin-gated).
  circleNameThis: 'Name this circle',
  circleNameSheetTitle: 'Name this circle',
  circleNameSheetSub: 'Give it a name so it reads as a circle, not a list of names.',
  circleNameSheetSave: 'Save the name',
  circleNameSheetError: "Couldn't save the name just now. Try again.",

  // ── Create-circle flow (3 steps) ────────────────────────────────────────
  circleCreateTitle: 'New circle',
  circleCreateNext: 'Next',
  circleCreateMake: 'Make the circle',
  // Step 1, identity.
  circleStep1Title: 'Name your circle',
  circleNamePlaceholder: 'Circle name',
  circleDescPlaceholder: 'What brings you together? (optional)',
  // Step 2, people.
  circleStep2Title: "Who's in it",
  circleStep2Sub: 'Pick from your people. A circle is three or more.',
  circlePickedCount: (n: number) => `${n} selected`,
  circleStep2NeedMore: 'Pick at least two to make a circle.',
  circleNoPeopleTitle: 'You need people first.',
  circleNoPeopleSub: 'Add a few people, then gather them into a circle.',
  circleNoPeopleCta: 'Add people',
  // Step 3, who can add people (the admin model).
  circleStep3Title: 'Who can add people',
  circlePolicyOnlyMe: 'Only me',
  circlePolicyOnlyMeSub: 'You add everyone, and you stay the only admin.',
  circlePolicyChosen: 'Chosen people',
  circlePolicyChosenSub: 'You and the people you pick can add others.',
  circlePolicyEveryone: 'Everyone',
  circlePolicyEveryoneSub:
    "Anyone in the circle can add others, even people you don't know yet.",
  circleChosenAdminsLabel: 'who else can add people',
  circleCreateError: "Couldn't make the circle. Try again.",

  // ── Co-attendance suggestion card (Step 10) ──────────────────────────────
  // A warm, recognition-over-guilt nudge. "You" leads the subject list.
  circleSuggestYou: 'You',
  circleSuggestBody: (subject: string, n: number) =>
    `${subject} have done ${n} ${n === 1 ? 'plan' : 'plans'} together.`,
  circleSuggestStart: 'Start a circle',
  circleSuggestNotNow: 'Not now',

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
  // Keep-page actions. "Message" (low-pressure, gold slot the old "ping"
  // vacated) always shows; "Make a plan for you two" (terracotta, do-it-now)
  // is the former "invite to a plan".
  keepMessage: 'Message',
  keepMakePlan: 'Make a plan for you two',
  keepMessageError: "Couldn't open this chat just now. Try again.",
  // Legacy ping copy (still used by PingSheet / PingInline elsewhere).
  keepPing: 'ping',
  keepInvite: 'invite to a plan',
  keepPingSent: (name: string) => `${name} knows about it.`,
  // Long-press a face in People: message them, or start a circle with them.
  // (dmMessagePerson/dmStartCircle predate the MenuCard and are now unused;
  // dmViewPerson is still the circle-chat "View {name}" button label.)
  dmMessagePerson: (name: string) => `Message ${name}`,
  dmStartCircle: (name: string) => `Start a circle with ${name}`,
  dmViewPerson: (name: string) => `View ${name}`,
  // ── Unified MenuCard rows (locked copy, shared by the People long-press and
  // the DM chat "+" menu so an action reads identically on every surface). No
  // name in the label: on People the ringed face is the header. No forbidden
  // words, no em dashes. Source: people-menu-and-keep-page-copy.md.
  menuMessage: 'Message',
  menuMessageSub: 'Open your chat',
  menuMakePlan: 'Make a plan',
  menuMakePlanSub: 'Plan something together',
  menuStartCircle: 'Start a circle',
  menuStartCircleSub: 'Pull a few more people in',
  menuViewProfile: 'View profile',
  menuViewProfileSub: "See what they're up to",
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

  // ── Circle-aware plans (make a plan from a circle chat or DM) ───────────
  // Lexicon: "circle" / "{circle name}" only; never group/crew/host/friends.
  // No em/en dashes. All copy verbatim from the locked spec.
  circlePlanComposerTitle: 'New plan',
  circlePlanWhatLabel: 'What',
  circlePlanWhatPlaceholder: "What's the plan?",
  circlePlanWhereLabel: 'Where',
  circlePlanWherePlaceholder: 'Add a place (optional)',
  circlePlanWhenLabel: 'When',
  circlePlanWhenPlaceholder: 'Pick a day and time',
  // The single audience question.
  circlePlanWhoLabel: 'who is this for',
  circlePlanJustUs: 'Just us',
  circlePlanJustUsSub: (circle: string) => `Only ${circle}.`,
  circlePlanOpenUp: 'Open it up',
  circlePlanOpenUpSub: 'Let a few others join from the feed.',
  // Just-us recipients.
  circlePlanEveryone: (circle: string) => `Everyone in ${circle}`,
  circlePlanPickPeople: 'Pick people',
  circlePlanPickHelper:
    'Everyone keeps this in the circle chat. Pick a few and they get their own chat.',
  // Open-it-up stranger stepper.
  circlePlanStepperLabel: 'How many others can join?',
  circlePlanStepperSub: (circle: string) => `On top of ${circle}, up to 7 from the feed.`,
  // Inherited single-gender pill.
  circlePlanGenderWomen: 'Shown to women only',
  circlePlanGenderMen: 'Shown to men only',
  // Primary action + errors.
  circlePlanPost: 'Post the plan',
  circlePlanTitleRequired: 'Give the plan a name first.',
  circlePlanWhenRequired: 'Pick when it happens.',
  circlePlanError: "Couldn't post the plan. Try again.",
  // Posted-card framing.
  circlePlanJoinLine: "Join if you're around.",
  circlePlanFromBadge: 'from a circle',
  circlePlanPrivateTag: 'private to circle',
  // Badge B seats line on an opened-up circle plan card. N = stranger_cap (2-7).
  // "up to N others welcome", never "N spots left": an open door, not scarcity.
  circlePlanSeatsWelcome: (n: number) =>
    `up to ${n} ${n === 1 ? 'other' : 'others'} welcome`,
  circlePlanOpenStatus: (inCount: number, total: number, cap: number) =>
    `${inCount} of ${total} in. Up to ${cap} others welcome.`,
  // Start-a-chat affordance (whole-circle just-us plan with no chat yet).
  circlePlanStartChat: 'Start a chat for this',
  circlePlanStartChatSub: (circle: string) => `Keep this plan's planning out of ${circle}.`,
  circlePlanStartChatError: "Couldn't start the chat just now. Try again.",
  // Release a just-us plan to others (lives on the plan detail card).
  circlePlanRelease: 'Open it up',
  circlePlanReleaseExplain: (circle: string) =>
    `Opening this up starts a separate chat, so ${circle} stays just yours.`,
  circlePlanReleaseConfirm: 'Open it up',
  circlePlanReleaseCancel: 'Keep it just us',
  circlePlanReleaseError: "Couldn't open it up just now. Try again.",

  // ── Keep-page empty state (you & [name], no shared history yet) ─────────
  keepEmptyHeadline: (name: string) => `This is where you and ${name} begins.`,
  keepEmptyAction: 'Make the first plan.',
} as const;
