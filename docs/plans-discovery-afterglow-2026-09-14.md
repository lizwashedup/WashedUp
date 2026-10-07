# Plans discovery — isolated staged implementation, September 14

The feed now opts into the accepted cream/ink/clay and Mona Sans presentation through the existing development flag. The screen has a clear Plans title, accessible filter controls, title-first ordinary and duplicate cards, and a matching Featured card. The existing profile/inbox entry and bottom navigation remain. This package improves finding a plan; it does not change who is eligible to join.

## Preserved contracts

`get_filtered_feed`, featured eligibility RPC, query keys, main feed deadline/retry/stale time, LA date bucketing, category matching, expired-plan exclusion, duplicate lineage/creator cap/order, featured placement, full map collection and plan/profile/duplicate destinations are preserved. Featured items remain separate from date/category-filtered ordinary sections, as in the original. Near me is off by default, asks only after a tap, retains a cached fix, and retains 5/10/25 mi presets with25 mi default.

Both ordinary feed paths use the existing `toPlanCardPlan`; its separately reviewed repair preserves five supplied Circle provenance fields exactly. Missing/null/zero values remain distinct. The outside cap is not remaining capacity. No eligible feed, admission, RPC or schema changes were made by that adapter repair.

## Narrow behavior repairs

- Existing save calls did not inspect returned Supabase errors and showed Saved immediately. `useFeedWishlist` preserves the same collection and insert/delete payloads but checks receipts; only confirmed saves display the compact Saved/Share snackbar. Unknown saved-list reads show retry and disable bookmark writes. Saving is independent of membership and invitations.
- Save calls retain account, focused visit and intent through optimistic work, auth preflight and dispatch. Repeat taps on one account/plan cannot enqueue duplicate writes; different plans/accounts keep distinct locks. A failure restores only that plan, preserving other changes. Retry preserves the original desired state, including when reconciliation already shows the target state. Old feedback cannot cross account/visit boundaries. Same-account pending completion still refreshes a returned view. Reconciliation invalidates the initiating account and the existing saved-plans collection.
- Confirmation callbacks and auto-dismissal on SaveSnackbar are owned by its visible plan receipt. Old timers cannot dismiss a newer saved confirmation; Share and dismissal claim that receipt once. Its existing native animation timing stays.
- Featured sharing catches a rejected platform promise, preserves the existing exact title/URL payload, prevents overlap, and ignores obsolete-card completion. No real share sheet was sent during this package.
- Both filter sheets retain live selection semantics, but now scroll inside current screen bounds above a reachable Done action. Only the grabber handles drag. Hidden, closing and previous-visit callbacks cannot alter a new sheet; animation completion is checked.
- Temporary location failure now retries location instead of opening Settings. Denied permission still opens Settings. Pending attempts block duplicate taps; late results and retained callbacks cannot change a later visit. Existing coordinate/radius semantics remain.

## Verification

**104 tests across eight suites pass**: 98 in `verification/plans-feed/test-results.json`, plus six unchanged real-calendar cases in `calendar-test-results.json`. Full native TypeScript and scoped diff checks pass. The combined test process reported outstanding timers before exiting successfully; the unchanged deadline utility keeps its scheduled timeout even after a settled read. This is not claimed as a zero-open-handle run.

The local fixture imports the actual feed, adapter, cards, filter sheets and new hooks with real React Query. Metro build, fixture TypeScript and resolved dependency checks pass:42 feed bindings plus29 earlier composer/profile/People bindings. A Metro directory-level resolution cache collision was found during verification and corrected only in preview build configuration, so transformed Share/Linking and per-file service replacements resolve to their declared fictional providers. No installed dependency was edited.

Browser checks use fictional normal, filtered-empty, duplicate, known save failure/retry, feed failure/retry and temporary-location-failure/retry cases at320/375/430 widths, including a440-high short-screen case. Test and visual details, source hashes and fixture source copies live in the design verification folder.

## Explicit remaining work

Plan detail and joining/member/creator states are the next package. Circle full/waitlist/ordinary capacity arithmetic is still the previously documented separate gap; badge presence does not complete it. Map, notification inbox, ShareSheet, MiniProfileCard, welcome/profile-completion prompts and the shared ProfileButton need their own full presentation/integration review. Auxiliary featured/member read failures and original feed account-init/prompt ownership need further receipt/error review; they were not silently redesigned here.

Browser providers simulate focus/auth, map, notification inbox, sharing and location. Native tests check operation lifetimes with controlled providers. Neither proves physical keyboard/Dynamic Type/VoiceOver/safe areas, real OS permissions/sharing, server counts/eligibility/delivery or two-client behavior. The server can finish a dispatched operation after navigation; these local guards are not atomic cancellation or server idempotency. No SQL, production/TestFlight change, real plan/save/invitation/notification or deployment occurred.
