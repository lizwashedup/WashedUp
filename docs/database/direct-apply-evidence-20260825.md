# Direct-apply evidence: 2026-08-25 migration collision

This repository-local record preserves the provenance needed by automated release checks. The original detailed session evidence remains in Crucible's append-only handoff `crucible-T5273-threshold-local-gates-green-release-proof-pending-20260829-2225.md`.

## Affected files

- `20260825110000_centralize_admin_alert_recipient.sql`
- `20260825110100_harden_admin_delete_gate_and_reports_fks.sql`

Both SQL effects were directly applied to production and verified on 2026-08-25 before the local migration inventory was repaired. The project used a linked-query apply path that bypassed the Supabase migration ledger, so the local filename collision did not identify a unique ledger entry.

On 2026-08-29, the alert-recipient migration retained version `20260825110000`. The independent admin-delete migration was renamed from the colliding version to `20260825110100` without changing its executable SQL. No production database object, migration-ledger row, or credential was changed by that inventory repair.

This record documents historical provenance only. It is not authorization to reapply either migration.
