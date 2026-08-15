-- Applied directly in production 2026-08-14 (task #69, following the audit in
-- task #68). Same bug class as get_suspicious_accounts and admin_delete_user_by_id
-- earlier the same night: Supabase auto-grants EXECUTE to anon/authenticated on new
-- public functions unless explicitly revoked.
--
-- Two of these were LIVE IN PRODUCTION, not caught pre-ship like everything else
-- found tonight: get_command_center_stats and get_pt_dashboard_stats are both
-- SECURITY DEFINER (bypass RLS entirely) and had no internal auth check of their
-- own, so any of WashedUp's ~940 real signed-up users could call them directly via
-- a plain authenticated RPC call and pull the full internal admin analytics
-- dashboard. Both were touched by the earlier 2026-08-14 fix (task #40) that made
-- them return real data, but that fix never added the missing REVOKE/admin-check.
-- Their real callers (washedup-world + command-center-next dashboard/stats routes
-- for get_command_center_stats; washedup-web + command-center-next admin/stats
-- routes for get_pt_dashboard_stats) already build a service-role client on the
-- same request; app code fixed in the same pass to call these two RPCs through it
-- instead of the user's own session.
--
-- get_push_reach and _users_blocked: anon-callable analytics/oracle helpers, zero
-- real callers found anywhere in the 4 repos or pg_cron, restricted to service_role.
--
-- is_admin and has_role were audited too and deliberately NOT touched: both are
-- referenced directly inside 40+ live RLS policies (ticket_orders, ticket_payouts,
-- ticket_refunds, organizer_receivables, profiles, messages, user_roles, and more),
-- always called as has_role(auth.uid(), ...) / is_admin(auth.uid()), never with an
-- arbitrary target id. Revoking PUBLIC's EXECUTE on either would have broken RLS
-- evaluation across most of the app's core tables for every authenticated request,
-- a far worse outage than the narrow oracle-probe risk they carry today (is_admin
-- only ever confirms whether a given uuid happens to be liz@washedup.app; the real
-- callers found never pass anyone else's id). Left as-is on purpose.
--
-- 7 album RPCs + report_no_show (task #65 finding): each already blocks anon
-- internally via its own auth.uid() IS NULL check, so none of these were actually
-- exploitable, but anon should never have held the grant. Revoked from anon only,
-- authenticated keeps it since real logged-in users call these directly.

REVOKE ALL ON FUNCTION public.get_command_center_stats() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_command_center_stats() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_command_center_stats() TO service_role;

REVOKE ALL ON FUNCTION public.get_pt_dashboard_stats() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_pt_dashboard_stats() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_pt_dashboard_stats() TO service_role;

REVOKE ALL ON FUNCTION public.get_push_reach() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_push_reach() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_push_reach() TO service_role;

REVOKE ALL ON FUNCTION public._users_blocked(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._users_blocked(uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public._users_blocked(uuid, uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.start_album_upload_batch(uuid, jsonb, uuid[], boolean, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.record_album_heart(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.remove_album_heart(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.soft_delete_album_upload(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.update_album_marketing_consent(uuid, boolean, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_album_user_metadata(uuid, text, text, boolean, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.mark_album_viewed(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.report_no_show(uuid, uuid) FROM anon;
