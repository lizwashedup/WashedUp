# Creation clarity: first implementation

Historical first increment. The [creator-management implementation record](/Users/liz/Desktop/WashedUp_HQ/washedup-create-clarity-20261102/docs/creator-management-implementation-2026-11-02.md) supersedes its status and intermediate Event routing: the local code now has a direct form entry with explicit creator identity and renewed access checks. Neither increment has been released by this task.

Status: local implementation, not an OTA release. Base: `aba944642c877f782f38cf63c7427220995c3060`. Worktree: `/Users/liz/Desktop/WashedUp_HQ/washedup-create-clarity-20261102`.

Liz deferred flexible/undated Plans and discussion-versus-trip modeling to make progress on communities, organizations and event creation. Keep those deferred ideas out of this release.

## Implemented

- The bottom + opens three explained choices: Make a plan, Create an event, Start a community. Closing preserves the current tab. Selecting a Plan retains the existing composer and direct/prefilled Plan routes.
- Event and community choices open a focused entry screen. Existing approvals and each community's actual role determine the available destinations. Application failures stay retryable; pending applications open their status instead of starting again.
- Event selection sets the organization/community context and opens the existing guarded Events workspace. It does not bypass that workspace into the older event form. The final direct-to-form shortcut still needs explicit identity and account ownership through the form, not reliance on a global cached access read.
- Existing communities keep their IDs and original routes. There is no data migration, new membership, new chat, or automatic publication.
- Main-community chat had a second percentage width limit inside an already capped message column. Removed that extra squeeze. This is one concrete layout correction, not a claim that the entire chat now matches Plan/topic conversations.

## Source changes

- `app/(tabs)/_layout.tsx`: intercept + tab presses and open the menu; retire it on route/account changes.
- `components/create/CreateMenuSheet.tsx`: accessible, scrollable choices; iOS dismissal sequencing, repeated-tap protection and Reduce Motion support.
- `app/creator/start.tsx` and `lib/creationEntry.ts`: account/visit-scoped reads and existing permitted creation destinations.
- `app/community-thread/[id].tsx`: message-bubble width correction only.
- Three new test files cover menu lifetime/navigation, role-scoped destinations and entry states.

## Preserve during the rest of this work

- Existing communities such as Sunset Club retain members, history, room IDs, invitations, events, read positions and notification preferences. Nobody needs to recreate or rejoin a community.
- Preserve Ghost Protocol and existing gender/age eligibility. The repository contains gender-restricted-community discovery, direct-read and joining controls, plus separate Plan age/gender rules. These are not interchangeable. Do not infer that every community already supports the same age settings as a Plan.
- No changes here to discovery queries, audience settings, database policies, join RPCs or feature flags. Source inspection and mocked regression tests do not verify the current production database.
- Do not switch on `COMMUNITY_CHAT_GROUPING_ENABLED` merely to change appearance. That flag also changes history grouping and room behavior. Main-chat introductions, announcements and nested replies must retain their original history and access.

## Verification

- Creation menu, creation destinations and notification/verified-entry integration: 77 tests passed.
- Creation entry, destinations, Plan joining, community reads/routes and event ownership: 112 tests passed (the seven destination tests overlap the first run).
- Main-community header, entry lifetime, query isolation and chat photos: 101 tests passed.
- Unique total: 283 tests across 12 suites. Application TypeScript and `git diff --check` passed.
- Existing Expo Go push warnings appeared in the chat test runs; they were not test failures.

## Remaining before release

1. Review the actual new menu and connected destinations on iPhone and Android, including small screens, large text, cancellation, returning to a Plan draft and switching accounts. Automated React Native rendering is not device evidence.
2. Compare Sunset Club's actual main conversation against topic and Plan chats. Unify the visible header, bubbles, reactions and composer with shared components while preserving the existing storage and membership rules. Only the extra main-bubble width constraint is corrected here.
3. Finish the agreed community/organization page and creation simplification and improved event cards. Those prototype changes have not been ported by this increment. The application entry intentionally still tells the truth about the existing held review process.
4. Verify the current production audience/visibility contract using eligible and ineligible fixtures, including direct links and inherited community restrictions. Do not broaden access to make the redesigned flow work.
5. Integrate with the independently owned Manage Plan and Interested/survey fixes, preserving their latest release baseline. Then run the release gates and publish the verified package. No OTA or production mutation occurred here.
