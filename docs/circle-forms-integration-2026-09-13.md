# Circle forms integration — September 13, 2026

The existing Circle creation, Add people and Circle plan forms now accept the staged cream/Mona/clay appearance through their original routes. Their default presentation remains available. Bottom navigation, accepted-people sources, required fields, original admission permissions and plan destinations are preserved.

## What changed

Creation keeps the three steps: people → name → who can add people. Full-color photo rows with existing @handles under names, persistent labels and optional cover/description sit within a scrollable form. At least two other accepted people are required. Seeds and chosen administrators stay within the currently selected accepted people.

Add people keeps direct addition through the existing invite_to_circle contract, excludes current members, retains selections after failure, and distinguishes loading, empty, unavailable and failed reads. It does not introduce a new acceptance gate.

The Circle plan form uses compact audience choices and the existing title, place, date and time controls. The staged category list is one horizontal strip, preserving all canonical categories and selection callbacks. Public plans explicitly label their required description. Date selection and arbitrary-minute time entry remain supported. Circle members and outside capacity are described separately. The DM form now limits additional people to six, matching the saved create contract; other Circle entries retain seven.

Place selection keeps its existing query/details and chosen-place shape, with source-backed neighborhood text, readable chosen names, recoverable map/image states and visit-owned asynchronous results. No replacement geocoder or new location fields were introduced.

## Confirmed creation versus unfinished setup

useCreateCircle returns a confirmed Circle ID plus separate policy/cover results. A failed optional setup step can be retried against that exact saved ID, without another create call. Unknown creation results direct people to check their Circles before starting again. Immediate locks prevent duplicate actions, and account/visit ownership is checked through asynchronous work and each cache invalidation. Already-dispatched server work cannot be cancelled by closing the screen.

Circle-plan creation now validates a UUID event receipt and an explicit chat-destination boolean before success or navigation. Definite rejected requests remain retryable. Lost replies, server errors and malformed successful replies retain the draft and offer View circle instead of another Post in the same active visit. Returning refreshes the original Circle plans query; an empty cached calendar shows loading until refresh completes. Existing nonempty rows remain readable during refresh. The hook and form both guard repeat submission and stale account/visit callbacks.

This is an in-memory safeguard for the current entry, not a durable idempotency guarantee. The existing plan create RPC has no demonstrated idempotency key. Reopening or restarting still requires checking existing plans before posting again; server reconciliation remains separate. See circle-plan-creation-lifetime-2026-09-13.md.

## Verification

- 268 tests in 15 suites pass; final results saved in the design evidence folder.
- Full native TypeScript, fixture TypeScript, Metro bundle and git diff whitespace checks pass.
- Actual React Native components rendered in a local browser with fictional service adapters. 320px: creation fields/photo/partial setup retry, Add people retained failure/retry, horizontal category selection, calendar date selection, chosen place returning to the retained draft, and DM capacity six. 375px: arbitrary-minute time setting and public plan retained-draft failure/retry to the original plan destination. 430px: unconfirmed creation ends with View circles and no duplicate create action.
- Existing handles are also shown beneath names in Add people, Circle permissions and the plan recipient list. Existing handles are normalized to one @; missing handles are omitted, never invented.
- At 375px the simulated lost plan reply retained the title/date/recipients, removed Post, and View circle closed the form to the original Circle-plan destination. At 430px the normal creation preview visibly shows name plus handle. Test-only failure scenarios now carry an explicit simulation label.
- Detailed case observations, snapshots and source hashes: design verification/circle-forms/VERIFICATION.md.

## Remaining integration

Native keyboard, photo permissions, large text, VoiceOver/TalkBack, gesture and navigation behavior still need device checks. Live Google/storage/RPC behavior is mocked here. Seven calendar columns fit at 320px with 44px-high days; cells are narrower than 44px. Named two-member Circle classification versus the server's member-count clamp and the separate release_circle_plan cap still need a coordinated server contract check. No SQL was modified or executed. Existing recent-place storage remains unchanged.

No real Circle, plan, invitation, message, upload, permission or production deployment was made by this review. The dormant Room feature remains outside this package.
