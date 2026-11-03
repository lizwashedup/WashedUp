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
