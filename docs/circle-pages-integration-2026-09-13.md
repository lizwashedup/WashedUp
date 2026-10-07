# Circle directory and noticeboard integration

September 13, 2026. Isolated implementation; no production changes.

## What changed

The original Yours → Circles directory and Circle detail route now opt into the reviewed Afterglow appearance under `COMMUNITY_CHAT_GROUPING_ENABLED`. This uses the existing cream, ink, clay and Mona tokens. Bottom navigation is untouched. The directory uses compact photo-led rows with readable group names, member counts and honest last-message metadata. The Circle page puts its name below its cover, followed by its existing plan/chat/invitation actions, read-only people row, upcoming plans and permitted recent photos.

Presentation is optional. Shared legacy callers retain their original appearance. The complete original member roster remains horizontally scrollable; it is not converted into a new connection or profile action. Long plan titles and places wrap. Touch targets in the 320px review measured at least 44px.

The identity order remains manual cover, permitted shared imagery, then a monogram. A failed manual cover can use the permitted fallback. A failed staged mosaic drops that image and uses the remaining ones; if none remain, it shows the Circle identity. Failed member images also have a neutral fallback. This does not broaden access to album media.

## Preserved contracts

- Original joined collection and returned order. Unnamed exactly-two-person DMs remain in Chats; named pairs and unnamed larger groups remain Circles.
- Existing Circle, chat, plan, creation and invitation destinations. The directory suggestion seeds creation with the latest returned membership list for that suggestion ID.
- Original approval, invitation and membership rules; no SQL, role, capacity or eligibility changes.
- Original upcoming-plan status, time-window, ordering and field queries. Private subset plans appearing in the noticeboard do not imply membership in their chat.
- Pinned capacity is the number of Circle members going, not remaining public spots. Open-plan outside capacity remains separate. Unknown visibility now says “Circle plan” rather than claiming private access.
- Naming and leaving retain their existing authority, confirmations and receipt checks.

Exact saved-source contracts and capacity follow-ups: [source audit](circle-directory-noticeboard-contract-2026-09-13.md).

## Demonstrated reliability fixes

Failed plan reads previously returned an empty array. They now expose a recoverable query error, with a local retry that leaves Circle information available. The directory and plan hooks accept account-generation scopes, check account ownership before dispatch, carry abort signals and reject retired results. Existing cache prefixes still support existing invalidations. Primary read failure stays distinct from missing optional name/photo enrichment.

Suggestion dismissal now has an immediate duplicate guard, pending state, accurate accessible label, retained failure/retry and exact confirmed-result handling. Its per-call scope reaches the actual queued mutation, including auth preflight, auth transitions and current-only callbacks/cache effects. “Not found” does not become a fictional successful dismissal. Already dispatched operations cannot be undone by retiring the screen.

Circle route taps have a focused-visit latch: repeated Plan/Open chat/Back actions do not push duplicate routes, and old callbacks cannot navigate after leaving and returning. The background calendar read remains owned by the account/readable detail, independently of focus, so ordinary return does not retire that read.

## Review and verification

[Actual-component review](http://127.0.0.1:8843/circle-pages-review.html). Its directory and noticeboard are imported from this source; only services and navigation outcomes are simulated. Root route guards are covered by their focused component tests, not by the fixture's simplified header.

The final test result and source hashes are stored in `Design/Shared Experience - Round 1/verification/circle-pages/`. The ten-suite check includes the directory, its presentation, noticeboard, route, naming/leave preservation and real scoped hooks. Full native TypeScript and fixture TypeScript/Metro are checked separately.

Browser checks cover 320/375/430px layouts, original route callbacks, long title/place wrapping, horizontal roster and vertical page scrolling, failed reads with retry, suggestion pending/failure/retry, cover fallback and distinct empty states. Photos and people are fictional fixture data. No real invite, message, account action or database write occurs.

## Remaining work

1. Circle creation, adding people and the Circle plan composer retain their existing implementation and need their own staged presentation pass. The reserved Room control is preserved in the native route but omitted from this focused component fixture. Do not build the reserved Room feature as part of this redesign.
2. Reconcile the demonstrated two-person composer limit with saved creation/release behavior: saved creation clamps outside capacity to six, while the composer offers seven. This package does not alter that rule or deploy SQL.
3. Isolated backend preservation, multi-device navigation and scroll, large text, VoiceOver, native keyboard/modal behavior and actual storage/network failures remain required before release. Mock success does not establish durable server success.
4. Signed album URLs remain path-keyed; current storage grants and expiry need backend verification. The Circle plan time window still recalculates on fetch. A generalized simultaneous-observer ownership model for the plan hook remains a future shared-query concern; the current noticeboard is its only source caller, and the route duplicate guard avoids the normal duplicate-detail path.

The larger community, organization, chat delivery and notification work remains in the whole-app queue. This Circle package does not establish completion of those systems.
