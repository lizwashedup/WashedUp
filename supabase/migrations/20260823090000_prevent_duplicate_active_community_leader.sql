-- fix: nothing enforced "at most one active leader per community" at the DB
-- level. There is no dedicated transfer-leadership RPC anywhere in this repo
-- (checked 2026-08-23, no transfer_leadership/promote_to_leader function
-- exists); leadership changes go through the plain community_members RLS
-- UPDATE policy, which allows any existing leader (or global admin) to set
-- role='leader' on ANOTHER member's row directly. Nothing stopped a second
-- concurrent active leader row for the same community via a raw UPDATE.
--
-- Confirmed zero existing duplicates in production before writing this
-- (checked 2026-08-23 via `select community_id, count(*) ... having count(*) > 1`,
-- empty result), so this index applies cleanly with no cleanup step needed.
--
-- NOT applied anywhere -- written 2026-08-23, needs a separate go-ahead
-- since it's a new constraint on a live table other code paths write to.

create unique index if not exists community_members_one_active_leader
  on public.community_members (community_id)
  where role = 'leader' and status = 'active';
