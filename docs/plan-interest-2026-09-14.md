# Next time interest — September 14, 2026

Isolated local implementation. Nothing deployed or sent to real people.

## User experience and preserved rules

The actual Plan screen explains the small optional action: “Can’t make this one? Let [creator] know you’d join another time.” The button is “Next time” in both appearances and keeps the existing soft gold treatment. A valid saved signal shows “Interest saved”, without claiming the creator has already seen it. Known rejections offer Try again; uncertain outcomes offer Check interest, which only reads. Recovery remains reachable when the plan closes. The creator’s failed interest-list read is explicit rather than a false empty list.

Future interest remains separate from joining. Ordinary full plans and age/gender-incompatible plans can still collect future interest. Visible open Circle plans, including those with no outsider spots, and private Circle plans visible to a Circle member preserve that independent action. Private Circle outsiders, unknown Circle context, missing/failed current plan or membership reads, creators, joined members and ended/cancelled/completed plans cannot dispatch new interest.

## Implementation

`hooks/usePlanInterest.ts` owns exact active signal reads and a synchronous pending lock. Reads check the initiating account; submissions re-read the exact signal, plan lifecycle/provenance, own joined membership and, for a Circle, the existing strict Circle-context receipt. The shared Circle parser is exported without changing its validation contract. The original `send_interest_signal(p_event_id)` remains the only write.

Only a valid UUID confirms that RPC result. An existing exact active signal resolves a preflight without another write. Known PostgreSQL rejections allow retry; transport errors or malformed receipts remain uncertain until an exact own active signal is read. An empty recovery read does not replay the RPC. Account-generation and focused-visit ownership discard stale results; returning during a dispatched write refreshes after settlement. Creator interest reads now use the account epoch and distinguish failures from empty lists.

## Checks

- 269 tests in five suites pass: interest controller, actual Plan route presentation, Circle-context ownership/parser, invitation and joining regressions.
- Native and fixture TypeScript checks pass; Metro bundle builds.
- 93 Plan detail/creator/interest provider bindings plus 29 inherited bindings pass. Actual native controllers/components/React Query remain; service, navigation and platform actions use fictional adapters.
- 45 local transport contracts pass. Future interest records neither membership nor chat-message writes. Fixture joined-status filtering was corrected to honor the actual own-membership query; existing transport contracts still pass.
- Browser 375×667: deliberately lost receipt, Check interest, then Interest saved with one recorded interest attempt/write, no membership or chat message.
- Browser 320×568: deliberate rejection with a reachable Try again button and no false saved feedback. Retry outcome is recorded in the accompanying browser evidence.

## Remaining limits

Saved `send_interest_signal` definitions lack Circle-visibility and cancelled-status enforcement; client checks do not establish a server authorization boundary. Their active-existing return avoids many repeat sends, but concurrent first sends can both reach notification insertion. Fresh preflight reads and the write are not atomic. No SQL was changed or live server verified. Server policy/concurrency, real notification delivery, physical-device accessibility/large text and cold-remount recovery remain separate integration requirements.

Unknown recovery deliberately cannot infer historical success if a signal was consumed/expired before checking. Mounted guards are not durable server idempotency. The preview is fictional and does not prove live data visibility or delivery. Existing creator-list cards and privacy-safe profile fields are preserved.

## Next

Audit and repair the shared Circle Plan-card capacity/CTA mapping: the current card still derives its base full/waitlist decision from ordinary capacity despite Circle provenance. Preserve actual outsider allowance (up to seven for Circles, the saved six-outsider exception for two-person DM-origin plans), total group size, creator attribution and private/public distinctions. Do not invent outside availability when the feed lacks it. Physical-device and backend/chat-history/notification testing, wider creator/organization coverage and final handoff remain on the whole-app queue.

[Local review](http://127.0.0.1:8843/plan-detail-review.html)
