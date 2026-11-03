# WashedUp member and creator cohesion audit

Historical pre-implementation audit. The findings below describe the audited revision; see the [implementation and verification record](/Users/liz/Desktop/WashedUp_HQ/washedup-create-clarity-20261102/docs/creator-management-implementation-2026-11-02.md) for what has since changed locally and what remains open.

**Date:** November 2, 2026  
**Status:** Source-based audit and proposed implementation sequence. No app changes or release performed by this audit.  
**Checkout:** `/Users/liz/Desktop/WashedUp_HQ/washedup-create-clarity-20261102`  
**Audited local revision:** `e9fce35`; base `aba9446`. The fetched main branch also contains the separate Manage Plan change; its difference from this base is confined to `app/plan/[id].tsx`.

## Main finding

WashedUp has a substantial set of creator tools. The experience does not consistently connect the person, the community or organization they manage, the event they are running, and the people participating.

The most useful next investment is a connected navigation and management experience. A creator should see **Sunset Club → Manage → the action they need**, and return to the same place afterward. They should not have to remember which kind of creator workspace they entered last.

The local three-choice + menu is a useful start, but it does not finish this journey. It still hands people into older management or application flows. Do not describe that increment as a completed creator redesign.

This review establishes code-level findings. It does not establish the current production flag values, backend deployment state, actual Sunset Club appearance on a phone, or the cause of low creator usage. Dedicated creator-funnel instrumentation was not found in the inspected entry and management surfaces.

## What is confusing today

| Finding | Evidence | Effect on the experience |
| --- | --- | --- |
| The most convenient return path depends on a rollout flag. | [YoursScreen](</Users/liz/Desktop/WashedUp_HQ/washedup-create-clarity-20261102/components/yours/YoursScreen.tsx:402>) renders CreatorSpaceEntry only with CREATOR_PAGES_ENABLED. The older entries live in [Profile](</Users/liz/Desktop/WashedUp_HQ/washedup-create-clarity-20261102/app/(tabs)/profile.tsx:951>). | Existing creators may need to find a settings section and understand “switch to … & your events.” Enabling the flag alone is not a fix: the new page system requires backend release gates. |
| Some Profile shortcuts do not explicitly select the intended workspace. | [Profile](</Users/liz/Desktop/WashedUp_HQ/washedup-create-clarity-20261102/app/(tabs)/profile.tsx:984>) selects a community but does not call setWorkspace; [resolveWorkspace](</Users/liz/Desktop/WashedUp_HQ/washedup-create-clarity-20261102/lib/workspaceContext.ts:118>) honors a still-authorized prior selection. | A person with organization and community access can enter with the wrong shell selected. This is a source-level routing defect; device reproduction remains to be done. |
| “Back to Yours” has a wrong destination. | [Community hub](</Users/liz/Desktop/WashedUp_HQ/washedup-create-clarity-20261102/app/(creator)/community.tsx:399>) sends it to Profile. | The label fails to predict where the person lands. |
| Older and newer creator systems expose different management experiences. | [CreatorPagesScreen](</Users/liz/Desktop/WashedUp_HQ/washedup-create-clarity-20261102/components/creator/pages/CreatorPagesScreen.tsx:87>) combines saved pages, local drafts and older spaces; older spaces open the separate creator tab shell. | People must learn different layouts for similar jobs. Keeping compatibility internally is sensible; exposing it as two experiences is costly. |
| Starting something loses the original intent. | [Creation entry](</Users/liz/Desktop/WashedUp_HQ/washedup-create-clarity-20261102/app/creator/start.tsx:60>) sends the new-page branch to a generic directory; [page editor](</Users/liz/Desktop/WashedUp_HQ/washedup-create-clarity-20261102/components/creator/pages/CreatorPageEditorScreen.tsx:245>) asks Community/Organization again. Existing event destinations open Events before the form. | “Start a community” can become “Creator space → New page → choose Community.” Each step makes the original promise less clear. |
| Creation is sometimes an application, with reviews explicitly on hold. | [Community application](</Users/liz/Desktop/WashedUp_HQ/washedup-create-clarity-20261102/app/creator/apply-community.tsx:173>), [events application](</Users/liz/Desktop/WashedUp_HQ/washedup-create-clarity-20261102/app/creator/apply-events.tsx:182>). | A clearer button cannot remove an operational approval hold. The release needs an honest application status and an operationally ready review process. The live flag path is unverified. |
| Daily management is not equally reachable across systems. | [New page management](</Users/liz/Desktop/WashedUp_HQ/washedup-create-clarity-20261102/components/creator/pages/CreatorPageScreen.tsx:205>) offers page editing, team, requests and questions; older hubs also directly surface Members, Updates and Chat spaces. | A page can look complete while frequent creator tasks remain indirect. |
| Contextual Manage actions are inconsistent. | Community has CommunityManageLink; [new organization controls](</Users/liz/Desktop/WashedUp_HQ/washedup-create-clarity-20261102/components/creator/pages/OrganizationPageFollowControls.tsx:66>) have Manage. [Older organization pages](</Users/liz/Desktop/WashedUp_HQ/washedup-create-clarity-20261102/app/organization/[id].tsx:218>) show an ownership note instead. No direct event-management action was found in the inspected public event screen. | A creator looking at their own content cannot reliably act on it there. |
| Event participation changes meaning by event type. | [Event footer](</Users/liz/Desktop/WashedUp_HQ/washedup-create-clarity-20261102/app/event/[id].tsx:1660>) uses “count me in,” with community chat after joining or “find people” for other events. | Registration, attendance, chat and finding company compete for attention. |
| Main community chat still has a different presentation model. | Main community and topic conversations are separate screens, with different handling of broadcasts, introductions and replies. | The local bubble-width correction fixes only one symptom. Visual and interaction parity still needs actual-device review. |

## The product model to use consistently

Use the same labels in discovery, creation, confirmation, management and notifications.

| Thing | Plain explanation | Main member action |
| --- | --- | --- |
| **Plan** | Find company for something you want to do. | Join using the Plan's existing admission rules. |
| **Event** | An organized gathering with RSVPs or tickets. | RSVP or get tickets, then see confirmed attendance. |
| **Community** | A group that keeps meeting around a shared interest. | Join, or request to join when required. |
| **Organization** | The public identity behind events and updates. | Follow. |

Use purpose to distinguish a Plan from an Event. A headcount threshold alone will not explain what someone should choose.

Organizations belong in the event creator identity and management flow. They do not need a fourth top-level + choice. A person should be able to apply under their public name where the existing policy permits; do not force them to invent a community.

Keep one public term, **Community**, throughout the flow. “Club” can describe a named community or appear in explanatory copy; it should not introduce another object type. Private friend groups remain reachable through the existing chat/Circle journeys.

Keep the main app structure stable:

- **Plans:** find people to do things with.
- **Scene:** discover events and communities.
- **+:** Make a plan / Create an event / Start a community.
- **Chats:** return to conversations.
- **Yours:** return to what you joined, saved, created or manage, with accurate status.

Undated Plans, a separate Idea type and discussion-versus-trip modeling stay deferred as Liz requested.

## The proposed creator experience

### 1. Put “You manage” in Yours

Show a compact section above the member collections for people who have management access, an unfinished application or draft, or a team invitation.

Use real names and clear statuses, for example:

- **Sunset Club** — Community · Manage
- **Organization name** — Organization · Manage
- **Community draft** — Continue setup
- **Application name** — In review · View status
- **Team invitation** — Review invitation

These are illustrative labels, not claims about current account records.

For one community, open its management home directly. For several, show the named list; never silently pick the first community. If the person also manages an organization, retain both identities visibly.

Use the same authorized destination from Profile, Yours and the public page's Manage control. Profile can retain a shortcut, but everyday operations should not depend on finding it.

Keep the existing app navigation recognizable. Use management screens within the normal navigation history, with a predictable return to Yours or the originating public page. Any temporary compatibility shell must have a correct, consistent exit.

### 2. Give each managed thing a useful home

| Management home | What leads | Daily operations | Secondary operations |
| --- | --- | --- | --- |
| **Community** | Name, public status, next gathering, actionable join requests | Create event; Members; Chats; Updates when delivery is available | Public page preview; joining settings; page details; team |
| **Organization** | Name, next event, actionable drafts | Create event; Events; follower updates when available | Public page preview; page details; team; authorized finance |
| **Event** | Title, date/time, location, Draft/Live/Cancelled/Completed status | Guest list; registration/tickets; event updates; check-in where supported | Edit details; public preview/share; duplicate; cancellation; authorized finance/refunds |

Show the next real action prominently: Continue setup, Review requests, Finish draft or Manage next event. Do not fabricate activity, urgency, member counts or success states to make the product feel active.

A community's Main chat should be one tap from its management home and available through the existing Chats flow. “Messages” in event administration currently means attendee updates; it must not imply that the proposed attendee conversation already exists universally.

Team members should land in the same recognizable home with actions appropriate to their actual role. Finance-only access must not become guest-list access; member-care access must not become event-editing access. Ownership should not be inferred from whichever workspace was last selected.

### 3. Make creation a short sequence with a visible return path

**Existing approved event creator:**

1. + → Create an event.
2. Select the creating community/organization only if there is more than one eligible choice. Show the selected identity and allow changing it.
3. Enter the event basics using the existing supported fields and good date/time controls.
4. Preview and publish, or save a draft.
5. Land on the event management home with its actual status and the next action.

Retain ticketing readiness, eligibility, terms and approval requirements. Additional options should appear when relevant. Changing the form layout does not authorize changing these rules.

**New community creator:**

1. + → Start a community; retain that intent.
2. Short steps for community details and audience, creator details required for review, and preview/submission.
3. Show **Application received**, not a published-community success message.
4. Keep the application in Yours with a single next action.
5. On approval, resume the same record; publish only through the existing approved action.

The current newer page editor already has three steps. Refine and connect it rather than building a third creation system. Do not remove application fields until the review/backend contract is checked.

**Returning Sunset Club creator:**

Yours → You manage → Sunset Club → Members / Chats / Events / Settings.

No reapplication, replacement community, new membership or copied conversation should be required.

### 4. Connect the attendee's outcome

The recommended event flow remains:

**Discover → RSVP or get tickets → confirmed attendance → relevant conversation and event details.**

Make the confirmation durable in Yours. Offer finding a small group to go with as a secondary action after the registration path is clear.

The inspected free-RSVP model supports going/cancelled, not a universal approval queue. Do not promise “Request a place” for every Event until that lifecycle exists. Community membership requests are a separate implemented concept.

For the proposed universal event chat, scope access and removal using the actual attendance and ticket lifecycle: confirmed, cancelled, refunded, revoked and any future pending states. Community eligibility must still apply. This is additional backend/product work, not a footer-label change.

## Operational coverage: what exists and what still needs proof

“Present” below means implementation found in source. It does not mean production is enabled or end-to-end verified.

| Creator job | Source status | Work needed for a cohesive release |
| --- | --- | --- |
| Find managed entities | Profile, Yours entry, pages directory and compatibility adapters are present. | One obvious route for both existing and newer entities; explicit identity selection. |
| Apply, resume and check status | Older applications plus newer draft/review/publication flow are present. | Preserve intent and existing record; expose status in Yours; confirm review operations are ready. |
| Publish/edit a community or organization | Setup/edit/publication surfaces exist, with different systems and gates. | Consistent home and public/private status; verify both compatibility paths. |
| Manage members and joining | Older Members tools; newer join requests/questions and membership controls exist. | Direct daily access and role parity; test eligible, ineligible, pending and existing members. |
| Create/edit an event | Shared event form supports older and page contexts; date, venue, media and registration options exist. | Shorter connected sequence using existing validation and account/identity ownership. |
| Save drafts, reuse and duplicate | Page event drafts, templates, reuse and older duplication routes exist. | Consistent labels, resumability and safe identity selection; no copied attendees. |
| See guests and attendance | Free-RSVP guest list, ticketed attendees and check-in routes exist. | One clear Guests entry with appropriate subsections. Do not imply ticketed check-in parity for every free RSVP path. |
| Take money and handle refunds | Ticket tiers, finance, payout readiness and permission-aware refunds exist. | Verify role and payment lifecycle; preserve unknown-result recovery and backend contracts. |
| Cancel/complete events | Event editor has status actions and cancellation/refund orchestration. | Make it findable in event management; verify attendee consequences and pending refunds. Preserve history. |
| Send attendee updates | Event Messages routes exist. Delivery is controlled by ATTENDEE_MESSAGE_SEND_ENABLED. | Confirm live delivery readiness; show drafts honestly when sending is unavailable. |
| Schedule reminders | Reminder settings and backend delivery-readiness responses exist. | Confirm worker/deployment status; saved settings must not be represented as queued delivery. |
| Invite an audience | Implemented entry is conditional on INVITE_AUDIENCE_ENABLED. | Verify audience permissions, delivery and reachable destinations before advertising it. |
| Manage co-creators | New page team invitations, permissions and revocation are present. | Common management home for permitted daily work; consistent invitation/resume paths. |
| Share/view public content | Public page/event routes and preview actions exist. | Put View page/Share in predictable locations; test deep links with current access. |
| Chat with the community | Main/topic conversations and management room entry points exist. | Shared visible interaction components, preserved transport/history and device verification. |
| Give all event attendees one chat | Community event topic route exists; non-community events use a different flow. | Separate implementation scope for a universal attendance-linked conversation. |
| Recover from trouble | Many newer flows have scoped reads, stale-access checks and unknown-result recovery. | Keep those protections during navigation/form simplification; do not replace them with optimistic success copy. |

Cancellation and refunds were inspected at their callers and recovery helpers; no money operation was executed. Recurrence automation, full ownership transfer, a universal event waitlist and universal Event approval were not established by this audit and should not be presented as completed capabilities.

## Refactor scope

A targeted refactor is justified. Start with navigation and presentation boundaries.

1. **Shared management destination resolution.** Accept current account, entity identity/source and requested action. Reuse the permission-aware community resolver and compatibility adapters. All entry points must select the correct workspace/entity and validate current access.
2. **Explicit event context.** Carry page/community/organization identity through creation, editing and return navigation. Remove dependence on stale global selection incrementally, without bypassing existing write checks.
3. **Shared management presentation.** Reuse headers, status rows, action rows, loading/error states and clear return behavior across older and newer entities.
4. **Separate the large event editor by responsibility.** Extract existing basics, date/time/place, registration and publication/status sections behind the existing behavior. Keep account lifetime, refunds and uncertain save recovery intact.
5. **Shared conversation appearance.** Align header, bubbles, attached reactions, composer and attachments while keeping the existing routes and message semantics.

Do not begin with a database rewrite, identifier migration, general permissions rewrite, or replacement chat backend. Do not flip creator-page or chat-grouping flags merely to reveal a preferred appearance.

Existing communities retain IDs, members, rooms, replies, invitations, history, read positions and notification settings. Preserve Ghost Protocol and the actual eligibility contract. Plan age/gender rules and community gender restrictions are separate mechanisms; do not assume all entity types support identical audience controls.

## Implementation order and completion criteria

### Release 1: a complete creator return-and-manage loop

- Put named managed entities and unfinished work in Yours through a flag-compatible entry.
- Correct workspace selection, ambiguous multiple-community routing and the wrong Back to Yours link.
- Provide consistent contextual Manage actions.
- Connect the existing daily community/organization tools to one recognizable home per entity.
- Preserve + creation intent and make application/draft status reachable from Yours.
- Keep existing communities and all permissions intact.

**Done means:** a returning creator can find the correct community, open its chat, manage members, start an event draft, leave, resume it and return to the ordinary app without assistance. A dual-role creator does all of this without acting under the wrong identity. A new applicant knows what was submitted and where to return.

### Release 2: event participation and conversation consistency

- Resolve the competing event participation actions.
- Complete event-card and event-detail visual work.
- Complete main/topic/Plan conversation appearance parity.
- Implement universal event chat only with the attendance/access lifecycle and backend coverage it needs.

An independently ready narrow navigation correction can ship sooner after validation. Do not label it the completed creator overhaul. Keep the separately owned Manage Plan and Interested/survey changes coordinated; this audit does not modify them.

## Verification before calling this cohesive

Run task-based checks with existing community creators, organization creators, dual-role users, new applicants, permitted team members and ordinary members.

Ask people to complete concrete tasks without explaining where to tap:

1. Find Sunset Club management from an ordinary app screen.
2. Find its members and open Main chat.
3. Create an event for the intended identity, leave and resume it.
4. Find a submitted application's status.
5. Join an event and identify whether attendance is confirmed.
6. Change attendance or locate event updates.
7. Return to normal Plans, Scene and Chats.

Record wrong turns, failed completion, time, and whether participants can explain the result. A proposed initial acceptance target is at least four of five representative participants completing each tested core task without help; this is a testing target, not a claimed result.

Test iPhone and Android, narrow screens and larger text, keyboard/date/time interactions, back/dismiss, interrupted requests, expired/revoked roles and account switches. Verify existing and newer communities with eligible/ineligible users, including direct links. Actual production/backend checks need read-only evidence or approved test fixtures; do not create production events to simulate success.

Add small funnel events for management entry impressions/opening, entry source, draft started/saved/resumed, application submitted/status viewed, publication confirmed, and return management actions. Use denominators restricted to eligible users. Do not collect message content, private audience criteria or unnecessary personal information. Measure whether creation leads to participation and repeat use, not just clicks.

## External references and their limits

Partiful's official creation guide centers a named event and a small set of essentials, with further options under settings. Luma's guide similarly starts with event details and places additional management after creation. These support a simple entry and a useful post-creation destination; they do not prove that copying either interface will improve WashedUp retention. [Partiful: creating an event](https://help.partiful.com/en-us/articles/15525299-creating-your-first-partiful-event), [Luma: creating an event](https://help.luma.com/p/creating-an-event).

Luma distinguishes personal/team ownership and management permissions behind its calendar model. WashedUp can apply the principle of explicit creator identity and permissions while using its own community/organization language. [Luma: managing events with calendars](https://help.luma.com/p/managing-events-with-calendars).

## Evidence and release limits

The previous local implementation is documented in [Creation clarity: first implementation](</Users/liz/Desktop/WashedUp_HQ/washedup-create-clarity-20261102/docs/create-clarity-2026-11-02.md>). Its 283 unique regression tests and TypeScript check passed before this audit. Those checks are not new device, usability or production-backend evidence for the proposed redesign.

This audit added this report only. It did not alter app code, publish an OTA, change flags, migrate data, send messages, or perform payment operations. The next implementation should be the bounded Release 1 journey above.

