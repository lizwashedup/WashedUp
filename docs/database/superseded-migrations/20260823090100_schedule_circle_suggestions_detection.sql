-- ARCHIVED SUPERSEDED ARTIFACT. NOT AN ACTIVE MIGRATION.
-- fix: detect_circle_suggestions() (20260605000000_circle_suggestions_detection.sql)
-- was written and granted to service_role but nothing ever called it -- no
-- cron job, no edge function anywhere in supabase/functions/. The suggestion
-- UI (components/circles/CirclesDirectory.tsx) and its RPCs
-- (get_circle_suggestions/set_circle_suggestion_status) are fully wired, so
-- this has been a silently dead feature: nothing ever populates the table
-- the UI reads from.
--
-- The function's own header carries a caveat: "*** ENG: validate against the
-- real event_members shape before applying. ***" -- checked live 2026-08-23:
-- event_members.event_id/user_id/status (enum member_status, includes
-- 'joined') match exactly what the function assumes. The caveat is resolved,
-- safe to schedule.
--
-- Daily cadence: a co-attendance heuristic over historical event history,
-- not time-sensitive, no reason to run more than once a day. cron.schedule()
-- upserts by job name, matching every other cron migration in this repo.
--
-- NOT applied anywhere -- written 2026-08-23, needs a separate go-ahead
-- since it's new automated behavior that will start writing real rows
-- (pending circle suggestions) real users will see in the app.

select cron.schedule(
  'detect-circle-suggestions',
  '0 11 * * *',
  $cron$
  select public.detect_circle_suggestions();
  $cron$
);
