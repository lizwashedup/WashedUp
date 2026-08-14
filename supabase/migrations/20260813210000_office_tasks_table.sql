-- washedup-world's /tasks Kanban board and its 3 API routes (GET/POST /api/tasks,
-- PATCH/DELETE /api/tasks/[id], GET /api/tasks/counts) have always queried a
-- `tasks` table that was never actually created -- the finance_transactions
-- migration's own comment names it as a sibling that should already exist.
-- Every board load/save has been failing live. Same default-deny RLS posture
-- as finance_transactions: washedup-world's API routes read/write via the
-- service-role client only, so zero policies is correct.

BEGIN;

CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  department text,
  status text NOT NULL DEFAULT 'Backlog' CHECK (status IN ('Backlog', 'In Progress', 'Waiting', 'Done')),
  notes text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
-- No policies: default-deny, service-role client bypasses RLS by design.

COMMIT;
