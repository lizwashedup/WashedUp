# People: add paths and shared plans — isolated integration

This package continues the approved People design in the isolated implementation. It is not a production release or an end-to-end invitation/device verification.

## User-visible changes

- Add people uses one compact menu for the four existing paths: completed plans, an external invitation, exact handle lookup and the current person’s QR invite. Full-screen child paths have distinct Back and Close controls.
- Handle lookup retains exact matching. Past plans retains the returned completed-plan backlog and local first-name filtering. Loading, failed reads, empty matches and pending/successful/failed connection requests are distinct.
- The invite flow explains a request that the recipient accepts. Opening the SMS/share composer does not claim delivery. The QR display has a high-contrast quiet area, an optional real photo and a recoverable code-loading error. New installs are told to scan again.
- The relationship page preserves Message, a plan with the person pre-attached, their upcoming plans, shared albums, privacy and remove confirmation. Two real faces, compact counts, short buttons and shared typography replace the older visual treatment. Upcoming plans are not misrepresented as mutual attendance. The earliest returned album is not labeled as the first time two people met.

## Preserved contracts

The original Yours route, feature gates, exact lookup, accepted versus pending relationships, recipient IDs, completed-plan history and profile privacy remain. No joining, Ghost Protocol, community/organization approval, Plan capacity, required introduction, chat expiration, provider or database rules are changed by this package. The bottom navigation stays intact.

The optional Afterglow appearance is passed through Yours → Paths and the existing person route. Unscoped connection callers retain their existing API. The strict request receipt correction is shared: only the three source-confirmed results can confirm a request.

## Demonstrated defects repaired

1. PathsSheet’s nested full-screen modal could remain mounted when its parent said it was hidden. Visibility now controls the complete visit.
2. An invitation could open the phone composer after its original screen/account was gone. Checks now run before and after asynchronous boundaries; they do not cancel a composer already opened.
3. Unrecognized/null connection results previously normalized to Requested. The helper now treats an unknown result as unconfirmed, retaining known server outcomes.
4. A failed lookup could look like nobody matched; failed reads and retry now remain explicit without discarding input.
5. Old query, person, account or screen results could produce later feedback/navigation. Current ownership now travels through these components and scoped connection calls. An already dispatched remote write can still finish.
6. QR failure and invalid code results no longer become an indefinite spinner or a malformed invitation URL. The parser rejects lookalike hosts and incorrect path forms before attempting a claim.

## Verification

362 tests across15 suites and full native TypeScript pass. The fixture also passes TypeScript and Metro. Actual-component browser checks cover320/375/430 layouts, request/history/invite/QR retry, Message recovery, pre-attached plan navigation and vertical history scrolling. Final suite, visual observations and source hashes are recorded in the design review evidence under `verification/people-connections/`. Component transports are simulated. Passing checks establish only the exercised local contracts.

## Still required

- Native keyboard, large text, VoiceOver/TalkBack, native share/SMS composer and real QR scanning.
- Receive-side referral account ownership, pending-link consumption/retry and invalid-code versus network failure. See `people-invite-boundaries-2026-09-13.md`; this package does not claim these are repaired.
- Current deployed server definitions and real invite/connection/privacy behavior on isolated test accounts; no production data was changed.
- Full individual profile presentation, the remaining Circle/Plans/composer screens, and whole-app Figma component parity.
- Community room data preservation rehearsal and two-client chat/read/mute/event-expiry plus notification integration remain early engineering priorities.
