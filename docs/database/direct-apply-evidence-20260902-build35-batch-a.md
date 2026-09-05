# Direct-apply evidence: Build 35 / P3 Batch A (community role reconciliation + event ownership)

This repository-local record preserves the provenance needed by automated release checks.

## Affected files

- `20260901000000_build35_community_role_reconciliation.sql`
- `20260901010000_build35_event_ownership.sql`

## What happened

Both migrations ran clean in the Supabase SQL editor on 2026-09-02 (Josh's go), per commit `71510a5`
("Mark Batch A migrations as applied to production"): 22/22 `explore_events` rows got a non-null
`owner_type` (zero data loss), and 6 `community_role_assignments` rows were backfilled. That commit swapped
each file's "DRAFT: DO NOT APPLY" header for an applied note (comment-only diff; no SQL logic changed, and
both migrations were re-verified against their contract test suites after the edit).

Re-checked directly against the live database tonight, independent of the commit message and the
migrations' own header claims:

```sql
select count(*) filter (where owner_type is not null) as owned, count(*) as total
from public.explore_events;

select count(*) from public.community_role_assignments;
```

Result: `explore_events` shows 22/22 rows with `owner_type` populated (zero unowned rows), and
`community_role_assignments` holds 6 real backfilled rows. Both numbers match commit `71510a5`'s own
claimed numbers exactly.

## Disposition

Both migrations are additive and reversible by their own header text (a `DROP TABLE` for the role
reconciliation table; four `DROP TRIGGER`/`DROP FUNCTION`/`ALTER TABLE ... DROP COLUMN` statements plus a
`DROP TABLE` for the event-ownership audit trail). Neither touches `community_members.role`,
`operator_create_explore_event()`, `admin_create_explore_event()`, or any existing RLS policy or grant. No
application code reads either migration's new columns/tables yet (Build 35 permission and ownership-cutover
work is deliberately sequenced after this foundation step), so applying them changed no user's effective
permissions. No production database, migration ledger, or credential action occurred as part of writing
this record.
