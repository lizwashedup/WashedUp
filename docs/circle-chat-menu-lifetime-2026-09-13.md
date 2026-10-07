# Circle and DM parent-menu lifetime

The shared Circle/DM route is `app/(tabs)/chats/circle/[id].tsx`. This package covers that parent route, with actual-parent component tests in `components/chat/__tests__/CircleChatMenuLifetime.test.tsx`. It does not modify `ChatThread`, `ReportModal`, native menu components, data transports, or schemas.

## Reproduced failure

The original route kept two unowned booleans for actions to perform after the DM menu closed. A late `MenuCard.onClosed` could navigate for an old account/room or consume the pending action of a newer menu in the same room. Queued row actions could set both booleans and launch both actions. Native Circle menu callbacks, sheet closes, view-context callbacks, and composer completions also retained unguarded state/navigation callbacks after the route context changed.

The original route was clean in the checkout before this change. Its HEAD contents were saved to `/private/tmp/washedup-circle-route-before.tsx`. A temporary Jest transform substituted that snapshot only during the test run; the current source was not overwritten. The original route fails **16 of 19 cases**, with the three current-action positive cases passing. Log: `/private/tmp/washedup-circle-menu-before.log`.

## Repair

This route now uses the existing read-only `useObservedUser` identity and epoch rather than its forever-cached auth-id query. A local entry identifies the current room/account visit, including account A → B → A. Retired closures fail the entry check even before an auth-triggered React render commits. Entry changes clear pending local menus and sheets; keyed children cannot keep the previous entry’s local form/menu state.

Every DM menu opening owns its own intent and counterpart snapshot. Its first queued row selection wins, and only that menu’s post-dismiss callback can consume the intent. Both **Make a plan** and **Start a circle** still wait until the menu has fully closed. An older menu’s close or closed callback cannot affect a newer menu in the same room.

Measured header callbacks, native iOS/Android Circle choices, context navigation, sheet-close callbacks, and composer completion navigation check their initiating entry. The composer’s existing `onClose` then `onPosted` success order still works for the current entry. Whole-circle plans still remain in their existing chat; plans with their own chat still navigate to `/plan/{event_id}`.

## Verification

All **19/19 actual-parent tests pass** against the repaired route. The suite checks positive DM/native actions, exact DM invite-composer route, post-dismiss ordering, first-action ownership, new-menu isolation, room/account retirement, account ABA, stale sheet/composer/context callbacks, Android callbacks, and unmount.

Command: `npm test -- --runInBand --cacheDirectory=/private/tmp/washedup-circle-menu-jest components/chat/__tests__/CircleChatMenuLifetime.test.tsx`

Log: `/private/tmp/washedup-circle-menu-after.log`. Full `npm run typecheck` passed; log: `/private/tmp/washedup-circle-menu-tsc.log`.

## Preserved behavior and boundaries

The existing `useCircle` metadata/member query, display helper and loading/error fallback, feature gate, member IDs, menus, labels, navigation routes, and styles remain unchanged. The parent adds lifetime checks; it does not change shared report/block behavior or block legitimate actions in persistent Circle/DM chats.

Tests render the actual route with child menus/sheets and identity/data hooks controlled as mocks. They prove the parent callback boundaries and route outputs, not physical native-menu animation timing or server-side membership enforcement. They do not cancel a child mutation already issued before an account/room change. Mutation lifetimes inside `AddPeopleSheet` and `CirclePlanComposer`, plus account scoping of the existing Circle cache, remain separate audits. No production, provider, real account, or database operations were performed; installed dependencies were not modified.
