# Direct Plan invitations — isolated implementation

September 14, 2026. Actual Plan route/controller with fictional local preview services.

## Changed

- Opening an invitation starts the existing joining introduction. It does not update the invitation to accepted. Cancelling discards that handoff. Only the confirmed joining callback starts acknowledgement, which independently verifies the exact own membership is joined before writing accepted. Invitation acknowledgement never creates membership.
- Pending reads filter the event and recipient, sort by created time then ID and take one row. Multiple different senders are valid under the saved unique key; the UI acts on the chosen invitation only, not a broad recipient update.
- Replies filter exact invitation/event/recipient and pending status, and require an exact returned terminal row. Known rejection retains the intended reply; unknown receipts offer a read of that invitation rather than another write. An opposite terminal reply is respected. Missing or failed reads do not claim success.
- Account, focused-visit and attempt guards prevent late callbacks from dispatching for a retired screen. Immediate locks cover authentication, membership checking and update dispatch. A prepared joining callback can be consumed once.
- Optional invitation failure stays separate from confirmed membership and chat access. The normal sharing/ticket/chat handoff remains. No claim that declining is secret: the saved sender SELECT policy permits the sender to see the status.
- Short invitation actions use the current optional visual system. A rejected decline offers retry or Keep invitation, without pushing a new join. Keeping is available only for a known failed decline; an uncertain reply cannot be discarded as though it failed.

## Checks

243 tests across five suites pass, including 30 invitation-controller cases and 73 actual-route cases plus joining, waitlist and exception regressions. Native and fixture TypeScript pass; Metro builds. 79 detail provider bindings and 29 inherited bindings pass, retaining the actual route/controller and React Query with local service replacements. 34 fictional transport contracts pass. The route test now mocks telemetry rather than leaving Sentry's cleanup timer running; the diagnostic run exits successfully.

Phone browser checks at 375 × 667 and 320 × 568 cover cancellation/reopening of joining, required introduction/attendance, membership followed by a deliberately lost invitation receipt, read-only reply recovery and rejected-decline retry. Screenshots and source hashes are adjacent.

## Limits

The saved SQL is contract evidence, not proof of current deployed policies. Membership checking and invitation acknowledgement are separate client requests, not an atomic server transaction: concurrent departure/status changes still require backend validation. Guards persist only in this mounted controller; cold-remount or interrupted acknowledgement after joining is not a durable work queue. Other pending invitations from different senders are not automatically accepted. Real notification delivery, account-switch navigation, iOS/Android dismissal/keyboard behavior, large text and screen-reader journeys remain integration checks. Browser navigation is stopped at the fictional destination boundary, so the browser recovery screenshot does not prove native return navigation.

No production, preserved source, database, real membership, invitation, message or provider setting changed.

Next bounded package: creator Waitlist manager at app/waitlist/[id].tsx. Audit and preserve its first-eligible-person order, masked later rows, three exception-slot cap and original RPC semantics while adding scoped action/recovery and the approved optional presentation. Do not conflate its intentional queue masking with the removed recency shading on People. Remaining community/organization management, supporting surfaces and complete device/backend release checks remain open.

Evidence: /Users/liz/Desktop/WashedUp/Design/Shared Experience - Round 1/verification/plan-invitation
