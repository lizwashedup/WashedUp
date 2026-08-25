# Live ticketing, payout, admin, and ban function audit

Date: 2026-08-24

Status: Review only. No production query or mutation was performed for this report.

## Bottom line

The captured ACLs are materially safer than the earlier drift report could prove. The same-day schema dump shows all 33 reviewed functions owned by `postgres`; every privileged money-mutating and user-deleting routine reviewed here has `PUBLIC` revoked and is granted only to `service_role`. The intended client-facing exceptions are explicitly granted to `anon` or `authenticated`. No captured ACL exposes `admin_cascade_delete_user`, ticket settlement, ticket refund recording, receivable consumption, payout enumeration, or refund-review mutation to ordinary clients.

That closes the feared immediate public-execution hole for the 12:53 PM schema capture. It remains point-in-time evidence, not a fresh live query, and the missing migration provenance means those safe ACLs are not reproducible from the repository for most of this cluster.

The body review also found confirmed correctness risks independent of ACLs:

- three ordinary report rows can trigger an automatic ban without distinct-reporter enforcement in the function, while existing sessions remain alive and all failures are swallowed;
- per-attendee ticket answers accept attendee index `0` and negative values;
- the 11-question limit can be exceeded by concurrent writes;
- organizer receivable consumption overwrites prior payout attribution on partially consumed rows;
- administrative bans aggregate and retain an unbounded copy of a user's private messages, which can make the ban transaction fail for large accounts and creates an undocumented sensitive-data retention path;
- ban-check helpers normalize email and phone identifiers inconsistently;
- refund-review resolution deletes the only visible reason and timestamp instead of preserving a resolution trail;
- a fully blocked payout produces repeated logs but no durable administrative work item.

## Evidence boundary

Primary captured evidence:

- `/private/tmp/claude-501/-Users-josh-Desktop-Crucible/b3e1e01c-5010-4167-9bbb-782220acae69/scratchpad/audit/live_functions.json`
  - filesystem timestamp: `2026-08-24T16:05:39-0700`
  - SHA-256: `679b2884635d5a85e1190077628279760d4857f2ccc58ffdcebbe17f94e29fe5`
- `/private/tmp/claude-501/-Users-josh-Desktop-Crucible/b3e1e01c-5010-4167-9bbb-782220acae69/scratchpad/audit/live_triggers.json`
  - filesystem timestamp: `2026-08-24T16:05:36-0700`
  - SHA-256: `917b15c7c045971c85900f100fc942e22e10e657b110ccee153075893c5468ee`
- `/private/tmp/claude-501/-Users-josh-Desktop-Crucible/b3e1e01c-5010-4167-9bbb-782220acae69/scratchpad/wu-schema-dump.sql`
  - filesystem timestamp: `2026-08-24T12:53:21-0700`
  - SHA-256: `cbd8882fd68218d1056c114411e63501e16392694fa9f504c2031190f440df31`
  - includes function owners plus emitted `GRANT` and `REVOKE` statements
- repository callers, migrations, and documentation present in this worktree on 2026-08-24.

The file timestamps show when the local capture artifacts were written. They are not a database transaction timestamp. This report describes the captured definitions only and does not claim that production remains byte-for-byte identical after that capture.

### What the capture proves

- the captured function body and signature;
- whether the captured definition says `SECURITY DEFINER` or invoker;
- the captured trigger to function attachment;
- the owner and emitted ACL statements in the 12:53 PM schema dump;
- which function names have or lack a `CREATE FUNCTION` source in the repository migration set;
- which repository callers reference the functions.

### What the capture does not prove

- ACL changes made after the 12:53 PM schema dump;
- whether role membership or an external gateway changes effective reachability beyond the emitted grants;
- default privileges in force when each function was created;
- whether an out-of-repository ACL change occurred after creation;
- table constraints that were not included in the capture, including uniqueness constraints relied upon for idempotency;
- actual production call frequency, recent failures, row counts, or current Stripe state;
- complete semantic equivalence between live definitions and a reproducible migration baseline.

The separate table-grant artifact covers table grants and RLS. The schema dump supplies the routine ACL evidence that artifact omitted.

## Scope

### Ticketing and payout functions reviewed: 24

1. `can_buyer_self_refund`
2. `claim_ticket_hold`
3. `compute_ticket_refund`
4. `consume_organizer_receivables`
5. `flag_order_for_refund_review`
6. `gen_ticket_reference_code`
7. `get_ticket_tier_availability`
8. `is_ticketing_organizer`
9. `list_ticket_payouts_blocked`
10. `list_ticket_payouts_due`
11. `price_ticket_checkout`
12. `quote_ticket_checkout`
13. `record_ticket_checkin`
14. `record_ticket_refund`
15. `release_ticket_order_stock`
16. `resolve_order_refund_review`
17. `settle_ticket_hold`
18. `tg_ticket_answers_validate`
19. `tg_ticket_orders_release_stock`
20. `tg_ticket_payouts_release_gate`
21. `tg_ticket_questions_cap`
22. `tg_ticket_refunds_write_receivable`
23. `tg_ticket_tiers_require_end_time`
24. `tg_ticketing_touch_updated_at`

All 24 lack a `CREATE FUNCTION` source in the repository migration comparison, even though later migrations call or modify parts of this subsystem. Twenty-one of the 24 are captured as `SECURITY DEFINER`; the invoker functions are `gen_ticket_reference_code`, `price_ticket_checkout`, and `tg_ticketing_touch_updated_at`.

### Admin and ban functions reviewed: 9

1. `admin_ban_user`
2. `admin_cascade_delete_user`
3. `auto_ban_reported_user`
4. `banned_identifiers_set_normalized`
5. `check_banned_apple_sub`
6. `check_banned_at_signup`
7. `check_banned_phone_at_signup`
8. `is_identifier_banned`
9. `is_photo_banned`

Eight lack a `CREATE FUNCTION` source in the repository migration comparison. `auto_ban_reported_user` is created by `20260403000001_auto_ban_on_reports.sql`. Seven are captured as `SECURITY DEFINER`; `banned_identifiers_set_normalized` and `is_photo_banned` are invoker functions.

`20260814170000_lock_down_ban_oracle_and_cron_functions.sql` supplies explicit ACL intent for `is_identifier_banned` and `check_banned_apple_sub`. The schema dump confirms those intended grants in the 12:53 PM capture. No equivalent repository ACL record was found for `admin_ban_user` or `admin_cascade_delete_user`, even though the captured database ACL correctly limits both to `service_role`.

## Findings

### P1: Safe captured ACLs are not reproducible from repository migrations

The 12:53 PM schema dump resolves the immediate exposure question:

- all 33 reviewed functions are owned by `postgres`;
- the privileged ticketing, payout, refund, receivable, and destructive admin routines revoke `PUBLIC` and grant only `service_role`;
- `get_ticket_tier_availability` is intentionally granted to `anon`, `authenticated`, and `service_role`;
- `quote_ticket_checkout`, `price_ticket_checkout`, and `record_ticket_checkin` are intentionally granted to `authenticated` and `service_role`;
- `is_ticketing_organizer` is intentionally granted to `anon`, `authenticated`, and `service_role` because captured RLS policies call it;
- `check_banned_apple_sub` is granted to `authenticated` and `service_role`;
- `is_identifier_banned` is limited to `service_role`;
- `is_photo_banned` is an invoker function granted to `anon`, `authenticated`, and `service_role`; captured RLS on `banned_identifiers` limits ordinary callers to admin-authorized rows.

No captured ACL allows an ordinary client to invoke ticket settlement, refund recording, payout enumeration, receivable consumption, refund-review mutation, `admin_ban_user`, or `admin_cascade_delete_user`.

The remaining risk is provenance. All 24 ticketing and payout functions and eight of the nine admin and ban functions lack a canonical `CREATE FUNCTION` migration source. Most of their safe ACL statements are therefore live state without a complete repository reconstruction path.

Impact:

- a reset or rebuild cannot reproduce the captured function bodies and grants from the repository;
- a future `DROP` plus `CREATE` can restore unsafe default execute privileges unless every signature repeats the explicit revokes;
- reviewers cannot reliably distinguish intentional live code from historical drift;
- fixes risk changing a body while silently losing its ACL.

Required follow-up:

1. Generate reviewed baseline migrations for exact signatures, bodies, owners, triggers, and grants.
2. Add deterministic ACL assertions that fail if protected functions are executable by unintended roles.
3. Preserve the captured split between service-only routines and intentional client reads.
4. Re-run a fresh read-only owner and ACL query immediately before any live migration that replaces one of these functions.

### P1: `auto_ban_reported_user` can be driven by three raw report rows

Evidence:

- the function counts all reports for the target except reason `Blocked by user`;
- it does not count distinct reporters;
- it does not reject repeat reports, self-reports, colluding reporters, or reports created in a short burst;
- the captured report INSERT policy only proves `auth.uid() = reporter_user_id`;
- no report-table uniqueness constraint was included in the capture;
- after count 3, it updates `auth.users.banned_until` directly.

Impact:

- if the table has no separate uniqueness constraint, one account can create three rows and ban another user;
- even with a one-reporter-per-target constraint, three colluding accounts can automatically deny access without human review;
- the function does not insert a durable moderation action or banned identifier record, so the automated path does not match the administrative-ban audit trail.

Required follow-up:

- capture and verify report-table constraints before claiming exploitability or safety;
- count distinct eligible reporters in the function even if a uniqueness constraint also exists;
- reject self-reports at the database boundary;
- write a moderation action before or with the automated restriction;
- route threshold hits to a review state unless Liz has explicitly approved irreversible automatic bans.

### P1: Automatic bans do not terminate active sessions and swallow every failure

`auto_ban_reported_user` changes `banned_until` but does not delete active sessions or refresh tokens. `admin_ban_user` explicitly does both, showing that the two paths have different enforcement behavior. A user automatically banned by reports may remain active until the auth system next enforces the ban during refresh.

The function also catches every exception and returns the report row without recording an error. A permission error, schema drift, or auth-table failure therefore creates a report that appears accepted while the ban silently fails.

Required follow-up:

- centralize the enforcement operation so automatic and manual restrictions share session revocation and audit behavior;
- never use `WHEN OTHERS THEN RETURN NEW` without a durable failure signal;
- add a monitored failure table or explicit alert path that cannot recursively invoke this trigger.

### P1: `auto_ban_reported_user` has an unsafe definer search path

The function is `SECURITY DEFINER`, has no `SET search_path`, and references `reports` without schema qualification. This differs from the other reviewed definer functions, which set a path.

Impact:

- object resolution depends on the effective search path;
- a writable schema earlier in the path could redirect the privileged query;
- even without a present exploit path, the function is fragile under schema and role changes.

Required follow-up:

- set `search_path = pg_catalog, public, pg_temp` or the project's approved equivalent;
- qualify `public.reports` and `auth.users` explicitly;
- include search-path checks in the function audit verifier.

### P1: Administrative ban copies an unbounded private-message archive into moderation metadata

`admin_ban_user` aggregates every message authored by the target with `jsonb_agg(to_jsonb(m))`, then stores the result inside `moderation_actions.metadata` before deleting the messages.

Impact:

- a prolific account can force a very large in-memory aggregate and oversized write, causing the entire transactional ban to fail;
- private messages are duplicated into a less obvious retention surface;
- the function has no retention period, size cap, field minimization, or documented access rule for the copied content;
- account deletion and moderation retention semantics become difficult to explain and audit.

Required follow-up:

- get an explicit legal and product retention decision before preserving message content;
- if evidence retention is approved, store a bounded, purpose-specific snapshot with a documented retention period and access policy;
- separate ban enforcement from optional evidence collection so a large history cannot prevent enforcement;
- test large-account behavior transactionally.

### P1: Financial receivable rows lose partial-consumption provenance

`consume_organizer_receivables` increments `consumed_cents` and stores one `last_stripe_payout_id`. When one receivable is consumed across multiple payouts, a later payout overwrites the only payout ID stored on the row.

Impact:

- the final balance remains arithmetically correct, but the database cannot reconstruct which earlier payout consumed which amount from that receivable;
- disputes and reconciliation require logs or external Stripe data instead of an immutable allocation ledger;
- a partial consume followed by an operational incident lacks a durable per-payout trail.

Required follow-up:

- add an append-only `organizer_receivable_allocations` ledger keyed by receivable ID and payout ID;
- enforce uniqueness for a payout and allocation identity;
- make the receivable balance derive from or reconcile against allocations;
- backfill only after a reviewed reconciliation plan.

### P1: Fully offset payouts have no durable resolution workflow

`list_ticket_payouts_blocked` identifies organizers whose gross due is fully consumed by outstanding receivables. The edge caller logs each result, but the reviewed path does not create a durable admin work item, acknowledgement, or resolution record.

Impact:

- the same blocked state can log every run indefinitely;
- a production logging gap can hide an unresolved money state;
- there is no clear distinction between expected netting and an item that requires review.

Required follow-up:

- persist a deduplicated payout-blocked alert or review row;
- include first seen, last seen, gross, outstanding, and resolution state;
- do not send user-facing messaging without Liz's approval.

### P2: Per-attendee ticket answers accept zero and negative indexes

`tg_ticket_answers_validate` rejects `NULL` and values greater than the order quantity, but it never checks `new.attendee_index < 1`.

Impact:

- index `0` and negative indexes satisfy the trigger;
- malformed attendee answers can become detached from every real ticket position;
- downstream rendering and fulfillment code can receive impossible records.

Required follow-up:

- require `attendee_index BETWEEN 1 AND qty` for `per_attendee` questions;
- require `attendee_index IS NULL` for `per_order` questions;
- add a table check where practical and regression tests for `-1`, `0`, `1`, `qty`, and `qty + 1`.

### P2: The active-question cap is raceable

`tg_ticket_questions_cap` counts active sibling rows in a `BEFORE` trigger but takes no event-level lock. Two concurrent writes can both observe 10 active questions and both commit, leaving 12.

Impact:

- the stated 11-question invariant is not guaranteed by the database;
- concurrent admin tabs or retries can create invalid state.

Required follow-up:

- serialize active-question writes per event with an advisory lock or an event-row lock;
- add a concurrency regression test;
- keep the user-facing cap unchanged unless Liz approves a product change.

### P2: Ban identifier checks apply different normalization rules

The signup trigger uses `normalize_email`, including Gmail dot and plus handling. `is_identifier_banned` compares `email = lower(trim(check_email))` instead of `normalized_email`. Phone signup strips non-digits, while `is_identifier_banned` compares phone text exactly. `check_banned_apple_sub` is exact.

Impact:

- the same identifier can return different answers depending on which helper a caller uses;
- service-side preflight checks can disagree with the actual signup trigger;
- support tooling may report that an identifier is clear even though signup will reject it, or the reverse for formatting variants.

Required follow-up:

- make one canonical identifier-check function use `normalized_email` and one canonical phone normalization routine;
- make signup triggers and service callers delegate to that function;
- preserve the existing ACL intent that ban-oracle helpers are not anonymous.

### P2: Refund-review resolution erases the operational trail

`resolve_order_refund_review` sets the review flag false and clears both reason and flagged timestamp. No immutable resolution row is written by this function.

Impact:

- the database loses why the order was flagged and when it was flagged;
- later reconciliation cannot distinguish automatic resolution from manual intervention;
- direct execution by an overprivileged role would erase evidence in addition to clearing workflow state.

Required follow-up:

- preserve original reason and timestamps;
- add resolved time, resolver, resolution reason, and source;
- use an append-only review-action table for money-sensitive cases.

### P2: Refund-review notification is coupled to one hard-coded email

`flag_order_for_refund_review` looks up one auth user by a hard-coded email and silently skips the durable notification if no row matches.

Impact:

- an email change or account replacement removes the notification path;
- other approved administrators cannot receive the work item;
- the review flag still exists, but the expected alert can disappear.

Required follow-up:

- route operational alerts to an approved admin role or explicit notification configuration;
- retain the database review flag as the source of truth;
- do not change recipients or user-facing behavior without approval.

### P2: `admin_ban_user` allows blank reasons and self-targeting

The function checks that the caller is in `admin_users`, but does not reject a blank reason or `target_id = caller_id`.

Impact:

- moderation records can be created without useful rationale;
- an operator mistake can ban the acting administrator and delete their own profile content;
- the returned JSON includes sensitive identifiers that should remain limited to an approved admin surface.

Required follow-up:

- require a trimmed, bounded reason;
- reject self-targeting or require a separate, more explicit recovery path;
- verify the return payload is not logged or exposed outside the admin boundary.

### P2: `admin_ban_user` reachability is not demonstrated by a repository caller

The captured ACL limits `admin_ban_user` to `service_role`, while the body requires `auth.uid()` to identify a row in `admin_users`. No repository caller was found for this RPC. The separate `admin-manage-user` edge function duplicates deletion and ban behavior without calling it.

Impact:

- the canonical administrative path is unclear;
- a service client that does not deliberately forward an administrator's user context may fail the internal `auth.uid()` check;
- the duplicate edge implementation is non-transactional and can drift from the transactional RPC;
- an apparently safer RPC can remain unused while the application follows a different path.

Required follow-up:

- identify the actual admin UI caller and authentication context;
- choose one canonical transaction boundary;
- add an integration test proving an approved administrator succeeds and every other context fails;
- retire duplicate behavior only after the real caller is migrated and verified.

### P3: Photo-ban helper accepts unsafe input ranges

`is_photo_banned(hash, threshold)` accepts any integer threshold and does not validate hexadecimal input before calling `decode` in `phash_distance_256`. A very large threshold can make every valid stored hash match; a malformed 64-character hash can raise a decode error.

Impact:

- a buggy privileged caller can reject all photos or turn malformed input into an avoidable server error.

Required follow-up:

- clamp threshold to the approved range;
- validate a 64-character hexadecimal hash;
- keep the function service-only unless a caller-specific reason says otherwise.

## Function-by-function disposition

| Function | Intended role inferred from callers | Body assessment | Required proof or action |
|---|---|---|---|
| `can_buyer_self_refund` | service read through refund edge | coherent 48-hour gate; no caller ownership check by design | captured service-only; baseline ACL and keep service-only |
| `claim_ticket_hold` | internal/service mutation | event-row lock and quantity checks are good; dangerous if directly executable | captured service-only; baseline ACL |
| `compute_ticket_refund` | service/internal money calculation | seat partition and last-seat add-on handling are internally consistent with `record_ticket_refund` | captured service-only; add paired golden-vector tests |
| `consume_organizer_receivables` | service mutation | balance lock is good; allocation provenance is incomplete | captured service-only; add allocation ledger |
| `flag_order_for_refund_review` | service mutation | idempotent first-reason behavior is good; hard-coded recipient is fragile | captured service-only; decouple alert routing |
| `gen_ticket_reference_code` | internal helper | 8-character restricted alphabet is usable; uniqueness depends on caller retry and table constraint | capture uniqueness constraint and tests |
| `get_ticket_tier_availability` | public/client read and internal calculation | tier and event cap calculation handles expired holds and voided seats | verify intentional read-only grant |
| `is_ticketing_organizer` | RLS/internal authorization helper | checks direct creator or community leader | verify policy behavior and intentional execute grants |
| `list_ticket_payouts_blocked` | service read | netting calculation is coherent; workflow is log-only | captured service-only; add durable review workflow |
| `list_ticket_payouts_due` | service read | organizer aggregation and receivable netting are coherent | captured service-only; golden reconciliation tests |
| `price_ticket_checkout` | pure internal/public calculation | deterministic fee math; direct inputs are not range-validated | keep behind validated callers or add input constraints |
| `quote_ticket_checkout` | public/client read | validates sales window, availability, add-ons, promo, and account readiness | verify intended grant; rate-limit promo probing at API boundary if needed |
| `record_ticket_checkin` | authenticated creator action | authenticates and rechecks organizer; row lock makes duplicate scans deterministic | captured authenticated and service grant; verify audit retention |
| `record_ticket_refund` | service mutation | row lock and Stripe-ID idempotency check are good; trusts caller's Stripe ID | captured service-only; prove unique Stripe refund constraint |
| `release_ticket_order_stock` | trigger/internal mutation | idempotent `stock_released_at` guard is good | prohibit direct client execution |
| `resolve_order_refund_review` | internal/service mutation | clears workflow but erases reason and timestamp | captured service-only; preserve history |
| `settle_ticket_hold` | service mutation | hold/order match and late-webhook capacity guard are good; does not verify Stripe itself | captured service-only; baseline ACL is mandatory |
| `tg_ticket_answers_validate` | trigger | event and scope checks are useful; lower bound missing | fix attendee-index lower bound |
| `tg_ticket_orders_release_stock` | trigger | correctly delegates on pending to canceled transition | trigger-only ACL posture |
| `tg_ticket_payouts_release_gate` | trigger | correctly blocks release before event end | test null and boundary timestamps |
| `tg_ticket_questions_cap` | trigger | correct sequential rule, not concurrency-safe | serialize per event |
| `tg_ticket_refunds_write_receivable` | trigger | correctly refuses shortfall without organizer | add allocation audit trail downstream |
| `tg_ticket_tiers_require_end_time` | trigger | guards paid-tier creation; captured companion trigger guards later end-time removal | keep paired triggers under one migration and test |
| `tg_ticketing_touch_updated_at` | trigger | simple timestamp behavior | provenance only |
| `admin_ban_user` | admin-only mutation | internal admin check and one transaction are strengths; evidence snapshot is unbounded; caller not found | captured service-only; prove caller context and canonicalize path |
| `admin_cascade_delete_user` | legacy service/admin mutation | atomic list, but no internal authorization and no repository caller found | captured service-only; deprecate in favor of one canonical deletion path |
| `auto_ban_reported_user` | report trigger | threshold path is abuse-prone, session-incomplete, silent on failure, unsafe search path | redesign and test before relying on it |
| `banned_identifiers_set_normalized` | trigger | delegates to canonical email normalizer | provenance and trigger-only posture |
| `check_banned_apple_sub` | authenticated/service read | exact lookup is simple; oracle sensitivity acknowledged by ACL migration | captured authenticated and service grant; baseline ACL |
| `check_banned_at_signup` | auth trigger | normalized email and Apple checks are useful | centralize with other identifier checks and monitor failures |
| `check_banned_phone_at_signup` | auth trigger | digit normalization is reasonable | share canonical normalization with service helper |
| `is_identifier_banned` | service read | inconsistent normalization with signup triggers | captured service-only; fix canonical comparison |
| `is_photo_banned` | service/invoker read | approximate hash check is reasonable; inputs need validation | verify RLS and grant behavior; validate inputs |

## Positive findings

- Ticket hold claims and settlements serialize on the event row.
- `settle_ticket_hold` verifies that order quantity and tier exactly match the hold.
- Late payment webhooks only settle when current capacity still permits it.
- Refund computation and recording use the same seat-level partition formula.
- Refund recording locks the order and treats a previously recorded Stripe refund ID as idempotent.
- Ticket check-in authenticates the caller, verifies organizer authority, locks the position, and records duplicate scans.
- Payout release is guarded against pre-end-time release.
- The companion `explore_events_keep_paid_end_time` trigger prevents clearing an end time while paid tiers exist.
- Administrative manual ban checks `admin_users` internally and performs its database work transactionally.
- The later ban-oracle migration shows awareness that sensitive boolean lookups need explicit ACLs.
- The 12:53 PM schema capture shows the high-impact mutators and destructive admin routines limited to `service_role`, with `PUBLIC` explicitly revoked.
- The client-facing availability, quote, organizer-policy, Apple-ban-check, and check-in functions have narrow, explicit role grants rather than relying on `PUBLIC`.
- Captured ticketing tables and ban identifiers have RLS enabled, though RLS does not replace function execute restrictions for definer routines.

## Prioritized follow-up plan

### Immediate read-only proof

1. Capture report-table uniqueness and check constraints.
2. Capture unique constraints for ticket reference codes, Stripe refund IDs, payout event identity, and hold-to-order identity.
3. Compare each captured definition hash with a checked-in canonical migration source.
4. Repeat the owner and ACL query before any function replacement; the present proof is the 12:53 PM capture, not an ongoing monitor.

### Local preparation, no production mutation

1. Write a baseline migration that reconstructs all 24 ticketing and payout functions, their triggers, owners, and exact grants.
2. Write a baseline migration for the eight untracked admin and ban functions.
3. Add ACL assertions that fail on unintended `PUBLIC`, `anon`, or `authenticated` execute.
4. Add refund and payout golden-vector tests, including partial seats, add-ons, full cancellation, processing shortfall, and receivable netting.
5. Add concurrency tests for holds, settlement, refunds, payouts, and the question cap.
6. Fix attendee-index validation locally.
7. Design an append-only receivable-allocation and refund-review history model.
8. Prepare an automatic-ban redesign for Liz's approval because the enforcement threshold and human-review behavior are product and moderation decisions.

### Production actions that remain gated

Nothing in this report authorizes a migration, grant change, trigger change, deploy, commit, or push. No ACL correction is recommended from the captured grants. Any future live ACL change still requires separate approval. Any automatic-ban behavior change needs Liz's approval where it changes moderation policy or user-visible enforcement.

## Verification performed for this report

- deterministically selected the 24 untracked ticketing and payout names from the prior full comparison;
- reviewed all 33 captured function bodies;
- reviewed captured owners and emitted grants for all 33 exact signatures;
- reviewed captured trigger attachments for the ticket and report functions;
- searched repository callers, migrations, and documentation for every function name;
- reviewed the ticket checkout, refund, payout-release, inbox-drain, and admin-management callers relevant to trust boundaries;
- confirmed the report itself contains no credential values or private production rows.

This was a static review against point-in-time captures. It does not substitute for a new live ACL query at change time, transaction tests against a faithful schema, Stripe sandbox tests, or production monitoring evidence.
