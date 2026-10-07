# Circle directory and noticeboard: source contract

September 13, 2026. Bounded local source audit, followed by the authorized client-hook repairs below. No production query, SQL edit, migration, permission change or release was performed. Saved SQL comments about prior deployments are historical statements, not current production verification.

## Directory and identity

- `hooks/useMyCircles.ts:14` wraps the no-argument `get_my_circles()` RPC. The supplied user ID gates the query and keys the cache; SQL uses `auth.uid()` to select only joined memberships. It does not filter by Circle status or require an enabled room. Preserve the returned order: newest chat activity first, never-messaged rows after those, then newest creation. Saved SQL: `supabase/migrations/20260530220300_circles_rpcs.sql:181–215`.
- DMs are unnamed, exactly two-member Circles and stay outside Yours → Circles. A named pair remains a Circle; an unnamed group of three or more remains a Circle with member-name identity. Preserve `lib/circles/display.ts:26–58`, not a new arbitrary member-count cutoff. Named Circles use their stored name; unnamed groups batch-resolve other members' names through `circle_members` and `profiles_public`.
- `useCircleMemberPreviews` keys its joined-member batch by user ID and a sorted ID set, ordered by `joined_at`. It returns all resolved members; the display component chooses how many faces to show and computes overflow against authoritative `member_count`. Missing optional names/photos may fall back without blocking the directory. No member visibility expansion is part of this port. Saved Circle-member read policies require membership or app-admin permission (`20260530220000_circles_schema.sql:128–146`).
- Identity imagery remains manual cover → permitted shared-album imagery → monogram. Detail data comes through the already account-scoped `useCircle`; signed album URLs are derived only from returned photo paths. Shared-photo rows are individual photos, not album counts or proof of first meeting.

## Noticeboard plans, capacity and privacy

`hooks/useCirclePlans.ts` preserves this request exactly: events for the selected `circle_id`; statuses `forming`, `active`, `full`; ascending `start_time`; retain rows whose explicit end, or start plus three hours, is later than now. Ongoing plans therefore remain visible. The selected fields and null/default normalization are unchanged.

The established v1 behavior lists Circle plans to Circle members even when a picked subset has its own chat. Do not infer chat membership from appearance in the noticeboard. Whole-Circle, Circle-only plans reuse the Circle chat; open plans and subset plans have their own chat. The saved create function auto-adds the creator, selected members for a private subset, and the counterpart for a whole two-member pair. It does not automatically mark all members of a larger Circle as attending (`20260824180000_fix_dm_circle_plan_stranger_cap.sql:96–158`).

Two different numbers must stay distinct:

| Value | Meaning |
| --- | --- |
| `member_count` on the event | Total people on the plan; not the number of strangers. |
| `circle_size` / `circle_in_count` | Joined Circle size / how many Circle members joined the pinned plan. A participation ratio, not remaining outside capacity. |
| `stranger_cap` | For open plans, 2–7 non-Circle people may join. Circle members do not consume these outside spots. |

The saved atomic join checks the cap under the event row lock and counts only joined participants who are not Circle members (`20260609141000_circle_plan_join_role_cast_fix.sql:45–67`). The public feed computes outside spots from that same distinction. Circle-only plans do not belong in the public feed. Being on an open Circle plan does not itself grant Circle membership.

A two-member Circle/DM is the exception: saved creation clamps outsiders to six so the pair plus outsiders totals eight (`20260824180000_fix_dm_circle_plan_stranger_cap.sql:77–94`). Real groups of three or more may still add up to seven outsiders; seven is not the total group-size cap. The existing source has two follow-up inconsistencies outside this directory port: the composer still allows/display seven for a pair, and saved `release_circle_plan` validates 2–7 without applying the pair clamp (`20260609140100_circle_plan_join_rpcs.sql:156–195`). Neither is silently changed by the visual pass.

`get_circle` supplies only the earliest pinned plan's Circle participation counts; match that row by ID. Do not attach them to every upcoming plan. Its saved detail body limits recent shared photos to nine, newest first, with uploader/visibility checks (`20260611000300_get_circle_detail_data.sql:42–118`). That file has a historical “not yet applied” header, so shape availability remains a release-verification item rather than a claim about live data.

## Suggestions: a proposal, not a new relationship

`useCircleSuggestions(userId)` calls `get_circle_suggestions` and receives pending rows, newest first, with pre-resolved people and shared-plan counts. Start opens `/circle/new?seed=…&suggestion=…`; it does not create a Circle or accept anything immediately. `CreateCircleFlow` intersects seeded IDs with the user's existing People list, so all selected people remain visible/removable. It marks the suggestion `converted` only after `useCreateCircle` succeeds; that housekeeping is best effort and does not block navigation into the created Circle.

Not now requests pending → `dismissed`. The saved owner-only setter returns `dismissed` or `converted` after that transition, and `not_found` when the row is absent, belongs to another account or is already terminal. `not_found` is not a confirmed dismissal. Unknown/null receipts must not be presented as a confirmed action. The hook preserves raw results and SQL semantics; the current directory owns truthful outcome feedback and retry.

The saved initial detection migration lives under `docs/database/superseded-migrations/20260605000000_circle_suggestions_detection.sql`; the stricter replacement is explicitly review-only at `docs/database/review-only/circle-suggestions-v2.sql`. Both describe recurrence of an exact roster across at least three plans, with at least three people. The review candidate additionally removes blocked/ineligible historical rosters and existing exact-roster Circles. Do not describe those candidate filters as shipped behavior without release verification. In the original model a dismissed set may later be suggested again; “Not now” should not promise a permanent opt-out.

## Bounded repairs made during this audit

1. `useCirclePlans` previously returned `[]` for every database error, falsely presenting a failed calendar read as no plans. It now throws the original error, allowing the noticeboard's local loading/error/retry section. The optional `CirclePlansScope { userId, epoch, isCurrent }` extends the existing `['circle-plans', circleId]` query prefix by account and auth generation, verifies the actual account before dispatch, applies the request abort signal and rejects obsolete completion. The route supplies this identity from `useCircle`; no independent global auth store was added. Unscoped callers retain their existing cache key and no added auth read, but also receive truthful query errors.
2. `useSetSuggestionStatus` accepts optional per-call `{ scope: { userId, isCurrent, canDispatch? } }` in the existing mutate/mutateAsync options. It captures the originating account/entry before TanStack can defer work, checks actual auth at dispatch, tracks auth transitions including A→B→A, suppresses retired completion/callback/cache effects and preserves legacy no-scope callers. An already dispatched write cannot be undone. Same-account token refresh stays valid; a late initial auth snapshot cannot replace a later auth transition. `canDispatch` checks a suggestion still exists before dispatch only, so a normal query refresh after a successful write does not make its confirmation obsolete.

3. `useMyCircles(userId, scope?)`, `useCircleSuggestions(userId, scope?)` and `useCircleMemberPreviews(ids, userId, scope?)` now accept the same optional account-read scope. The original user-keyed prefixes are preserved, with a scoped epoch suffix. Actual account confirmation precedes dispatch; abort/ownership checks reject late RPC results and the later unnamed-member enrichment. The directory supplies one stable account-only read scope from `useObservedUser`; reads can finish after focus moves away if the account and observation are still current. Navigation/dismissal entry ownership remains separate. No query columns, filters, server order or optional-enrichment failure semantics changed.

The directory owns immediate duplicate locks, visible pending/error/retry, and dismissing only a confirmed result. These hook changes do not rewrite Circle creation, suggestion detection, membership acceptance, plan capacity, privacy or navigation.

## Remaining demonstrated boundaries

- The demonstrated directory read-ownership gaps are repaired for callers supplying scope, including the actual directory. Legacy unscoped callers retain compatibility rather than acquiring unannounced auth reads; future callers of these private-data hooks should pass a verified account scope.
- `useMyCircles` deliberately ignores errors from optional unnamed-member lookup, potentially showing the neutral fallback title. Keep failure of the primary directory RPC distinct from failure of enrichment.
- The signed album helper remains path-keyed. The membership-scoped detail supplies visible paths, but current storage grants/signing/expiry still need isolated backend verification before release. No new public-image or cross-member sharing guarantee is inferred.
- The plan time window is recalculated on query fetch, not a live expiration timer. The port preserves this behavior.

## Local verification

67 checks passed in three real-hook suites: `hooks/__tests__/useCirclePlans.scope.test.tsx` (14), `hooks/__tests__/useCircleSuggestions.scope.test.tsx` (23), and `hooks/__tests__/useCircleDirectoryReads.scope.test.tsx` (30). Coverage includes exact query/arguments/order/window, total-member versus outsider values, truthful empty/error/retry, account generation and late-response isolation, legacy behavior, auth preflight, deferred/offline mutation scheduling, same-suggestion retry, no stale success/cache effects, and independent scopes for queued suggestions. Full-project TypeScript passed after the scoped-read integration. The combined component/package verification is coordinated with the parent task. Browser/device/backend verification is not implied by these mocked hook results.


The subsequent combined local Circle run passed **153 tests across 8 suites**, with full-project TypeScript clean: the three hook suites above (67), existing `useCircle.account` (20), directory (21), directory presentation (11), detail lifetime (21), and noticeboard presentation (13). This includes the explicit-null-visibility correction: unknown audience metadata now reads “Circle plan” instead of asserting privacy. Report: `/Users/liz/Desktop/WashedUp/Design/Shared Experience - Round 1/verification/circle-pages/scoped-contract-tests.json`. Root may add a further navigation-visit refinement after this snapshot; its tests should be recorded as a later check if changed.
