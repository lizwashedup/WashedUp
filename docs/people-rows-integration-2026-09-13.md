# People rows: integrated isolated package

September 13, 2026. Continued at Liz’s request after the photo-left row review. Built behind the existing development-only Afterglow flag; not deployed. This is a reviewable implementation candidate, not a claim that the complete Yours journey or whole app is done.

## Connected implementation

- `PeopleScreen` accepts optional Afterglow appearance, with `PeopleListRow` and compact recent faces. Every recency bucket uses full-color photos. Missing and failed photos use initials; replacement URLs can load.
- `YoursScreen` supplies appearance to the header, tabs, populated People body, search results and person menu. Shared header/menu props are optional. The default grid/palette remains when appearance is absent. Bottom navigation is unchanged.
- Main row opens the existing relationship page. Separate 44-point options and long press retain Message, Make a plan, Start a Circle and View profile. Existing group feature gates remain authoritative. Options hints deliberately describe available actions instead of promising disabled features.
- Recent membership and received order stay unchanged. Complete connections remain sorted with the existing first-name comparator. Upcoming context describes the other person’s visible plan and does not imply both users joined it. Otherwise show shared-plan count, handle or no unsupported metadata.
- Search retains the mounted input and scroll container; local accepted connections match name/handle substrings. New-person lookup remains the existing debounced exact-handle lookup, with deduplication. No new directory, RPC or request-acceptance behavior.
- Search results use the same photo-left anatomy. Incoming requests offer `View`, opening the existing minimal profile; this is not falsely labelled `Respond`, because that destination does not provide request decisions. Acceptance remains in the existing Requests surface.

## Concrete reliability repairs

Search failure is distinct from an empty result, offers retry and leaves local results visible. A query-settle/current-handle guard hides the previous remote person while a different handle is being looked up. Add uses an immediate per-person lock, account-scoped pending/confirmed state and correct requested versus connected outcomes. Late account/query feedback is suppressed.

Person menu actions use a consumable ticket tied to account, focus, People tab and the current connection. The menu’s existing close-then-action event still works. Late or malformed DM results cannot navigate after an obsolete selection/account/tab/focus. An auth observer clears ephemeral People state when the identity changes. No backend operation, relationship policy or database definition was altered.

The new horizontal tab strip has `flexGrow: 0` and `flexShrink: 0` so it retains content height. Native/device large-text and screen-reader checks are still required.

## Verification completed

- Four combined native test suites: **79 tests pass** (20 presentation,31 parent,19 search,9 shared row). Covers preserved sorting/collection/actions, stable input, photo lifetimes, stale menu callbacks, request duplication, account transitions and failure/return behavior.
- Full project TypeScript passes. Scoped diff whitespace check passes. Local Metro web component bundle builds.
- Actual native components rendered through React Native Web: at320px the root had320px content/scroll width, normal rows82px, long name93px and options44×44. At375px the root had no horizontal overflow and tab strip49px height.
- Browser interaction: options → Message produced the correct local person result; search retained a focused input and correct local matches; exact `sam.local` lookup showed Sending then Requested; failed lookup left Amelia/Jamie matches visible and retry recovered. Failed photos displayed the right initials. In the120-person fixture the final alphabetical row, Theo96, remained reachable and opened its correct local destination.
-430px photo fallback was inspected. Browser geometry inspection after viewport/navigation later timed out, so no additional numeric430px geometry result is claimed. No native FPS, iPhone keyboard/VoiceOver/Dynamic Type or live-service claim follows from this browser check.

## Review and fixture boundary

[People native review](http://127.0.0.1:8843/people-native-review.html) provides320/375/430 widths plus default, photo failure, lookup retry and120-person cases. It imports actual components from the isolated app; service hooks and top-level profile/tab/navigation callbacks are explicitly local fixtures. Photos/names are fictional stock examples. The existing design walkthrough remains separately available. This is not a Figma publication.

Fixture sources and resolver are copied to `Design/Shared Experience - Round 1/verification/people-native/`. The active local runtime remains `/private/tmp/washedup-community-review`, serving port8845. UI automation could read the wrapper iframe but could not click its React Native targets, so interactions were verified directly at8845 with temporary phone viewports; the browser override was reset afterward.

## Remaining work before this package is complete

1. Port and review existing request, add-people, minimal-profile and relationship detail sheets; empty/fresh states retain their current logic and are not claimed visually finished by this slice.
2. Test an actual iOS build for keyboard retention/return, large text, menu placement, photo loading, long-list behavior and screen-reader actions. Existing ScrollView renders the complete collection; benchmark it before choosing a virtualization change and preserve input/scroll lifetime if changed.
3. Audit the shared `useGetOrCreateDm` hook’s auth ownership. Parent navigation is guarded, but the shared hook still dispatches its RPC and dirties the inbox under its existing policy; this slice is not proof of hook/server account-scope correctness.
4. Verify actual accepted-connection/block/RPC and request outcomes against an isolated backend before release. Production and saved data are untouched.

## Files

Native: `components/yours/YoursScreen.tsx`, `header/YoursHeader.tsx`, `header/YoursTabs.tsx`, `people/PeopleScreen.tsx`, new `people/PeopleListRow.tsx`, `search/PeopleSearchResults.tsx`, `paths/PersonRow.tsx`, `components/menu/MenuCard.tsx`, and four focused test files under the corresponding `__tests__` folders. Companion component contract: `docs/people-native-rows-2026-09-13.md`.
