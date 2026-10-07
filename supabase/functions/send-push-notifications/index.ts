import { resolveCreatorJoinPushTargets, creatorJoinPushData, isCreatorJoinNotice } from '../_shared/creatorJoinPushTargets.ts';
import { resolveMemberChatPushTargets, isMemberChatPushNotice, memberChatPushData } from '../_shared/memberChatPushTargets.ts';
import { resolvePageInvitationPushTargets, pageInvitationPushData } from '../_shared/pageInvitationPushTargets.ts';
import { resolveAttendeeMessagePushTargets, attendeeMessagePushData, isAttendeeNoticeCandidate } from '../_shared/attendeeMessagePushTargets.ts';
import { resolveCommunityChatPushTargets, communityChatPushData, isCommunityChatPushNotice } from '../_shared/communityChatPushTargets.ts';
import { resolveCreatorPagePushTargets, creatorPagePushData } from '../_shared/creatorPagePushTargets.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { isAuthorizedRunToken } from '../_shared/runTokenAuth.ts';
import { classifyOneSignalCreateResult } from '../_shared/oneSignalCreateResult.ts';
import { pushNotificationText } from '../_shared/pushNotificationText.ts';
import { peopleRequestPushIsEligible } from '../_shared/peopleRequestPushEligibility.ts';

// Member chat dependency: 20260922013000_member_reaction_push_message.sql
// must accompany this worker. Unknown access never falls through to a send.
// Scene dependency: 20260916223000_scene_event_reminder_queue.sql must
// accompany this worker. Missing/unknown dispatch decisions retry Scene broadcasts;
// they must never fall through to an unchecked provider send. Local candidate only.
// Dual-send fanout: per-recipient routing between OneSignal and Expo Push.
//
// During the OneSignal cutover window we have two populations of users:
//   * 1.0.4+ users: registered a OneSignal player ID (row in device_tokens).
//   * 1.0.3 holdouts: still have profiles.expo_push_token, no OneSignal.
//
// We send to each user via whichever transport they have. Once 1.0.4
// adoption is high enough, the Expo branch can be deleted and this
// function reduces back to OneSignal-only.

const ONESIGNAL_API_URL = 'https://api.onesignal.com/notifications';
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } });
  }

  // Auth gate. This function holds the service-role key and is fired by the
  // on_app_notification_inserted DB trigger. Before this check anyone who found
  // the URL could POST here and drive a full push-send pass. Same dedicated
  // run-token pattern as the sibling trigger-fired functions notify-plan-posted
  // and notify-report (see _shared/runTokenAuth.ts).
  //
  // DEPLOY PREREQUISITE (or every push is rejected): (1) set the
  // SEND_PUSH_RUN_TOKEN secret in Supabase, and (2) update the
  // trigger_send_push_notifications() DB function to send that same value as an
  // 'x-run-token' header (mirror 20260813210501_notify_plan_posted_run_token.sql).
  // Do NOT deploy this function alone. See the fix log for the exact SQL.
  if (!isAuthorizedRunToken(req.headers.get('x-run-token'), Deno.env.get('SEND_PUSH_RUN_TOKEN'))) {
    return new Response(JSON.stringify({ error: 'forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const ONESIGNAL_APP_ID = Deno.env.get('ONESIGNAL_APP_ID')!;
  const ONESIGNAL_REST_API_KEY = Deno.env.get('ONESIGNAL_REST_API_KEY')!;

  // The claim helper does not itself filter expires_at. Do not claim or send
  // anything if the expiry sweep failed, or expired alerts can escape.
  try {
    const { error: expiryError } = await supabase.rpc('expire_stale_notifications');
    if (expiryError) throw expiryError;
  } catch (error) {
    console.error('[send-push] notification expiry check failed:', error);
    return new Response(JSON.stringify({ error: 'Notification expiry check failed' }), {
      status: 503, headers: { 'Content-Type': 'application/json' },
    });
  }

  // Step 1: Discover both transport populations.
  //
  // PostgREST caps an unpaginated .select() at its default max-rows (1000).
  // device_tokens alone has 2000+ rows, so a plain select was silently
  // returning only the first page every single run -- roughly a third of
  // real registered users were invisible to every send pass, with no error
  // anywhere (a partial page isn't a failure as far as the client is
  // concerned). Paginate with .range() until a short page confirms the end.
  const PAGE_SIZE = 1000;

  // OneSignal-capable: a provider-confirmed enabled subscription, or a new
  // subscription that has not reached the synchronization job yet. A known
  // disabled row must not suppress a still-valid legacy fallback.
  const oneSignalUserIds = new Set<string>();
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data: osRows, error: osErr } = await supabase
      .from('device_tokens')
      .select('user_id, push_enabled, enabled_synced_at')
      .range(offset, offset + PAGE_SIZE - 1);
    if (osErr) {
      console.error('[send-push] device_tokens read failed:', osErr.message);
      return new Response(JSON.stringify({ error: 'OneSignal audience lookup failed' }), {
        status: 503, headers: { 'Content-Type': 'application/json' },
      });
    }
    for (const r of (osRows ?? []) as Array<{ user_id: string; push_enabled: boolean | null; enabled_synced_at: string | null }>) {
      if (r.push_enabled !== false) oneSignalUserIds.add(r.user_id);
    }
    if (!osRows || osRows.length < PAGE_SIZE) break;
  }

  // Expo-capable: any profile with a non-null expo_push_token.
  const expoTokenByUser = new Map<string, string>();
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data: expoRows, error: expoErr } = await supabase
      .from('profiles')
      .select('id, expo_push_token')
      .not('expo_push_token', 'is', null)
      .range(offset, offset + PAGE_SIZE - 1);
    if (expoErr) {
      console.error('[send-push] profiles read failed:', expoErr.message);
      return new Response(JSON.stringify({ error: 'legacy push audience lookup failed' }), {
        status: 503, headers: { 'Content-Type': 'application/json' },
      });
    }
    for (const p of (expoRows ?? []) as Array<{ id: string; expo_push_token: string | null }>) {
      if (p.expo_push_token) expoTokenByUser.set(p.id, p.expo_push_token);
    }
    if (!expoRows || expoRows.length < PAGE_SIZE) break;
  }

  // Union for the claim. claim_pending_push_notifications only returns rows
  // whose user_id is in this set, so users with no transport are left alone
  // and will be picked up the next time they register.
  const allEligibleUserIds = [
    ...new Set<string>([...oneSignalUserIds, ...expoTokenByUser.keys()]),
  ];

  if (allEligibleUserIds.length === 0) {
    return new Response(JSON.stringify({ sent: 0, total: 0 }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Step 2: ATOMICALLY claim pending notifications via the postgres helper.
  //
  // The previous select-then-update pattern was racy. The DB trigger fires
  // this function once per app_notifications insert, so when N rows are
  // inserted close together (e.g. one chat message generating N recipient
  // rows), N parallel function invocations would each SELECT the full
  // unread queue and each call out with the same rows. Result was 5–8x
  // duplicate push notifications hitting users.
  //
  // v2 atomically adds recoverable attempt ownership around the unchanged
  // legacy new-row helper; historical sent rows without attempts stay untouched.
  // The claim uses FOR UPDATE SKIP LOCKED so each
  // parallel caller grabs a disjoint set of rows in a single atomic
  // statement, then returns the rows it just marked push_sent=true. Also
  // performs active-chat suppression for new_message notifications where
  // the recipient is currently viewing that chat.
  const { data: claimedRows, error: claimError } = await supabase.rpc(
    'claim_pending_push_notifications_v2',
    { p_token_user_ids: allEligibleUserIds, p_batch_size: 100 },
  );

  if (claimError) {
    return new Response(
      JSON.stringify({ sent: 0, total: 0, error: claimError.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const notifications = (claimedRows ?? []) as Array<{
    id: string;
    user_id: string;
    type: string;
    title: string;
    body: string | null;
    event_id: string | null;
    circle_id: string | null;
    topic_id: string | null;
    push_attempt_id: string;
  }>;

  if (notifications.length === 0) {
    return new Response(JSON.stringify({ sent: 0, total: 0 }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const uuidPattern = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  if (notifications.some(n => !uuidPattern.test(n.push_attempt_id)) || new Set(notifications.map(n => n.id)).size !== notifications.length) {
    return new Response(JSON.stringify({error:'Push attempt identity could not be confirmed'}), {status:503,headers:{'Content-Type':'application/json'}});
  }
  const attempts = new Map(notifications.map(n => [n.id,n.push_attempt_id]));
  const settlementAttempted = new Set<string>();
  const retiredAttempts = new Set<string>();
  let claimReleaseFailed = false;
  async function prepare(ids: string[]): Promise<Set<string>> {
    const {data,error}=await supabase.rpc('prepare_notification_push_attempts',{p_attempts:ids.map(id=>({id,attempt:attempts.get(id)}))});
    if(error||!Array.isArray(data)||data.some(id=>typeof id!=='string'||!ids.includes(id))||new Set(data).size!==data.length)throw Error('Push lease could not be confirmed');
    const current=new Set<string>(data);for(const id of ids)if(!current.has(id))retiredAttempts.add(id);return current;
  }
  type Settlement={id:string;outcome:'completed'|'suppressed'|'retry';transport?:'onesignal'|'expo';reference?:string};
  async function settle(results: Settlement[]): Promise<Set<string>> {
    if(!results.length)return new Set();
    results.forEach(r=>settlementAttempted.add(r.id));
    try {
      const {data,error}=await supabase.rpc('settle_notification_push_attempts',{p_results:results.map(r=>({...r,attempt:attempts.get(r.id)}))});
      if(error||!Array.isArray(data)||data.some(id=>typeof id!=='string'||!results.some(r=>r.id===id))||new Set(data).size!==data.length)throw Error('Push settlement could not be confirmed');
      if(data.length!==results.length)claimReleaseFailed=true;
      return new Set<string>(data);
    } catch(error) {claimReleaseFailed=true;console.error('[send-push] owned attempt settlement failed:',error);return new Set();}
  }

  // Step 3: Per-user badge counts (transport-agnostic).
  const affectedUserIds = [...new Set(notifications.map((n) => n.user_id))];
  const { data: badgeRows, error: badgeError } = await supabase.rpc(
    'compute_user_badge_counts',
    { p_user_ids: affectedUserIds },
  );

  const badgeCounts: Record<string, number> = {};
  if (!badgeError) {
    for (const row of (badgeRows ?? []) as Array<{ user_id: string; badge: number | null }>) {
      badgeCounts[row.user_id] = row.badge ?? 0;
    }
  }

  // Step 4: Route each claimed notification to OneSignal or Expo.
  // OneSignal wins when a user has both (1.0.4 user upgrading from 1.0.3).
  const oneSignalQueue: typeof notifications = [];
  const expoQueue: typeof notifications = [];
  for (const n of notifications) {
    if (oneSignalUserIds.has(n.user_id)) {
      oneSignalQueue.push(n);
    } else if (expoTokenByUser.has(n.user_id)) {
      expoQueue.push(n);
    }
    // The claim audience comes from the captured transport union.
  }

  let creatorJoinsSuppressed = 0;
  let pageUpdatesSuppressed = 0;
  let communityChatsSuppressed = 0;
  let memberChatsSuppressed = 0;
  let invitationsSuppressed = 0;
  let invitationsHeld = 0;
  let peopleRequestsSuppressed = 0;
  let oneSignalSent = 0;
  let oneSignalNoSubscription = 0;
  let oneSignalFallbackQueued = 0;
  let expoSent = 0;
  const failedIds: string[] = [];

  // Error samples for the response body. Capped so a bad batch can't bloat
  // the response or leak more than a handful of examples; this exists
  // because `supabase functions logs` is not a real subcommand on this CLI
  // version, so the response body is the only place a failure reason is
  // ever visible after the fact.
  const MAX_ERROR_SAMPLES = 5;
  const errorSamples: Array<{ channel: 'onesignal' | 'expo'; status?: number; detail: string }> = [];
  function recordError(channel: 'onesignal' | 'expo', detail: string, status?: number) {
    console.error(`[send-push] ${channel} failure${status ? ` (${status})` : ''}: ${detail}`);
    if (errorSamples.length < MAX_ERROR_SAMPLES) {
      errorSamples.push({ channel, status, detail: detail.slice(0, 300) });
    }
  }

  // Step 5a: OneSignal send. Reuse the notification row ID on every retry so
  // OneSignal can deduplicate creation within its 30-day idempotency window.
  // A created message is provider acceptance, not confirmed device delivery.
  for (const n of oneSignalQueue) {
    try {
      // Recheck immediately before this provider request, including any
      // unfollow/block while earlier notifications in the batch were sent.
      const joinTarget = (await resolveCreatorJoinPushTargets(supabase, [n])).get(n.id);
      if (joinTarget && !joinTarget.eligible) { creatorJoinsSuppressed++; continue; }
      const pageInvitationTarget = (await resolvePageInvitationPushTargets(supabase, [n])).get(n.id);
      if (pageInvitationTarget && !pageInvitationTarget.eligible) { invitationsSuppressed++; continue; }
      const target = (await resolveCreatorPagePushTargets(supabase, [n])).get(n.id);
      if (target && !target.eligible) { pageUpdatesSuppressed++; continue; }
      const chatTarget = (await resolveCommunityChatPushTargets(supabase, [n])).get(n.id);
      if (chatTarget && !chatTarget.eligible) { communityChatsSuppressed++; continue; }
      const attendeeTarget = (await resolveAttendeeMessagePushTargets(supabase, [n])).get(n.id);
      if(attendeeTarget?.invitationDecision==='suppress'){invitationsSuppressed++;continue;}
      if(attendeeTarget?.invitationDecision==='hold'){invitationsHeld++;failedIds.push(n.id);continue;}
      const memberTarget = (await resolveMemberChatPushTargets(supabase, [n])).get(n.id);
      if (memberTarget && !memberTarget.eligible) { memberChatsSuppressed++; continue; }
      if (!(await peopleRequestPushIsEligible(supabase, n))) { peopleRequestsSuppressed++; continue; }
      const payload = joinTarget && !joinTarget.legacy ? creatorJoinPushData(joinTarget) : pageInvitationTarget ? pageInvitationPushData(pageInvitationTarget) : attendeeTarget ? attendeeMessagePushData(attendeeTarget) : chatTarget ? communityChatPushData(chatTarget) : target ? creatorPagePushData(target) : memberTarget ? memberChatPushData(memberTarget) : { type: n.type, eventId: n.event_id, circleId: n.circle_id, topicId: n.topic_id };
      if (!(await prepare([n.id])).has(n.id)) continue;
      const text = pushNotificationText(n);
      const res = await fetch(ONESIGNAL_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Key ${ONESIGNAL_REST_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          app_id: ONESIGNAL_APP_ID,
          idempotency_key: n.id,
          target_channel: 'push',
          include_aliases: { external_id: [n.user_id] },
          headings: { en: text.title },
          contents: { en: text.body },
          data: payload,
          ios_badgeType: 'SetTo',
          ios_badgeCount: badgeCounts[n.user_id] ?? 1,
        }),
      });
      if (res.ok) {
        const result = await res.json();
        const outcome = classifyOneSignalCreateResult(result);
        if (outcome === 'created') {
          if ((await settle([{id:n.id,outcome:'completed',transport:'onesignal',reference:result.id}])).has(n.id)) oneSignalSent += 1;
        } else if (outcome === 'no-recipients') {
          if (expoTokenByUser.has(n.user_id)) {
            // The provider definitively created no message, so an Expo fallback
            // cannot duplicate a OneSignal delivery. Keep this only during the
            // measured migration window; new and repaired clients are OneSignal.
            expoQueue.push(n);
            oneSignalFallbackQueued += 1;
          } else if ((await settle([{id:n.id,outcome:'suppressed',transport:'onesignal'}])).has(n.id)) {
            oneSignalNoSubscription += 1;
          }
          console.warn(`[send-push] OneSignal created no message for notification ${n.id}`);
        } else {
          // Do not discard an uncertain receipt as an unsubscribed recipient.
          // A retry keeps n.id for OneSignal's creation deduplication.
          failedIds.push(n.id);
          recordError('onesignal', 'Unrecognized message creation receipt', res.status);
        }
      } else {
        failedIds.push(n.id);
        recordError('onesignal', await res.text().catch(() => '(no body)'), res.status);
      }
    } catch (err) {
      failedIds.push(n.id);
      recordError('onesignal', err instanceof Error ? err.message : String(err));
    }
  }

  // Step 5b: Expo Push send (batches of 100). Tracks ticket IDs for the
  // post-send receipt sweep that catches DeviceNotRegistered errors and
  // nulls the stale token on profiles. Behavior preserved from deployed v13.
  type ExpoMessage = {
    to: string;
    title: string;
    body: string | null;
    data: { type: string; eventId?: string | null; circleId?: string | null; topicId?: string | null; notificationId?: string; creatorPageId?: string; creatorPageBroadcastId?: string; pageInvitationId?: string; communityMemberId?: string; exploreEventId?: string; communityId?: string | null; communityBroadcastId?: string | null };
    sound: string;
    badge: number;
  };
  const expoMessages: ExpoMessage[] = [];
  const expoUserIdByIndex: string[] = [];
  const expoNotifIdByIndex: string[] = [];
  for (const n of expoQueue) {
    const token = expoTokenByUser.get(n.user_id);
    if (!token) continue;
    expoMessages.push({
      to: token,
      ...pushNotificationText(n),
      data: { type: n.type, eventId: n.event_id, circleId: n.circle_id, topicId: n.topic_id },
      sound: 'default',
      badge: badgeCounts[n.user_id] ?? 1,
    });
    expoUserIdByIndex.push(n.user_id);
    expoNotifIdByIndex.push(n.id);
  }

  type ExpoTicket = { ticketId: string; userId: string; notificationId: string };
  const expoTickets: ExpoTicket[] = [];

  for (let i = 0; i < expoMessages.length; i += 100) {
    let entries = expoMessages.slice(i, i + 100).map((message,j) => ({ message, userId: expoUserIdByIndex[i+j], notificationId: expoNotifIdByIndex[i+j] }));
    const joinEntries = entries.filter(e => isCreatorJoinNotice(e.message.data));
    if (joinEntries.length) {
      try {
        const targets = await resolveCreatorJoinPushTargets(supabase, joinEntries.map(e => ({ id: e.notificationId, user_id: e.userId, type: e.message.data.type })));
        entries = entries.filter(e => {
          const target = targets.get(e.notificationId);
          if (!target) return true;
          if (!target.eligible) { creatorJoinsSuppressed++; return false; }
          if (!target.legacy) e.message.data = creatorJoinPushData(target);
          return true;
        });
      } catch {
        failedIds.push(...joinEntries.map(e => e.notificationId));
        recordError('expo', 'Join notification sources could not be confirmed');
        entries = entries.filter(e => !isCreatorJoinNotice(e.message.data));
      }
    }
    const invitationEntries = entries.filter(e => e.message.data.type === 'page_team_invitation');
    if (invitationEntries.length) {
      try {
        const targets = await resolvePageInvitationPushTargets(supabase, invitationEntries.map(e => ({id:e.notificationId,user_id:e.userId,type:e.message.data.type})));
        entries = entries.filter(e => {
          const target = targets.get(e.notificationId);
          if (!target) return true;
          if (!target.eligible) { invitationsSuppressed++; return false; }
          e.message.data = pageInvitationPushData(target); return true;
        });
      } catch {
        failedIds.push(...invitationEntries.map(e => e.notificationId));
        recordError('expo','Page invitation targets could not be confirmed');
        entries = entries.filter(e => e.message.data.type !== 'page_team_invitation');
      }
    }
    const pageEntries = entries.filter(e => e.message.data.type === 'creator_page_update');
    if (pageEntries.length) {
      try {
        const targets = await resolveCreatorPagePushTargets(supabase, pageEntries.map(e => ({ id: e.notificationId, user_id: e.userId, type: e.message.data.type })));
        entries = entries.filter(e => {
          const target = targets.get(e.notificationId);
          if (!target) return true; // ordinary notification
          if (!target.eligible) { pageUpdatesSuppressed++; return false; }
          e.message.data = creatorPagePushData(target); return true;
        });
      } catch {
        failedIds.push(...pageEntries.map(e => e.notificationId));
        recordError('expo', 'Page update targets could not be confirmed');
        entries = entries.filter(e => e.message.data.type !== 'creator_page_update');
      }
    }
    const chatEntries = entries.filter(e => isCommunityChatPushNotice({ id: e.notificationId, user_id: e.userId, type: e.message.data.type, topic_id: e.message.data.topicId }));
    if (chatEntries.length) {
      try {
        const targets = await resolveCommunityChatPushTargets(supabase, chatEntries.map(e => ({ id: e.notificationId, user_id: e.userId, type: e.message.data.type, topic_id: e.message.data.topicId })));
        entries = entries.filter(e => {
          const target = targets.get(e.notificationId);
          if (!target) return true;
          if (!target.eligible) { communityChatsSuppressed++; return false; }
          e.message.data = communityChatPushData(target); return true;
        });
      } catch {
        failedIds.push(...chatEntries.map(e => e.notificationId));
        recordError('expo', 'Community notification eligibility could not be confirmed');
        const failed = new Set(chatEntries.map(e => e.notificationId));
        entries = entries.filter(e => !failed.has(e.notificationId));
      }
    }
    const attendeeEntries = entries.filter(e => isAttendeeNoticeCandidate({type:e.message.data.type,event_id:e.message.data.eventId}));
    if (attendeeEntries.length) {
      try {
        const targets = await resolveAttendeeMessagePushTargets(supabase, attendeeEntries.map(e => ({id:e.notificationId,user_id:e.userId,type:e.message.data.type,event_id:e.message.data.eventId})));
        entries=entries.filter(e=>{
          const target=targets.get(e.notificationId);
          if(target?.invitationDecision==='suppress'){invitationsSuppressed++;return false;}
          if(target?.invitationDecision==='hold'){invitationsHeld++;failedIds.push(e.notificationId);return false;}
          if(target)e.message.data=attendeeMessagePushData(target);
          return true;
        });
      } catch {
        const unresolved = new Set(attendeeEntries.map(e => e.notificationId));
        failedIds.push(...unresolved);
        recordError('expo','Broadcast event targets could not be confirmed');
        entries = entries.filter(e => !unresolved.has(e.notificationId));
      }
    }
    const memberNotice = (e: typeof entries[number]) => ({id:e.notificationId,user_id:e.userId,type:e.message.data.type,event_id:e.message.data.eventId,circle_id:e.message.data.circleId,topic_id:e.message.data.topicId});
    const memberEntries = entries.filter(e => isMemberChatPushNotice(memberNotice(e)));
    if (memberEntries.length) {
      try {
        const targets = await resolveMemberChatPushTargets(supabase, memberEntries.map(memberNotice));
        entries = entries.filter(e => {
          const target = targets.get(e.notificationId);
          if (!target) return true;
          if (!target.eligible) { memberChatsSuppressed++; return false; }
          e.message.data = memberChatPushData(target); return true;
        });
      } catch {
        const unresolved = new Set(memberEntries.map(e => e.notificationId));
        failedIds.push(...unresolved);
        recordError('expo', 'Member chat notification eligibility could not be confirmed');
        entries = entries.filter(e => !unresolved.has(e.notificationId));
      }
    }
    const excludedPeopleRequests = new Set<string>();
    for (const entry of entries) {
      if (entry.message.data.type !== 'people_request') continue;
      try {
        if (!(await peopleRequestPushIsEligible(supabase, memberNotice(entry)))) {
          peopleRequestsSuppressed++;
          excludedPeopleRequests.add(entry.notificationId);
        }
      } catch {
        failedIds.push(entry.notificationId);
        excludedPeopleRequests.add(entry.notificationId);
        recordError('expo', 'People request eligibility could not be confirmed');
      }
    }
    entries = entries.filter(e => !excludedPeopleRequests.has(e.notificationId));
    if (!entries.length) continue;
    try {const current=await prepare(entries.map(e=>e.notificationId));entries=entries.filter(e=>current.has(e.notificationId));}
    catch {failedIds.push(...entries.map(e=>e.notificationId));recordError('expo','Push leases could not be confirmed');continue;}
    if (!entries.length) continue;
    const batch = entries.map(e => e.message);
    const batchUserIds = entries.map(e => e.userId);
    const batchNotifIds = entries.map(e => e.notificationId);
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batch),
      });
      if (res.ok) {
        const result = await res.json();
        const tickets = (result.data ?? []) as Array<
          { status: 'ok'; id: string } | { status: 'error'; details?: { error?: string } }
        >;
        const accepted: Settlement[] = [];
        for (let j = 0; j < batchNotifIds.length; j++) {
          const ticket = tickets[j];
          if (ticket?.status === 'ok' && 'id' in ticket && ticket.id) {
            accepted.push({id:batchNotifIds[j],outcome:'completed',transport:'expo',reference:ticket.id});
            expoTickets.push({
              ticketId: ticket.id,
              userId: batchUserIds[j],
              notificationId: batchNotifIds[j],
            });
          } else {
            failedIds.push(batchNotifIds[j]);
            const errCode = ticket?.status === 'error' ? ticket.details?.error ?? 'unknown' : 'missing-ticket';
            recordError('expo', `ticket error: ${errCode}`);
            if (errCode === 'DeviceNotRegistered') {
              await supabase
                .from('profiles')
                .update({ expo_push_token: null })
                .eq('id', batchUserIds[j])
                .eq('expo_push_token', expoTokenByUser.get(batchUserIds[j])!);
              console.log(
                `[send-push] checked stale token cleanup for ${batchUserIds[j]} (DeviceNotRegistered on send)`,
              );
            }
          }
        }
        expoSent += (await settle(accepted)).size;
      } else {
        recordError('expo', await res.text().catch(() => '(no body)'), res.status);
        for (const id of batchNotifIds) failedIds.push(id);
      }
    } catch (err) {
      recordError('expo', err instanceof Error ? err.message : String(err));
      for (const id of batchNotifIds) failedIds.push(id);
    }
  }

  // Step 5c: Expo receipt sweep. Wait briefly for receipts to be available,
  // then POST batches of 300 ticket IDs. Any ticket with status=error and
  // details.error=DeviceNotRegistered means that device has unregistered
  // since the send; null its expo_push_token so it stops getting tries.
  if (expoTickets.length > 0) {
    await new Promise((r) => setTimeout(r, 5000));
    for (let i = 0; i < expoTickets.length; i += 300) {
      const batch = expoTickets.slice(i, i + 300);
      const ticketIds = batch.map((t) => t.ticketId);
      const ticketUserMap: Record<string, string> = {};
      for (const t of batch) ticketUserMap[t.ticketId] = t.userId;
      try {
        const receiptRes = await fetch(EXPO_RECEIPTS_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: ticketIds }),
        });
        if (receiptRes.ok) {
          const receiptResult = await receiptRes.json();
          const receipts = receiptResult.data ?? {};
          for (const [ticketId, receipt] of Object.entries(receipts)) {
            const r = receipt as { status?: string; details?: { error?: string } };
            if (r.status === 'error' && r.details?.error === 'DeviceNotRegistered') {
              const userId = ticketUserMap[ticketId];
              if (userId) {
                await supabase
                  .from('profiles')
                  .update({ expo_push_token: null })
                  .eq('id', userId)
                  .eq('expo_push_token', expoTokenByUser.get(userId)!);
                console.log(
                  `[send-push] checked stale token cleanup for ${userId} (DeviceNotRegistered on receipt)`,
                );
              }
            }
          }
        }
      } catch (err) {
        console.error('[send-push] Expo receipt check error:', err);
      }
    }
  }

  // Owned settlement never resets push_sent: legacy workers cannot steal a v2 retry.
  // Unknown after dispatch is retryable; Expo can redeliver at this boundary.
  const failures=new Set(failedIds);
  const remaining=notifications.filter(n=>!settlementAttempted.has(n.id)&&!retiredAttempts.has(n.id));
  for(let i=0;i<remaining.length;i+=100)await settle(remaining.slice(i,i+100).map(n=>({id:n.id,outcome:failures.has(n.id)?'retry':'suppressed'})));

  return new Response(
    JSON.stringify({
      sent: oneSignalSent + expoSent,
      total: notifications.length,
      oneSignalSent,
      ...(creatorJoinsSuppressed ? { creatorJoinsSuppressed } : {}),
      ...(pageUpdatesSuppressed ? { pageUpdatesSuppressed } : {}),
      ...(communityChatsSuppressed ? { communityChatsSuppressed } : {}),
      ...(memberChatsSuppressed ? { memberChatsSuppressed } : {}),
      ...(invitationsSuppressed ? {invitationsSuppressed} : {}),
      ...(invitationsHeld ? {invitationsHeld} : {}),
      ...(peopleRequestsSuppressed ? {peopleRequestsSuppressed} : {}),
      oneSignalNoSubscription,
      oneSignalFallbackQueued,
      expoSent,
      failed: failedIds.length,
      errorSamples,
      ...(claimReleaseFailed ? { error: 'Failed notification claims could not be released' } : {}),
    }),
    { status: claimReleaseFailed ? 503 : 200, headers: { 'Content-Type': 'application/json' } },
  );
});
