# Direct-apply evidence: community topic chat parity phase 1

This repository-local record preserves the provenance needed by automated release checks.

## Affected file

- `20260828200000_community_topic_chat_parity_phase1.sql`

## What happened

Earlier the same session, a prior claim that this migration was "already applied to production,
confirmed by direct database read" was found to cite a supporting document
(`specs/washedup-BUILD35-CONFLICT-RESOLUTIONS-20260831.md`) that does not exist anywhere in this repo.
That claim was treated as unverified and removed rather than trusted.

Real verification followed: Josh ran the following query directly in the Supabase SQL editor against the
live production database and reported the result back in chat, 2026-09-02:

```sql
select column_name from information_schema.columns
where table_name = 'community_topic_messages'
and column_name in ('image_url','reply_to_message_id','edited_at');
```

Result: all 3 rows returned (`reply_to_message_id`, `edited_at`, `image_url`). This confirms the
migration's additive columns already exist on the live `community_topic_messages` table.

## Disposition

The migration file's own header text ("DRAFT: DO NOT APPLY WITHOUT JOSH WORD") is left unedited — this
project's release policy treats migration file bytes as immutable once historical, and editing the header
comment alone previously tripped `qa:release-policy` ("existing migration history is immutable"). This
record is the correct side channel for the real-world fact instead: the migration is already live, the
file's own draft-sounding header is now stale text, not a live instruction to withhold applying it again.

No production database, migration ledger, or credential action occurred as part of writing this record.
