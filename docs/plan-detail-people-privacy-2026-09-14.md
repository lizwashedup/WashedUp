# Plan detail: accepted-People handles — September 14, 2026

## Founder corrections

Handles are not public discovery information. Being in the same plan must not reveal a handle or provide a way to request any attendee. Only accepted People supply display handles here. The founder also clarified that the currently deployed live plan page is stronger than this redesign preview. This preview is not visually accepted or finished. Further work must compare whole journeys against the existing experience, rather than treat a visual port and passing tests as success. Figma may support full-flow design decisions, while code/device checks verify actual behavior; existing Figma review frames are not a complete component system.

## Implemented

PlanDetailOverview ignores handles attached to public attendee/profile data and only looks up handles from the current viewer's accepted People payload. The creator read continues to use profiles_public without a handle column. The optional scoped useYoursGrid query verifies the account before dispatch and after async work, includes its generation in the cache key, and rejects retired/aborted responses. Read failure hides cached display handles. Existing relationship mutations invalidate the grid-key prefix. The public MiniProfileCard has no handle or connection request action. No public handle enrichment or new request path was added.

The saved public-profile removal migration and latest public event-member migration omit handles. The accepted-People RPC checks the caller and accepted relationship, excluding blocks. These are source findings, not a verified production database state. Wider profile/chat/privacy and request-path auditing remains outstanding; do not claim whole-app privacy verification.

Small local detail refinements also remain in the candidate: denser logistics/attendee spacing, confirmed member copy, quiet departure beside Open Chat, one-line chat labels. Underlying admission, leave confirmation, creator actions and chat paths are preserved. These changes are not claimed to solve the founder's broader quality objection.

## Verification

95 tests in three suites pass: actual plan-detail presentation/actions, departure sheet, and scoped accepted-People query. Native TypeScript passes. New cases cover accepting only the People handle map, ignoring public-row handles, hiding cached handles after error, removal on a mounted detail, authenticated-account mismatch, retired delayed responses and separate account-generation cache. Existing detail tests retain Circle/private/admission/leave/chat behavior.

Native simulator check: Coffee before the beach shows You’re going / 3 going, including you. Jamie's creator and attendee rows have no handle; Amelia, the sole accepted sample person, shows @amelia.sample. Alex has no supplied accepted-People handle. This uses local fictional services; no live messages, requests, account changes or SQL ran.

## Next quality work

Use the original implementation and confirmed live references as the baseline. A complete live-app screen-by-screen comparison has not happened yet. Consolidate real screen hierarchy, density, navigation, actions, copy and states into reviewable end-to-end flows, then verify them in the native app. Keep design candidate / implemented / visually accepted / integration-verified statuses separate. Whole-app goal remains active and incomplete.
