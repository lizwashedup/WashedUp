-- ============================================================================
-- 19: SYSTEM-COMPOSED INTRO CARD + INTRODUCTIONS-ROOM COLLAPSE
-- Cowork APPROVED 7-07 with one fix (conditional approved-note body, in below).
-- Applied on Liz's go as supabase/migrations/20260707200000_intro_blurb.sql,
-- self-tests intact. Dry-runs 1+2 passed inside ROLLBACK against prod.
--
-- What it does (Liz 7-07 refinement, part 1):
-- On approval the system composes a warm third-person intro and drops it into
-- the MAIN community chat as a distinct card: "this is liz, from pasadena.
-- favorite sunset ever: sri lanka." The raw-answer-posted-as-the-member into
-- a separate introductions room is gone.
--
-- DELIBERATE CALLS (accept or push back):
-- a. THE MAPPING: an intro is a community_broadcasts row with kind='intro'.
--    The main chat IS the broadcasts thread, so intros ride everything that
--    already works there: member-scoped read RLS, reactions, reply threads
--    (members welcome the newcomer right under the card), unread counts, the
--    never-dead empty state. No new table, no new read model.
-- b. STRUCTURED PAYLOAD, CLIENT-COMPOSED CARD: payload jsonb carries the
--    pieces {user_id, first_name, area, question, answer}; the RN card
--    composes the sentence from a LIZ COPY template in the app, so template
--    wording changes ship OTA with no migration. body gets a server-composed
--    flat fallback (same sentence) for push previews / old clients / web.
--    Changing the fallback wording needs a migration; the card never does.
-- c. ZIP STAYS PRIVATE: the zip never leaves community_member_answers. The
--    RPC converts zip -> area name at approval time via a new zip_areas
--    lookup (RLS on, zero policies: only definer functions can read it).
--    Unknown zip => area is null and the sentence simply skips ", from ...".
--    The seed list is LA-county neighborhoods; it is data, edit rows anytime.
-- d. QUESTION SNAPSHOT: request_to_join_community now stamps the intro
--    question text into the stored answers at ask time, so an approval after
--    the leader rewrites their question still weaves the question that was
--    actually answered. Falls back to the community's current question, then
--    the house fallback, for pre-existing pending rows.
-- e. QUIET JOIN: the broadcast fan-out trigger skips kind='intro', so an
--    intro card does NOT push-notify every member (the joiner still gets
--    their "you're in" note; the leader approved it themselves). Flippable
--    one-liner if Liz wants "new member" pushes later.
-- f. INTRODUCTIONS MACHINERY GOES DORMANT: prod has ZERO default topics and
--    ZERO intro messages today, so the collapse is free. is_default and its
--    unique index stay (additive rule), nothing writes them anymore. The
--    approval RPC no longer creates the topic or auto-joins anyone to it.
-- g. NAME AS TYPED: the card shows the first name exactly as the joiner
--    typed it in the popup; everything else in the sentence is lowercase
--    voice. LIZ COPY call: lowercase the name too if wanted (client-side).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. broadcast rows learn kinds (additive)
-- ----------------------------------------------------------------------------
alter table public.community_broadcasts
  add column kind text not null default 'broadcast'
    constraint community_broadcasts_kind_check check (kind in ('broadcast', 'intro')),
  add column payload jsonb;

comment on column public.community_broadcasts.kind is
  'broadcast = leader note; intro = system-composed member introduction (payload carries the pieces, body is the flat fallback).';

-- ----------------------------------------------------------------------------
-- 2. zip -> area lookup (definer-only: RLS on, no policies, no grants)
-- ----------------------------------------------------------------------------
create table public.zip_areas (
  zip  text primary key constraint zip_areas_zip_shape check (zip ~ '^[0-9]{5}$'),
  area text not null
);
alter table public.zip_areas enable row level security;
revoke all on public.zip_areas from anon, authenticated;

insert into public.zip_areas (zip, area) values
  ('90001','south la'),('90002','watts'),('90003','south la'),('90004','hancock park'),
  ('90005','koreatown'),('90006','koreatown'),('90007','university park'),('90008','baldwin hills'),
  ('90010','koreatown'),('90011','south la'),('90012','chinatown'),('90013','downtown la'),
  ('90014','downtown la'),('90015','downtown la'),('90016','west adams'),('90017','downtown la'),
  ('90018','jefferson park'),('90019','mid-city'),('90020','koreatown'),('90021','downtown la'),
  ('90022','east la'),('90023','boyle heights'),('90024','westwood'),('90025','west la'),
  ('90026','echo park'),('90027','los feliz'),('90028','hollywood'),('90029','east hollywood'),
  ('90031','lincoln heights'),('90032','el sereno'),('90033','boyle heights'),('90034','palms'),
  ('90035','pico-robertson'),('90036','fairfax'),('90037','south la'),('90038','hollywood'),
  ('90039','atwater village'),('90041','eagle rock'),('90042','highland park'),('90043','hyde park'),
  ('90044','athens'),('90045','westchester'),('90046','west hollywood'),('90047','south la'),
  ('90048','beverly grove'),('90049','brentwood'),('90056','ladera heights'),('90057','westlake'),
  ('90061','south la'),('90062','south la'),('90063','east la'),('90064','rancho park'),
  ('90065','glassell park'),('90066','mar vista'),('90067','century city'),('90068','hollywood hills'),
  ('90069','west hollywood'),('90071','downtown la'),('90077','bel air'),('90089','usc'),
  ('90094','playa vista'),('90210','beverly hills'),('90211','beverly hills'),('90212','beverly hills'),
  ('90230','culver city'),('90232','culver city'),('90245','el segundo'),('90247','gardena'),
  ('90248','gardena'),('90249','gardena'),('90254','hermosa beach'),('90260','lawndale'),
  ('90266','manhattan beach'),('90272','pacific palisades'),('90274','palos verdes'),
  ('90275','rancho palos verdes'),('90277','redondo beach'),('90278','redondo beach'),
  ('90290','topanga'),('90291','venice'),('90292','marina del rey'),('90293','playa del rey'),
  ('90301','inglewood'),('90302','inglewood'),('90303','inglewood'),('90304','inglewood'),
  ('90305','inglewood'),('90401','santa monica'),('90402','santa monica'),('90403','santa monica'),
  ('90404','santa monica'),('90405','santa monica'),('90501','torrance'),('90502','torrance'),
  ('90503','torrance'),('90504','torrance'),('90505','torrance'),('90601','whittier'),
  ('90602','whittier'),('90603','whittier'),('90604','whittier'),('90605','whittier'),
  ('90640','montebello'),('90650','norwalk'),('90660','pico rivera'),('90701','artesia'),
  ('90703','cerritos'),('90706','bellflower'),('90710','harbor city'),('90712','lakewood'),
  ('90713','lakewood'),('90715','lakewood'),('90717','lomita'),('90731','san pedro'),
  ('90732','san pedro'),('90744','wilmington'),('90745','carson'),('90746','carson'),
  ('90755','signal hill'),('90802','long beach'),('90803','long beach'),('90804','long beach'),
  ('90805','long beach'),('90806','long beach'),('90807','long beach'),('90808','long beach'),
  ('90810','long beach'),('90813','long beach'),('90814','long beach'),('90815','long beach'),
  ('91001','altadena'),('91006','arcadia'),('91007','arcadia'),('91011','la canada'),
  ('91016','monrovia'),('91024','sierra madre'),('91030','south pasadena'),('91040','sunland'),
  ('91042','tujunga'),('91101','pasadena'),('91103','pasadena'),('91104','pasadena'),
  ('91105','pasadena'),('91106','pasadena'),('91107','pasadena'),('91108','san marino'),
  ('91201','glendale'),('91202','glendale'),('91203','glendale'),('91204','glendale'),
  ('91205','glendale'),('91206','glendale'),('91207','glendale'),('91208','glendale'),
  ('91214','la crescenta'),('91301','agoura hills'),('91302','calabasas'),('91303','canoga park'),
  ('91304','west hills'),('91306','winnetka'),('91307','west hills'),('91311','chatsworth'),
  ('91316','encino'),('91324','northridge'),('91325','northridge'),('91331','pacoima'),
  ('91335','reseda'),('91340','san fernando'),('91342','sylmar'),('91343','north hills'),
  ('91344','granada hills'),('91345','mission hills'),('91352','sun valley'),('91356','tarzana'),
  ('91364','woodland hills'),('91367','woodland hills'),('91401','van nuys'),('91402','panorama city'),
  ('91403','sherman oaks'),('91405','van nuys'),('91406','van nuys'),('91411','van nuys'),
  ('91423','sherman oaks'),('91436','encino'),('91501','burbank'),('91502','burbank'),
  ('91504','burbank'),('91505','burbank'),('91506','burbank'),('91601','north hollywood'),
  ('91602','toluca lake'),('91604','studio city'),('91605','north hollywood'),
  ('91606','north hollywood'),('91607','valley village'),('91706','baldwin park'),
  ('91711','claremont'),('91731','el monte'),('91732','el monte'),('91733','south el monte'),
  ('91740','glendora'),('91741','glendora'),('91744','la puente'),('91746','la puente'),
  ('91754','monterey park'),('91755','monterey park'),('91765','diamond bar'),('91766','pomona'),
  ('91767','pomona'),('91768','pomona'),('91770','rosemead'),('91775','san gabriel'),
  ('91776','san gabriel'),('91780','temple city'),('91789','walnut'),('91790','west covina'),
  ('91791','west covina'),('91801','alhambra'),('91803','alhambra');

-- ----------------------------------------------------------------------------
-- 3. request_to_join_community v2: snapshot the question at ask time (call d)
--    Only change from live: v_stored gains 'intro_question' (the community's
--    question at the moment they answered it). Everything else verbatim.
-- ----------------------------------------------------------------------------
create or replace function public.request_to_join_community(p_community_id uuid, p_answers jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_community record;
  v_existing record;
  v_member_id uuid;
  v_first text;
  v_stored jsonb;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  select id, name, status, join_intro_question into v_community
  from communities where id = p_community_id;
  if v_community.id is null or v_community.status <> 'active' then
    raise exception 'That community is not open to joins right now.';
  end if;

  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then
    raise exception 'Answers are required.';
  end if;
  if coalesce(btrim(p_answers->>'first_name'), '') = ''
     or char_length(p_answers->>'first_name') > 100 then
    raise exception 'First name is required.';
  end if;
  if coalesce(btrim(p_answers->>'last_name'), '') = ''
     or char_length(p_answers->>'last_name') > 100 then
    raise exception 'Last name is required.';
  end if;
  if coalesce(btrim(p_answers->>'email'), '') = ''
     or p_answers->>'email' !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
     or char_length(p_answers->>'email') > 254 then
    raise exception 'A real email is required.';
  end if;
  if coalesce(btrim(p_answers->>'zip'), '') = ''
     or p_answers->>'zip' !~ '^[0-9]{5}$' then
    raise exception 'A 5 digit zip code is required.';
  end if;
  if coalesce(btrim(p_answers->>'intro_answer'), '') = ''
     or char_length(p_answers->>'intro_answer') > 1000 then
    raise exception 'Your introduction is required.';
  end if;
  if coalesce((p_answers->>'guidelines_accepted')::boolean, false) is not true then
    raise exception 'Accepting the community guidelines is required.';
  end if;

  v_stored := jsonb_build_object(
    'first_name', btrim(p_answers->>'first_name'),
    'last_name', btrim(p_answers->>'last_name'),
    'email', btrim(p_answers->>'email'),
    'zip', btrim(p_answers->>'zip'),
    'intro_answer', btrim(p_answers->>'intro_answer'),
    'intro_question', nullif(btrim(coalesce(v_community.join_intro_question, '')), ''),
    'guidelines_accepted_at', now()
  );

  select id, status into v_existing
  from community_members
  where community_id = p_community_id and user_id = v_uid;

  if v_existing.id is null then
    insert into community_members (community_id, user_id, role, status)
    values (p_community_id, v_uid, 'member', 'pending')
    returning id into v_member_id;
  elsif v_existing.status = 'left' then
    update community_members
    set status = 'pending', joined_at = null
    where id = v_existing.id;
    v_member_id := v_existing.id;
  elsif v_existing.status = 'pending' then
    raise exception 'You already asked to join. The leader has your request.';
  elsif v_existing.status = 'active' then
    raise exception 'You are already a member.';
  else
    raise exception 'You cannot join this community right now.';
  end if;

  insert into community_member_answers (member_id, community_id, user_id, answers)
  values (v_member_id, p_community_id, v_uid, v_stored)
  on conflict (member_id)
  do update set answers = excluded.answers, updated_at = now();

  v_first := v_stored->>'first_name';
  insert into app_notifications (user_id, type, title, body, actor_user_id)
  select m.user_id,
         'community_join_request',
         'someone wants in',
         v_first || ' asked to join ' || v_community.name || '. their introduction is waiting for you.',
         v_uid
  from community_members m
  where m.community_id = p_community_id
    and m.role in ('leader', 'co_leader')
    and m.status = 'active';
end;
$function$;

-- ----------------------------------------------------------------------------
-- 4. review_community_join v2: the intro lands in the MAIN chat as a card
--    (calls a, b, c, f). The introductions-topic blocks are GONE; in their
--    place the composed broadcast. Decline path verbatim from live.
-- ----------------------------------------------------------------------------
create or replace function public.review_community_join(p_member_id uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_row record;
  v_community_name text;
  v_answers jsonb;
  v_first text;
  v_intro text;
  v_question text;
  v_qfrag text;
  v_area text;
  v_body text;
  v_posted boolean := false;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  select id, community_id, user_id, status into v_row
  from community_members where id = p_member_id;
  if v_row.id is null then
    raise exception 'That request is gone.';
  end if;
  if not (is_community_leader(v_row.community_id, v_uid)
          or is_admin(v_uid) or has_role(v_uid, 'admin'::app_role)) then
    raise exception 'Not authorized';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'That request was already handled.';
  end if;

  select name into v_community_name from communities where id = v_row.community_id;

  if not p_approve then
    -- LIZ COPY
    update community_members set status = 'declined' where id = v_row.id;
    insert into app_notifications (user_id, type, title, body, actor_user_id)
    values (
      v_row.user_id,
      'community_join_declined',
      'about your request',
      'not this time, and that''s okay. there are more communities to find.',
      v_uid
    );
    return;
  end if;

  update community_members
  set status = 'active', joined_at = now()
  where id = v_row.id;

  -- the system-composed intro card, into the main chat (zip never leaves
  -- community_member_answers; only the area name travels)
  select a.answers into v_answers
  from community_member_answers a where a.member_id = v_row.id;

  v_first := btrim(coalesce(v_answers->>'first_name', ''));
  v_intro := btrim(coalesce(v_answers->>'intro_answer', ''));
  if v_first <> '' and v_intro <> '' then
    v_question := coalesce(
      nullif(btrim(coalesce(v_answers->>'intro_question', '')), ''),
      nullif(btrim(coalesce((select join_intro_question from communities where id = v_row.community_id), '')), ''),
      -- house fallback, mirror of FALLBACK_INTRO_QUESTION in lib/communityJoin.ts
      'introduce yourself. what should this community know about you?'
    );
    -- the woven question fragment: lowercase, trailing punctuation dropped
    v_qfrag := lower(regexp_replace(btrim(v_question), '[?.!]+$', ''));
    select za.area into v_area from zip_areas za where za.zip = v_answers->>'zip';

    -- flat fallback sentence; the RN card recomposes from payload (LIZ COPY
    -- template lives client-side, OTA-editable)
    v_body := 'this is ' || v_first
      || coalesce(', from ' || v_area, '')
      || '. ' || v_qfrag || ': ' || v_intro
      || case when v_intro ~ '[.!?]$' then '' else '.' end;

    insert into community_broadcasts (community_id, sender_id, body, kind, payload)
    values (
      v_row.community_id,
      v_row.user_id,
      v_body,
      'intro',
      jsonb_build_object(
        'user_id', v_row.user_id,
        'first_name', v_first,
        'area', v_area,
        'question', v_question,
        'answer', v_intro
      )
    );
    v_posted := true;
  end if;

  -- LIZ COPY (Cowork fix: only claim the intro is posted when it actually is)
  insert into app_notifications (user_id, type, title, body, actor_user_id)
  values (
    v_row.user_id,
    'community_join_approved',
    'you''re in',
    v_community_name || case when v_posted
      then ' let you in. your introduction is already posted, come say hi.'
      else ' let you in. come say hi.'
    end,
    v_uid
  );
end;
$function$;

-- ----------------------------------------------------------------------------
-- 5. quiet join (call e): the fan-out trigger skips intro cards
-- ----------------------------------------------------------------------------
create or replace function public.notify_community_broadcast()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.kind = 'intro' then
    return new;  -- deliberate call e: intros do not push every member
  end if;
  insert into app_notifications (user_id, type, title, body, actor_user_id)
  select m.user_id,
         'community_broadcast',
         c.name,
         left(new.body, 500),
         new.sender_id
  from community_members m
  join communities c on c.id = new.community_id
  where m.community_id = new.community_id
    and m.status = 'active'
    and not m.broadcasts_muted
    and m.user_id is distinct from new.sender_id;
  return new;
end;
$function$;

-- ============================================================================
-- SELF-TESTS (in-transaction, NEVER strip on apply)
-- Simulated-JWT pattern: 3 real non-admin users, real RLS probes, assertions
-- SEARCH (never index/count real users' data), full cleanup.
-- ============================================================================
do $selftest$
declare
  v_leader uuid;
  v_joiner uuid;
  v_joiner2 uuid;
  v_cid uuid;
  v_mid uuid;
  v_mid2 uuid;
  v_bc record;
  v_n int;
begin
  -- three real, distinct, non-admin users
  select u.id into v_leader from auth.users u
  where not exists (select 1 from user_roles r where r.user_id = u.id and r.role = 'admin')
  order by u.created_at limit 1;
  select u.id into v_joiner from auth.users u
  where u.id <> v_leader
    and not exists (select 1 from user_roles r where r.user_id = u.id and r.role = 'admin')
  order by u.created_at limit 1;
  select u.id into v_joiner2 from auth.users u
  where u.id not in (v_leader, v_joiner)
    and not exists (select 1 from user_roles r where r.user_id = u.id and r.role = 'admin')
  order by u.created_at limit 1;
  if v_leader is null or v_joiner is null or v_joiner2 is null then
    raise exception 'selftest: need 3 non-admin users';
  end if;

  -- leader creates a community with an intro question
  perform set_config('request.jwt.claims', json_build_object('sub', v_leader, 'role', 'authenticated')::text, true);
  insert into communities (name, handle, status, created_by, join_intro_question)
  values ('selftest intro club', 'selftest-intro-club-19', 'active', v_leader, 'Favorite sunset ever?')
  returning id into v_cid;
  insert into community_members (community_id, user_id, role, status, joined_at)
  values (v_cid, v_leader, 'leader', 'active', now() - interval '1 hour');

  -- joiner asks with a known-LA zip
  perform set_config('request.jwt.claims', json_build_object('sub', v_joiner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform request_to_join_community(v_cid, jsonb_build_object(
    'first_name', 'Testa', 'last_name', 'Selftest', 'email', 'selftest19@example.com',
    'zip', '91101', 'intro_answer', 'sri lanka', 'guidelines_accepted', true));
  reset role;

  -- question snapshot stored (call d)
  select id into v_mid from community_members where community_id = v_cid and user_id = v_joiner;
  if (select a.answers->>'intro_question' from community_member_answers a where a.member_id = v_mid)
     is distinct from 'Favorite sunset ever?' then
    raise exception 'selftest: intro_question not snapshotted at ask time';
  end if;

  -- leader approves
  perform set_config('request.jwt.claims', json_build_object('sub', v_leader, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform review_community_join(v_mid, true);
  reset role;

  -- the intro card exists in the MAIN chat with the right shape (calls a-c)
  select * into v_bc from community_broadcasts
  where community_id = v_cid and kind = 'intro' and sender_id = v_joiner;
  if v_bc.id is null then
    raise exception 'selftest: intro broadcast missing';
  end if;
  if v_bc.body <> 'this is Testa, from pasadena. favorite sunset ever: sri lanka.' then
    raise exception 'selftest: composed body wrong: %', v_bc.body;
  end if;
  if v_bc.payload->>'area' is distinct from 'pasadena'
     or v_bc.payload->>'first_name' is distinct from 'Testa'
     or v_bc.payload->>'answer' is distinct from 'sri lanka'
     or v_bc.payload->>'user_id' is distinct from v_joiner::text then
    raise exception 'selftest: payload wrong: %', v_bc.payload;
  end if;
  if v_bc.payload ? 'zip' then
    raise exception 'selftest: zip leaked into payload';
  end if;

  -- no introductions room was created, no topic message posted (call f)
  select count(*) into v_n from community_topics where community_id = v_cid;
  if v_n <> 0 then
    raise exception 'selftest: a topic was created on approval (expected none)';
  end if;

  -- quiet join (call e): the intro broadcast fanned out to nobody
  select count(*) into v_n from app_notifications
  where type = 'community_broadcast' and body = left(v_bc.body, 500);
  if v_n <> 0 then
    raise exception 'selftest: intro card pushed members (expected quiet)';
  end if;

  -- the joiner's you're-in note still lands
  select count(*) into v_n from app_notifications
  where user_id = v_joiner and type = 'community_join_approved'
    and body = 'selftest intro club let you in. your introduction is already posted, come say hi.';
  if v_n <> 1 then
    raise exception 'selftest: approved notification missing or wrong body';
  end if;

  -- a NORMAL broadcast still fans out (trigger regression probe)
  insert into community_broadcasts (community_id, sender_id, body)
  values (v_cid, v_leader, 'selftest normal broadcast 19');
  select count(*) into v_n from app_notifications
  where type = 'community_broadcast' and body = 'selftest normal broadcast 19'
    and user_id = v_joiner;
  if v_n <> 1 then
    raise exception 'selftest: normal broadcast fan-out broken';
  end if;

  -- unknown zip: sentence skips the area cleanly
  perform set_config('request.jwt.claims', json_build_object('sub', v_joiner2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform request_to_join_community(v_cid, jsonb_build_object(
    'first_name', 'Nomad', 'last_name', 'Selftest', 'email', 'selftest19b@example.com',
    'zip', '00000', 'intro_answer', 'anywhere warm!', 'guidelines_accepted', true));
  reset role;
  select id into v_mid2 from community_members where community_id = v_cid and user_id = v_joiner2;
  perform set_config('request.jwt.claims', json_build_object('sub', v_leader, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform review_community_join(v_mid2, true);
  reset role;
  select * into v_bc from community_broadcasts
  where community_id = v_cid and kind = 'intro' and sender_id = v_joiner2;
  if v_bc.body <> 'this is Nomad. favorite sunset ever: anywhere warm!' then
    raise exception 'selftest: no-area body wrong: %', v_bc.body;
  end if;
  if v_bc.payload->>'area' is not null then
    raise exception 'selftest: unknown zip should give null area';
  end if;

  -- no-card path (Cowork fix): an answer-less pending row (the web-join shape)
  -- gets no intro card and an honest note
  select u.id into v_mid2 from auth.users u
  where u.id not in (v_leader, v_joiner, v_joiner2)
    and not exists (select 1 from user_roles r where r.user_id = u.id and r.role = 'admin')
  order by u.created_at limit 1;
  if v_mid2 is null then
    raise exception 'selftest: need a 4th non-admin user';
  end if;
  insert into community_members (community_id, user_id, role, status)
  values (v_cid, v_mid2, 'member', 'pending');
  perform set_config('request.jwt.claims', json_build_object('sub', v_leader, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform review_community_join(
    (select id from community_members where community_id = v_cid and user_id = v_mid2), true);
  reset role;
  if exists (select 1 from community_broadcasts
             where community_id = v_cid and kind = 'intro' and sender_id = v_mid2) then
    raise exception 'selftest: answer-less approval posted an intro card';
  end if;
  select count(*) into v_n from app_notifications
  where user_id = v_mid2 and type = 'community_join_approved'
    and body = 'selftest intro club let you in. come say hi.';
  if v_n <> 1 then
    raise exception 'selftest: no-card approved note wrong';
  end if;

  -- zip_areas is invisible to clients (grants revoked: the probe must FAIL)
  perform set_config('request.jwt.claims', json_build_object('sub', v_joiner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    select count(*) into v_n from zip_areas;
    reset role;
    raise exception 'selftest: zip_areas readable by authenticated (expected denied)';
  exception when insufficient_privilege then
    reset role;
  end;

  -- cleanup (search-scoped to fixture rows only)
  delete from app_notifications where (type = 'community_join_request' and body like '%selftest intro club%')
    or (type = 'community_join_approved' and body like 'selftest intro club%')
    or (type = 'community_broadcast' and body = 'selftest normal broadcast 19');
  delete from community_broadcasts where community_id = v_cid;
  delete from community_member_answers where community_id = v_cid;
  delete from community_members where community_id = v_cid;
  delete from communities where id = v_cid;

  raise notice 'selftest 19: ALL PASSED';
end;
$selftest$;
