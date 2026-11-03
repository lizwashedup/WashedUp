# Creator management: implementation and verification

November 2, 2026. **Implemented locally; no OTA published by this task.**

**Latest status:** The second increment below removes the separate creator bottom navigation and has now been exercised in the full signed-in iOS app. Earlier component-only results remain historical evidence. Read the November 2 evening update for current verification and remaining release work.

Checkout: `/Users/liz/Desktop/WashedUp_HQ/washedup-create-clarity-20261102`

Branch: `codex/create-community-clarity-20261102`

Implementation commits: `76288cf` (creation choices) and `cb575c9` (management and explicit event creation). Integrated main: `864bbec`, including the separate Manage Plan and Interested/survey changes. A merge into main does not establish that those changes have been released over the air.

## What people can now do in this local implementation

| Starting point | Result |
| --- | --- |
| Yours | See **You manage**, with the names of communities and organizations they manage. A compact list links to the full directory. People without management access do not receive an empty management section. |
| Profile → Communities & events | Open the same management directory instead of choosing between several workspace shortcuts. |
| An existing community's Manage action | Enter its existing management home, with **Main chat**, **Members**, **Events**, and **Settings**, each explained. The available tools still depend on the person's role. |
| Their older public organization page | Use a visible **Manage** action, after current approval is checked. |
| Create event from an existing approved creator identity | Enter the form with that community or organization explicitly selected. A previously selected workspace cannot silently choose another identity. |
| Save a new event draft successfully | Return to the Events workspace with **Drafts** selected. |
| Start a community or an event through the newer page system | Retain the original intention through creator selection and page setup. A new organization reservation is distinguishable from an older, manually edited organization draft. |
| Leave the community, members, events, or organization tools | Use a visible **Back to Yours** action with the correct destination. |

The bottom + menu from the previous increment still offers three explained choices: **Make a plan**, **Create an event**, and **Start a community**. Organization remains a creator identity within the relevant flow, rather than a fourth choice.

## Reliability and compatibility

- Management entries recheck access before navigation. Late results from an old account or departed screen do not navigate the current account.
- Community tools use the selected community's role; being an admin in another community does not supply permissions here.
- New event creation checks the intended identity again before dispatch. The request is bound to the initiating account, and account changes invalidate its result.
- When access cannot be refreshed while filling the explicit event form, the unsaved form remains visible with a retry explanation; saving waits for renewed access.
- Application status and team invitations remain reachable. A failed management read does not hide an independently available application status.
- Existing communities retain their IDs and existing destinations. This increment does not recreate Sunset Club, migrate members, reset history, or add a replacement chat.
- This increment adds no database migration and changes no visibility policies, join RPCs, audience settings, or rollout flags. Main contains migrations from separately owned changes.
- Ghost Protocol and the existing community gender controls and separate Plan age/gender rules remain in place. This is not a claim that every community supports Plan-style age settings or that current production policies have been verified.
- An optional organization-name lookup has a short deadline and cannot prevent management access when it fails.

## Verification completed

- **24 test suites passed: 496 tests passed, one existing test skipped.** The integrated run includes menu navigation, Yours, Plan joining, community management, account/visit ownership, creator roles, page reservations, event creation and draft return, plus older page-event save behavior.
- Application TypeScript passed after integration with main. `git diff --check` passed.
- Native component review used the existing iOS development client on an iPhone 17 Pro Max simulator. It loaded the actual management directory, community action rows, Back to Yours component, and app fonts/tokens with fictional local data.
- The component review covered ordinary phone width and a **320-point content area with extra-extra-extra-large text**. It checked legibility, wrapping and overlap. Simulator text size was restored afterward.

Native review evidence:

- [Yours management entry](</Users/liz/Desktop/WashedUp/Design/Creator management review 2026-11-02/yours-native.png>)
- [Community management actions](</Users/liz/Desktop/WashedUp/Design/Creator management review 2026-11-02/community-native.png>)
- [Narrow community actions with larger text](</Users/liz/Desktop/WashedUp/Design/Creator management review 2026-11-02/community-narrow-large-text.png>)
- [Narrow Yours entry with larger text](</Users/liz/Desktop/WashedUp/Design/Creator management review 2026-11-02/yours-narrow-large-text.png>)

The review fixture is under `/Users/liz/Desktop/WashedUp/Design/Creator management review 2026-11-02`. Its Sunset Club and Sunset Studio data are fictional. Navigation outside those components shows a destination placeholder. These images demonstrate native component rendering, **not a complete signed-in app walkthrough or a production-data check**. No native build or backend write was performed for that review.

## Next verification before an OTA

1. Walk through the integrated app while signed in: Yours → named community → all daily actions → Back to Yours, then the organization equivalent. Include a person who manages both identities and a collaborator with a narrower role.
2. Verify the full event journey using an authorized test account/environment: choose a creator, enter details, cancel/resume, save a draft, land on Drafts, reopen it, and check that its creator identity remains correct. Include expired access and switching accounts. Automated checks cover these conditions, but the full native journey remains open.
3. Check the complete + menu and destinations on iPhone and Android, including a narrow screen, larger text, keyboard, dismissal, and an existing Plan draft.
4. Check existing Sunset Club membership/history and the current backend's audience restrictions with eligible and ineligible test accounts, including direct links. Do not change rollout flags to make a visual review pass.
5. Run the repository's release checks against the final integrated revision and then perform the authorized release process. This note is not a release receipt.

## Deliberately unfinished product work

This is the first connected management increment, not the entire creator redesign. The newer page system and older organization/community tools still need broader operational parity. New-creator application review remains governed by the existing operational process. Public Event management entry, Event participation wording and chat behavior, the broader Event-card redesign, full main-chat parity, and undated/discussion Plans remain separate work.

The previous [cohesion audit](/Users/liz/Desktop/WashedUp_HQ/washedup-create-clarity-20261102/docs/user-creator-cohesion-audit-2026-11-02.md) retains those findings as a historical source snapshot. The actual outcome to validate with creators is whether they can find their community or organization, complete a daily task, and return without explanation; code and component checks cannot establish that usability outcome by themselves.

## Modified files

All paths below are relative to the checkout named above. This groups the management increment; the earlier + menu and chat-width changes are recorded in [the creation-clarity note](/Users/liz/Desktop/WashedUp_HQ/washedup-create-clarity-20261102/docs/create-clarity-2026-11-02.md).

| Area | Implementation files |
| --- | --- |
| Directory and entry | `components/creator/pages/CreatorSpaceEntry.tsx`; `components/yours/YoursScreen.tsx`; `app/(tabs)/profile.tsx`; `app/creator/manage.tsx`; `lib/creatorManagement.ts`; `lib/creatorSpaceEntry.ts` |
| Daily management and return routes | `components/creator/CommunityDailyActions.tsx`; `components/creator/OrganizationManageLink.tsx`; `app/organization/[id].tsx`; `app/(creator)/_layout.tsx`; `app/(creator)/today.tsx`; `app/(creator)/members.tsx`; `app/(creator)/community.tsx`; `app/(creator)/events.tsx`; `app/(creator)/organizer-home.tsx`; `lib/communityManageEntry.ts`; `lib/creatorMode.ts` |
| Explicit event creation | `components/creator/LegacyEventCreateGate.tsx`; `app/creator/event-form.tsx`; `lib/creatorEventRoute.ts`; `lib/legacyEventCreate.ts`; `lib/creatorEvents.ts`; `lib/creationEntry.ts` |
| Retained creation intent | `app/creator/start.tsx`; `app/creator/pages.tsx`; `components/creator/pages/CreatorPagesScreen.tsx`; `lib/creatorPageEditor.ts` |
| Component and route tests | `components/creator/__tests__/CommunityDailyActions.test.tsx`; `components/creator/__tests__/LegacyEventCreateGate.test.tsx`; `components/creator/__tests__/OrganizationManageLink.test.tsx`; `components/creator/pages/__tests__/CreatorSpaceEntry.test.tsx`; `components/creator/pages/__tests__/CreatorPagesScreen.test.tsx`; `app/(creator)/__tests__/creatorLayout.access.test.tsx`; `app/creator/__tests__/eventForm.workspaceOwner.test.tsx`; `app/creator/__tests__/start.test.tsx` |
| Model tests | `lib/__tests__/creatorManagement.test.ts`; `lib/__tests__/legacyEventCreate.test.ts`; `lib/__tests__/creatorSpaceEntry.test.ts`; `lib/__tests__/creatorPageEditor.test.ts`; `lib/__tests__/creationEntry.test.ts`; `lib/__tests__/communityManageEntry.test.ts`; `lib/__tests__/creatorShellRedirects.test.ts`; `lib/__tests__/creatorEvents.test.ts` |
| Documentation | This record, `docs/user-creator-cohesion-audit-2026-11-02.md`, and `docs/create-clarity-2026-11-02.md` |

## November 2 evening update: management inside Yours

The normal **Plans | Scene | + | Chats | Yours** navigation now stays visible in community and organization management. Yours contains a nested stack for the named directory and existing tools. Creators no longer switch to a second set of bottom tabs.

- Yours, Profile, the approved-creator banner, and approved application status lead to the same named management directory. The banner explains where the tools live.
- Community home keeps Main chat, Members, Events and Settings. Organization home now provides explicit Events and Settings links, retaining payouts, profile and follower-update destinations.
- Back from a tool returns to its management home; Back from that home returns to the directory; Back from the directory returns to Yours. Focused editors and conversations retain their ordinary full-screen routes.
- The old `(creator)` route layout redirects saved links into Yours. Screen implementations are reused rather than duplicated. Existing notification, invitation and setup callers target the nested routes.
- The shared header keeps Profile available. The follower-update composer owns its Back callback and has only one header, preserving its timer cleanup.
- Permissions are evaluated for the selected identity. Inactive management screens cannot redirect someone who has left for Plans or an event form. A late storage read cannot overwrite an explicit community/organization selection.
- Native review exposed a NativeWind interaction that dropped callback-based Pressable styles in the management directory. Its cards now explicitly retain their React Native styles, and the corrected cards were rechecked in the full app.
- Native review also found that the selected Sunset LA Club record is a draft. Creation remains blocked; the message now explains publishing its page from Settings and offers a return to You manage. No community was published or changed during review.
- The default tab-bar keyboard behavior is retained. A temporary hide-on-keyboard option was removed after observing the directory bar displaced offscreen; the corrected directory was captured with all five tabs visible.

### Current verification

**39 suites passed: 529 tests passed, one existing skipped.** TypeScript and `git diff --check` passed. Coverage includes route compatibility, selected-role access, asynchronous ownership, hydration ordering, application entry, Yours, community/organization actions, event form and draft-return behavior, and follower-update lifecycle. Jest reported lingering asynchronous handles after its assertions; the process subsequently exited successfully. This was not treated as proof that the existing timer warning is resolved.

The full app was bundled from this checkout and launched in the already-installed development client on **iPhone 17 Pro Max / iOS 26.4**, with its existing signed-in session and configured backend. This review did not use the fictional component services. No native build was created.

Observed journeys:

1. Plans banner → management → named Sunset LA Club → Events. The main tabs remained available, and switching back to Plans did not bounce into management.
2. Directory → existing organization → Events → new event form. The form identified the organization. Back returned to organization Events without saving.
3. Organization home → Settings → Back → home → Back → directory → Back → Yours. The Yours management entries and See all path remained reachable.
4. + from organization Events → the three explained creation choices → dismiss → the same Events screen.
5. Direct local link into the nested management directory → corrected cards and all five visible tabs.

Current native captures, all from the full app:

- [Yours with management entries](</Users/liz/Desktop/WashedUp/Design/Creator management review 2026-11-02/connected-yours.png>)
- [Named management directory](</Users/liz/Desktop/WashedUp/Design/Creator management review 2026-11-02/connected-directory.png>)
- [Community home inside the normal tabs](</Users/liz/Desktop/WashedUp/Design/Creator management review 2026-11-02/connected-community.png>)
- [The + menu opened from management](</Users/liz/Desktop/WashedUp/Design/Creator management review 2026-11-02/connected-create-menu.png>)

No event, membership, announcement or community setup was intentionally saved during the walkthrough. The displayed draft community is evidence about that selected record, not verification of every Sunset Club record or every production membership/history path. No rollout flags, audience rules, migrations or database policies changed in this increment. Ghost Protocol and Plan eligibility code were not rewritten.

### Review setup and remaining work

Metro now includes the parent of the real shared dependency directory and resolves both dependency paths; this fixes package resolution in this linked checkout. Full-app review used local port 8872 and a temporary local entry file because of the shared dependency entrypoint. The server was stopped, `package.json` restored to `expo-router/entry`, the temporary entry removed, and diagnostic layout logging removed. No temporary fixture or credential is part of the commit. The earlier `connected-app` bootstrap directory is an abandoned review attempt, not an application source or launch target.

The installed client logged an Expo registration/keychain entitlement error at launch. It did not prevent the reviewed navigation; push registration was not validated and remains a separate device check.

Before release, finish an authorized disposable draft save/reopen journey, narrow-role and expired-access device cases, all community actions including Main chat, creator onboarding, complete keyboard/large-text checks, Android, and a physical iPhone smoke test. The older component fixture's narrow/large-text captures do not replace those full-app checks. Current backend eligibility and membership/history checks remain open. This implementation improves navigation; it does not establish that the complete Event editor, public Event design or creator onboarding is finished.

No OTA, push, merge or native build was performed by this increment. Next product acceptance should ask a creator to find their named item and complete a daily task without instructions.

The complete changed-file inventory for this navigation increment is [recorded here](/Users/liz/Desktop/WashedUp_HQ/washedup-create-clarity-20261102/docs/creator-management-navigation-files-2026-11-02.txt). The most substantial new files are `ManagementLayout.tsx`, `ManagementDirectoryScreen.tsx`, `OrganizationDailyActions.tsx`, `managementNavigation.ts`, and the nested Yours route wrappers. Other application changes primarily replace old route literals, remove duplicate mode navigation, or explain blocked creation.


## November 2 follow-up: finish existing community setup

The connected review exposed a second setup dead end: the event chooser could suggest starting a new community when an approved creator already had an unfinished one. Community home and Events also offered event creation for that draft, only to reject it in the form gate.

This increment changes the navigation and explanation, not the publishing or access contract:

- Event creation separates ready creator identities from **Finish community setup**. An admin continues the exact existing community's Settings page, retaining its ID. Starting a second community is no longer suggested as the way to finish the first one.
- Choosing an existing draft from community creation also goes directly to its Settings page. Explicit new-community creation remains available through its existing grant.
- Draft community home and Events show the same explanation and **Continue setup** action. Archived communities explain that new events are unavailable and link to **You manage**. Existing event lists, drafts and history remain reachable.
- An events-only collaborator sees that a community admin must finish the page; the UI does not offer that collaborator admin settings. Roles are checked for each community, not borrowed from another membership.
- Active community and organization event creation retain their existing routes and downstream access checks. The application explanation now distinguishes applying for a separate public creator identity from using a community already managed.
- The existing main community chat now gives its legacy Back control an accessibility label and button role. This is not the larger main-chat visual parity redesign.

### Evidence and limits

**9 focused suites passed, 65 tests passed.** This run covers creation entry, exact identity selection, draft/admin/collaborator/archived cases, active community and organization event entry, existing templates, first-community setup, daily actions, the event creation gate and the main chat header. TypeScript and `git diff --check` passed. The chat-header suite emitted the existing Expo Go push-use warning; push registration was not validated. Earlier 39-suite navigation results remain recorded above and were not presented as a new full regression run.

Full-app native checks used the same signed-in iPhone 17 Pro Max simulator and installed local development client:

1. Named community → Main chat loaded its existing message history. Back returned to the same community management home. No message, reaction or preference was sent; normal read-state effects from opening a chat were not suppressed.
2. The selected draft community home displayed **Continue setup** in place of Create event. The action opened that community's existing Settings page, where its draft status and explicit publication control remained visible. No publication was performed.
3. Community Events showed the same setup explanation and retained its existing event drafts. The blocked New event shortcut was absent.
4. The full event-creation entry showed the organization as a ready identity and Sunset LA Club separately under **Finish community setup**. Selecting Sunset opened that same community's Settings page, not a new-community form.

Captures are [community home](</Users/liz/Desktop/WashedUp/Design/Creator management review 2026-11-02/connected-community-setup.png>) and [community Events](</Users/liz/Desktop/WashedUp/Design/Creator management review 2026-11-02/connected-draft-community-events.png>). A local Main chat capture is retained in the same folder for review; it contains existing conversation content. These observations apply to the selected record, not every community or account.

The existing Android emulator was inventoried and started, then stopped without replacing its app or clearing its data. Its installed 1.0.7 (18) release app cannot load this source candidate; **Android candidate validation remains open**. No native build was created. The reusable local `run-connected-review.cjs` launcher is documented in the artifact folder. Metro was stopped, the original package entry restored, and its temporary entry file removed.

No database migration, permission policy, audience restriction, rollout flag, membership or community identity changed. No event or community draft was saved by this follow-up. No OTA, push or merge was performed. Device Hub was released to the separately owned reliability review after these checks; its SE and iPhone 13 devices were not operated here.

### Remaining acceptance work

The next release gate is a complete disposable event draft save/reopen journey in an authorized test environment, then physical-iPhone and Android coverage, narrower creator roles, expired access, keyboard/large-text checks, and eligible/ineligible audience checks. The existing main-chat visual differences, broad community Settings composition and Event card design are still separate unfinished product work. This patch makes the current setup path truthful and reachable; it does not claim those larger screens are finished.

This increment's changed-file inventory is [recorded here](/Users/liz/Desktop/WashedUp_HQ/washedup-create-clarity-20261102/docs/creator-setup-followup-files-2026-11-02.txt).

## November 2 late-evening menu correction and creator reassessment

Liz accepted the visible create-menu layout and requested slightly higher placement plus plain language. `components/create/CreateMenuSheet.tsx` now adds 12 points below the content, preserving safe-area padding and scrolling, and uses her Plan explanation: **Find people to go with for something you want to do.** The Event explanation is **Organize an event as yourself or an organization, with RSVPs or tickets.** The same Event explanation appears in `app/creator/start.tsx`. No headcount threshold was added.

The approved native appearance is plain rows, although the previous callback styles specified bordered white cards that NativeWind was not applying. The menu now explicitly opts out of that callback interop and defines plain rows, retaining press feedback, a 44-point minimum target, existing fonts and colors. This makes the accepted appearance intentional rather than dependent on the missing callback styling.

Validation: the existing menu and creation-entry suites passed **25 tests across 2 suites**; TypeScript and `git diff --check` passed. The updated menu was visually checked in the already-running signed-in iPhone 17 Pro Max preview, including the wrapped Event description and all three reachable choices. [Local capture](</Users/liz/Desktop/WashedUp/Design/Creator management review 2026-11-02/connected-create-menu-revised.png>). This is normal-size iOS evidence, not Android or large-text completion. No new native build or OTA was performed.

The broader creator simplification remains unfinished. The [updated cohesion audit](/Users/liz/Desktop/WashedUp_HQ/washedup-create-clarity-20261102/docs/user-creator-cohesion-audit-2026-11-02.md) distinguishes navigation already implemented from the next task-level redesign, maps confusing terms and overloaded screens to proposed replacements, and records primary UX research with its limits. In particular, the creator selector still calls personal public identities “Your organization,” and the event application still says “Organization application”; those are mapped follow-up work, not changes claimed in this menu correction.

Changed product files in this increment: `components/create/CreateMenuSheet.tsx` and `app/creator/start.tsx`. Documentation: this record and `docs/user-creator-cohesion-audit-2026-11-02.md`. The connected-review launcher's temporary `package.json` entry change and `creator-review-entry.js` are preview plumbing and must not be committed or released.

## Community header management and tap feedback

Liz requested an obvious management/settings button while viewing her own community, and described the app as flat and insufficiently responsive. The public community page now puts its existing authorized management action in a **gear button in the persistent header**, next to the existing chat control and before the profile photo. It replaces the small underlined Manage link beside Share. Preview-as-visitor/member mode still hides this control. Ordinary members do not gain the control or any permissions; the exact-community access check, current-account/visit guards, repeat-tap lock and selected-community preparation remain in place. The icon has a 44-point target, a named accessibility action, pending indicator and read-error recovery.

Creator `PageAction` secondary/disclosure controls and `CommunityDailyActions` rows now show a pressed opacity change. Previously the shared action only had a pressed appearance for its sunset variant, while the community rows used a static style. These are bounded visual feedback corrections. No new animation library, haptic behavior, data write, native build or release was introduced.

Validation: **50 tests across 5 suites passed**, covering the management entry, ordinary-member exclusion, access revocation, pending checks, current-account lifetime, community-page actions and daily tools. TypeScript and `git diff --check` passed. In the signed-in iPhone 17 Pro Max preview, Main chat → community title opened Sunset LA Club; the gear was visible beside the chat icon, and tapping it opened **Manage Sunset LA Club** after its access check. [Native capture](</Users/liz/Desktop/WashedUp/Design/Creator management review 2026-11-02/connected-community-gear.png>). No community, member, message or event record was edited.

The control still opens the existing management destination. Its overloaded contents and the management home's Back destination (currently everything managed in Yours) are not yet the proposed simple, contextual experience. Preserve the initiating community and return position when redesigning that journey. On returning from Settings during the walkthrough, the home also briefly displayed generic/empty-looking information before the community and member data settled. This is an observed loading-state issue; no duration or frame-rate claim is established. Haptic feel requires a physical phone; narrow-width, large-text and Android header verification remain open.

Changed files: `app/community/[id].tsx`, `components/communities/CommunityManageLink.tsx`, its existing test file, `components/creator/CommunityDailyActions.tsx`, `components/creator/pages/PageFrame.tsx`, this record and the cohesion audit.


## Researched design walkthrough: next slice, not a release

A focused, interactive returning-community proposal now demonstrates public community → gear → daily management jobs → editing/member review/event draft → contextual return. Its source is `/Users/liz/Desktop/WashedUp/Design/Creator management review 2026-11-02/community-journey.html`. The existing cohesion audit now records source-backed design decisions, the prototype interaction/contrast/narrow-width checks, limits and the next implementation slice. Prototype data is fictional and stays local. Native app code, backend contracts and deployment state were not changed in this research increment. The temporary connected-review package entry remains separate from committed product source.


## November 2 late follow-up: direct community actions and creator identity

Implemented in the existing private `codex/create-community-clarity-20261102` checkout. This is application code, separate from the approved interactive proposal. No OTA, native build, migration, invitation or broadcast was sent.

- The community page now exposes **Create event** and **Edit community** after exact-community, current-account permission checks. Draft legacy communities show **Continue setup** instead of event creation; archived communities do not offer creation. Event-only collaborators receive event access without editing access. Page-system teammates retain separate `page_events` and `page_content` capabilities.
- The existing page event flow accepts a direct first-step entry after authorization. It never creates a draft merely because someone opens it; unresolved saved event attempts remain explicit recovery actions.
- Creator bylines now sit beside the community name. Public-team rows open the existing privacy-aware profile route. Legacy leader-card data remains name/photo only: it has no public person ID, and the legacy RPC only returns active communities. No inferred person ID or extra public handle lookup was added. Complete legacy creator-profile parity remains backend work.
- Legacy page editing accepts an explicit community ID and cannot fall back to a different selected community. It uses the existing account-owned access reader, restricts editing to that community’s admin tier, and starts fresh editor state when the community changes. Visiting the editor no longer auto-inserts founder/cadence sections; existing sections remain, and adding sections remains an explicit action.
- Editor labels are **Basics**, **What members see**, and **Photos & links**. The short description replaces “your promise.” The member’s Profile action remains available in the header.
- Community-origin management/setup has a contextual Back destination. Approved page editing can return to the initiating community after Back or an explicit confirmed publication. Existing publication confirmation, uncertainty recovery and privacy controls remain in their original flows.

The invitation picker and chat-plus-Notifications broadcast contract are **not implemented by this increment**. Existing external Share remains available. The approved prototype’s Invite people/Send update controls are not presented as production-ready actions. The current broadcast trigger suppresses in-app notices for muted members, so promising every member an inbox item requires a backend change. In-app invitation acceptance also needs eligibility and delivery verification before expanding that path. These gaps remain described in the cohesion audit.

Verification: **8 focused suites / 143 tests passed**, covering the resolver, action taps, account retirement, exact-community selection, editor read-only entry, public creator profile navigation, event attempt recovery and contextual Back. TypeScript and `git diff --check` passed. A test initially attempted to stringify a React tree containing a cyclic RefreshControl element; its assertion was corrected to inspect rendered text. No application test failure remains.

The full native walkthrough of this increment remains pending: the separate calendar-reliability task is using the shared Device Hub window on SE/13. This task did not take over that window, change their devices, or claim a native result from automated tests. The existing connected Metro on 8872 continues serving this checkout to the iPhone 17 Pro Max development client. Existing preview-only package/entry changes remain uncommitted.

Changed product files: `app/community/[id].tsx`, `app/creator/edit-page.tsx`, `app/creator/page-edit.tsx`, `app/creator/page-events.tsx`, `components/communities/CommunityCreatorActions.tsx`, `components/communities/CommunityPeople.tsx`, `components/creator/ManagementLayout.tsx`, `components/creator/pages/ApprovedPageEditorScreen.tsx`, `components/creator/pages/CreatorPageEventsScreen.tsx`, and `lib/communityManageEntry.ts`, plus their focused tests and this record. This increment does not establish complete creator UX acceptance or release readiness.


### Connected native follow-up — November 2, 11:15 PM Pacific

After the calendar task released Device Hub, the signed-in iPhone 17 Pro Max / Metro8872 walkthrough completed for the existing Sunset LA Club draft:

- Main chat → community title opened the real community page. The new **Continue setup** and **Edit community** controls appeared under the cover; no Create event button was offered for the draft.
- **Edit community** opened the exact Sunset editor. Basics retained Sunset’s existing name; section navigation and Back returned to that same community page.
- **Continue setup** opened Sunset’s existing settings with its draft/publication state intact. The header said **Back to Sunset LA Club**, and Back returned directly to its community page.
- The header gear opened **Manage Sunset LA Club**, also with the contextual Back destination. That return worked.
- The walkthrough exposed a misleading existing editor summary, “3 live on your page,” on a draft. It now says “3 sections shown on your page.” The new wording was verified in the native accessibility tree.
- Sunset’s creator byline remains absent because it is a legacy draft and the legacy public leader-card RPC only returns active communities. This confirms the documented backend gap; the top-right photo is the signed-in member’s Profile action, not a substitute creator label.

[Actual community screen](</Users/liz/Desktop/WashedUp/Design/Creator management review 2026-11-02/connected-community-direct-actions.png>). This capture is from the connected app, not the fictional prototype. Ordinary layout was visually checked. No Plan, event, community, member, invite or broadcast record was saved/published/sent during this walkthrough. No native build or OTA was made. SE/iPhone13, simulator text settings, and the calendar task’s Metro were untouched; the shared Device Hub window is released with iPhone17ProMax left on the community page.

Still open: active-community event entry on a matching native test identity, page-system profile links and collaborator roles on device, narrow/large-text and Android coverage of this new increment, and the separate backend work for creator identity, invitations and broadcasts. The 143-test result above remains automated coverage rather than proof of those unperformed device cases.


### Community Main chat presentation — November 3, 12:04 AM Pacific

Liz reported that community chat still looked different from the other conversations. The connected Sunset Main screen confirmed the older centered header, separate photo/location controls, small message type and oversized announcement/introduction cards. Compared it directly with the current Friendsgiving plan conversation.

Main now always uses the compact context header and shared community composer, with a live appearance option (white header/composer, beige input, solid terracotta send). Message bubbles use the shared conversation typography and spacing. The profile stays top-right; community navigation stays on the header identity and in chat options. Mute checking/retry/parent controls remain in chat options. Attachments use one + tray and the existing photo/camera/location handlers. Photo viewing uses the existing scoped photo selection.

BroadcastCard has a conversation-only compact surface: message-width cards, shared message type, attached reaction badges, long-press/accessibility reaction entry and an explicit Reply control. The existing reaction policy, message IDs, intro payload, community attribution and nested reply state are retained. Default cards elsewhere retain their original presentation. Link-only announcements retain a whole-bubble open action so the reaction touch surface does not strand that link.

Only presentation was separated from COMMUNITY_CHAT_GROUPING_ENABLED. Its room-identity/history and notification-controller conditions remain unchanged; neither feature flag was enabled. No database, membership, eligibility, send transport, draft recovery, notification subscription or broadcast-delivery code changed. Removed the retired Main header/composer/media styles.

Validation: six focused suites passed (109 tests), then the added link regression and final BroadcastCard suite passed (five tests; **110 unique tests across six suites**). TypeScript and diff whitespace checks passed. Coverage includes default grouping-off entry lifetimes, draft/account retirement, attachment callbacks, legacy history/read markers with creator pages enabled, notification controls, broadcast reaction/reply ownership, and shared header narrow-layout behavior. These component checks do not substitute for narrow-device visual acceptance.

Native iPhone17ProMax / Metro8872: compact header, message/card layout, + attachment tray, focus closing the tray, composer above the keyboard, options showing Mute chat, existing announcement Reply opening/closing, and reaction details loading the existing reaction were checked. No messages/replies/reactions were sent or changed and notification settings were not toggled. An attempted unsent multiline paste did not enter text; native multiline editing is therefore **not** claimed as verified (existing composer automated growth/selection tests passed). Narrow/large-text and Android native checks remain pending. Existing draft Sunset still uses the generic chat title because its card is absent from the legacy public cards read; this change does not claim to solve the separate creator/community identity data gap.

[Connected Main chat capture](</Users/liz/Desktop/WashedUp/Design/Creator management review 2026-11-02/connected-community-chat-parity.png>). The shared Device Hub window was released after this capture; iPhone17ProMax remains on Main. SE/13, their text settings and Metro8884 were untouched. No OTA, store build, backend deployment or data migration was performed.

Changed source: app/community-thread/[id].tsx, components/chat/ChatContextHeader.tsx, components/chat/CommunityChatComposer.tsx, components/communities/BroadcastCard.tsx. Changed tests: CommunityMainHeader, CommunityMainEntryLifetime, CommunityMainQueryIsolation, CommunityChatComposer and BroadcastCardAppearance. Preview-only package.json and creator-review-entry.js remain uncommitted.
