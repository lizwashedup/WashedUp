-- ============================================================================
-- phase 2: operator applications (the supply engine).
--
-- 1. explore_events.public_name (decision 15 in doc 00: communities are
--    people-first, events can be brand-fronted). Nullable, additive; the
--    listing displays this name (Swerve Comedy, The Elysian) when set.
-- 2. submit_operator_application(): the one write path for both application
--    forms (doc 12). Insert on first apply; resubmit allowed only from
--    declined or needs_more_info. Users have no UPDATE policy on
--    operator_grants, so this RPC is the only way answers change.
-- 3. admin_review_operator_grant(): admin-only review with the three
--    Meetup-style outcomes (plus in_review and revoked), writes reviewed_by,
--    reviewed_at, review_notes, and drops a warm app_notifications row for
--    the applicant (in-app inbox; the copy is a stub for Liz to edit).
--
-- 2026-07-03: Cowork review fixes applied (before any prod apply).
--   Fix 1: the note is split. review_notes stays admin-internal and NEVER
--   reaches the applicant; a separate applicant_message parameter feeds the
--   inbox note and is stored on the row (new additive column) so the apply
--   screen can show the ask. Residual flagged for Cowork: review_notes is
--   still row-readable by the owner under the phase 1 RLS select policy
--   (RLS cannot hide a column); the client never fetches it, but true
--   column privacy would need a view or a column-level grant rework.
--   Fix 2: resubmitting clears reviewed_by, reviewed_at, and the stale
--   applicant_message, so a row back in 'applied' carries no leftover
--   review state. Both fixes have self-test assertions below.
--
-- 2026-07-03 (dry-run catch): app_notifications.type carries a CHECK
--   allowlist (25 values) and 'operator_grant' was not in it; the rollback
--   dry run failed exactly there. The constraint is dropped and recreated
--   with the one extra value. This is the single touch of an existing
--   object in this migration, unavoidable for any new notification type
--   (same pattern as the known blog_briefs.status CHECK): a strict
--   superset, every existing row still passes, and the recreate validates
--   that atomically inside this transaction.
--
-- Additive only (bar the CHECK superset above). In-transaction self-tests
-- at the bottom, never strip.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. public listing name on events
-- ---------------------------------------------------------------------------

alter table public.explore_events
  add column public_name text
    check (public_name is null or char_length(public_name) between 1 and 80);

comment on column public.explore_events.public_name is
  'Brand-fronted display name for the listing (decision 15). Null = admin-curated or person-fronted.';

-- the applicant-facing half of the note split (fix 1): what the reviewer
-- says TO the applicant. review_notes (phase 1) stays admin-internal.
alter table public.operator_grants
  add column applicant_message text;

comment on column public.operator_grants.applicant_message is
  'Reviewer message shown to the applicant (inbox note + apply screen). review_notes is internal-only.';

-- allow the new inbox note type (strict superset of the existing allowlist)
alter table public.app_notifications
  drop constraint app_notifications_type_check;
alter table public.app_notifications
  add constraint app_notifications_type_check check (type = any (array[
    'waitlist_spot', 'broadcast', 'event_reminder', 'member_joined',
    'plan_invite', 'invite_accepted', 'new_message', 'album_ready',
    'plan_cancelled', 'duplicate_plan', 'interest_signal', 'interest_invite',
    'album_upload_prompt', 'album_upload_reminder', 'album_someone_uploaded',
    'album_more_photos_added', 'album_creator_no_uploads_nudge',
    'album_hearts_batched', 'waitlist_request', 'exception_invite',
    'exception_slot_refunded', 'people_request', 'people_request_accepted',
    'people_ping', 'referral_joined',
    'operator_grant'
  ]));

-- ---------------------------------------------------------------------------
-- 2. submit_operator_application
-- ---------------------------------------------------------------------------

create or replace function public.submit_operator_application(
  p_track public.operator_track,
  p_application jsonb,
  p_accept_terms boolean default false
)
returns uuid
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_status public.operator_grant_status;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if not p_accept_terms then
    raise exception 'The creator terms must be accepted';
  end if;
  if p_application is null or jsonb_typeof(p_application) <> 'object' or p_application = '{}'::jsonb then
    raise exception 'Application answers are required';
  end if;

  select id, status into v_id, v_status
  from operator_grants
  where user_id = v_uid and track = p_track;

  if v_id is null then
    insert into operator_grants (user_id, track, status, application, terms_accepted_at)
    values (v_uid, p_track, 'applied', p_application, now())
    returning id into v_id;
  elsif v_status in ('declined', 'needs_more_info') then
    -- fix 2: a resubmitted application carries no stale review state
    update operator_grants
    set application = p_application,
        status = 'applied',
        terms_accepted_at = now(),
        reviewed_by = null,
        reviewed_at = null,
        applicant_message = null
    where id = v_id;
  elsif v_status in ('applied', 'in_review') then
    raise exception 'Your application is already being read';
  elsif v_status = 'approved' then
    raise exception 'This application is already approved';
  else
    raise exception 'This application cannot be resubmitted';  -- revoked
  end if;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. admin_review_operator_grant
-- ---------------------------------------------------------------------------

-- fix 1: two separate texts. p_notes is admin-internal (review_notes, never
-- shown to the applicant). p_applicant_message is what the reviewer says TO
-- the applicant: stored on the row and woven into the inbox note.
create or replace function public.admin_review_operator_grant(
  p_grant_id uuid,
  p_outcome public.operator_grant_status,
  p_notes text default null,
  p_applicant_message text default null
)
returns void
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_user uuid;
  v_track public.operator_track;
  v_title text;
  v_body text;
begin
  if not (is_admin(auth.uid()) or has_role(auth.uid(), 'admin'::app_role)) then
    raise exception 'Not authorized';
  end if;
  if p_outcome not in ('in_review', 'needs_more_info', 'approved', 'declined', 'revoked') then
    raise exception 'Invalid review outcome';
  end if;

  update operator_grants
  set status = p_outcome,
      review_notes = coalesce(p_notes, review_notes),
      applicant_message = p_applicant_message,
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = p_grant_id
  returning user_id, track into v_user, v_track;

  if v_user is null then
    raise exception 'Application not found';
  end if;

  -- warm in-app note to the applicant (copy is a stub, Liz edits).
  -- ONLY p_applicant_message ever reaches the applicant; p_notes never does.
  -- in_review and revoked are silent: one is internal, the other is a
  -- human conversation, not a notification.
  if p_outcome = 'approved' then
    v_title := 'you''re in';
    v_body := coalesce(p_applicant_message || ' ', '')
      || 'a real person read your application and said yes. welcome to the creators. we''ll reach out to get you set up.';
  elsif p_outcome = 'needs_more_info' then
    v_title := 'one thing before we say yes';
    v_body := coalesce(p_applicant_message || ' ', '') || 'update your application and send it back in.';
  elsif p_outcome = 'declined' then
    v_title := 'about your application';
    v_body := coalesce(p_applicant_message || ' ', '') || 'not the right fit right now, and the door stays open. you can apply again anytime.';
  end if;

  if v_title is not null then
    insert into app_notifications (user_id, type, title, body)
    values (v_user, 'operator_grant', v_title, v_body);
  end if;
end;
$$;

revoke all on function public.submit_operator_application(public.operator_track, jsonb, boolean) from public, anon;
revoke all on function public.admin_review_operator_grant(uuid, public.operator_grant_status, text, text) from public, anon;
grant execute on function public.submit_operator_application(public.operator_track, jsonb, boolean) to authenticated;
grant execute on function public.admin_review_operator_grant(uuid, public.operator_grant_status, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. in-transaction self-test (never strip on apply)
-- ---------------------------------------------------------------------------

do $$
declare
  v_applicant uuid;
  v_admin uuid;
  v_grant uuid;
  v_status public.operator_grant_status;
  v_raised boolean;
begin
  -- privileges: anon can call neither RPC
  if has_function_privilege('anon', 'public.submit_operator_application(public.operator_track, jsonb, boolean)', 'execute') then
    raise exception 'SELF-TEST FAIL: anon can execute submit_operator_application';
  end if;
  if has_function_privilege('anon', 'public.admin_review_operator_grant(uuid, public.operator_grant_status, text, text)', 'execute') then
    raise exception 'SELF-TEST FAIL: anon can execute admin_review_operator_grant';
  end if;

  -- public_name exists, nullable, and no existing row gained one
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'explore_events'
                   and column_name = 'public_name' and is_nullable = 'YES') then
    raise exception 'SELF-TEST FAIL: explore_events.public_name missing or not nullable';
  end if;
  if exists (select 1 from public.explore_events where public_name is not null) then
    raise exception 'SELF-TEST FAIL: existing explore_events rows gained a public_name';
  end if;

  -- live walkthrough of the full apply -> needs_more_info -> resubmit -> approve loop
  select id into v_applicant from auth.users u
  where not exists (select 1 from public.admin_users a where a.user_id = u.id)
    and not public.has_role(u.id, 'admin'::app_role)
    and not exists (select 1 from public.operator_grants g where g.user_id = u.id)
  order by created_at limit 1;
  select user_id into v_admin from public.admin_users limit 1;
  if v_applicant is null or v_admin is null then
    raise exception 'SELF-TEST FAIL: needs a non-admin user and an admin to run';
  end if;

  -- applicant submits
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_applicant, 'role', 'authenticated')::text, true);
  v_grant := public.submit_operator_application('event_host', '{"applicant_type":"just_me","about":"self test"}'::jsonb, true);
  select status into v_status from public.operator_grants where id = v_grant;
  if v_status <> 'applied' then
    raise exception 'SELF-TEST FAIL: submit did not land as applied';
  end if;

  -- double-submit while in review is blocked
  v_raised := false;
  begin
    perform public.submit_operator_application('event_host', '{"applicant_type":"just_me"}'::jsonb, true);
  exception when others then v_raised := true; end;
  if not v_raised then
    raise exception 'SELF-TEST FAIL: duplicate submission was allowed';
  end if;

  -- admin asks for more: internal note and applicant message travel apart (fix 1)
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform public.admin_review_operator_grant(
    v_grant, 'needs_more_info',
    'INTERNAL-ONLY seems legit, want one proof link.',
    'send a link to a past event.');
  select status into v_status from public.operator_grants where id = v_grant;
  if v_status <> 'needs_more_info' then
    raise exception 'SELF-TEST FAIL: needs_more_info outcome did not stick';
  end if;
  if not exists (select 1 from public.app_notifications
                 where user_id = v_applicant and type = 'operator_grant'
                   and body like '%send a link to a past event.%') then
    raise exception 'SELF-TEST FAIL: applicant message did not reach the inbox note';
  end if;
  if exists (select 1 from public.app_notifications
             where user_id = v_applicant and type = 'operator_grant'
               and body like '%INTERNAL-ONLY%') then
    raise exception 'SELF-TEST FAIL: internal review note leaked into the inbox';
  end if;
  if not exists (select 1 from public.operator_grants
                 where id = v_grant
                   and review_notes = 'INTERNAL-ONLY seems legit, want one proof link.'
                   and applicant_message = 'send a link to a past event.') then
    raise exception 'SELF-TEST FAIL: note split not stored on the row';
  end if;

  -- applicant resubmits: no stale review state survives (fix 2)
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_applicant, 'role', 'authenticated')::text, true);
  perform public.submit_operator_application('event_host', '{"applicant_type":"just_me","proof_links":["https://example.com"]}'::jsonb, true);
  if not exists (select 1 from public.operator_grants
                 where id = v_grant and status = 'applied'
                   and reviewed_by is null and reviewed_at is null
                   and applicant_message is null) then
    raise exception 'SELF-TEST FAIL: resubmit left stale review state';
  end if;

  -- admin approves, grant answers true
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform public.admin_review_operator_grant(v_grant, 'approved', null, null);
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_applicant, 'role', 'authenticated')::text, true);
  if not public.has_operator_grant(v_applicant, 'event_host') then
    raise exception 'SELF-TEST FAIL: approved grant not visible to has_operator_grant';
  end if;

  -- non-admin cannot review
  v_raised := false;
  begin
    perform public.admin_review_operator_grant(v_grant, 'declined', null);
  exception when others then v_raised := true; end;
  if not v_raised then
    raise exception 'SELF-TEST FAIL: non-admin was allowed to review';
  end if;

  -- cleanup and drop simulated auth
  delete from public.operator_grants where id = v_grant;
  delete from public.app_notifications where user_id = v_applicant and type = 'operator_grant';
  perform set_config('request.jwt.claims', null, true);

  raise notice 'operator applications self-test passed';
end;
$$;

commit;
