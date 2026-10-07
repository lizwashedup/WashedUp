import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import * as attendeeTargets from '../_shared/attendeeMessagePushTargets.ts';
import * as chatTargets from '../_shared/communityChatPushTargets.ts';
import * as memberTargets from '../_shared/memberChatPushTargets.ts';
import * as pageTargets from '../_shared/creatorPagePushTargets.ts';
import * as pageInvitationTargets from '../_shared/pageInvitationPushTargets.ts';
import * as joinTargets from '../_shared/creatorJoinPushTargets.ts';
import * as createResult from '../_shared/oneSignalCreateResult.ts';
import * as notificationText from '../_shared/pushNotificationText.ts';
import * as peopleRequestEligibility from '../_shared/peopleRequestPushEligibility.ts';
import { isAuthorizedRunToken } from '../_shared/runTokenAuth.ts';

// Run the actual Edge handler, not a copied send loop. Strip only TypeScript
// and imports; every database, environment, provider and timer capability is
// synthetic. There is no real createClient, fetch, credential or live endpoint.
const source = stripTypeScriptTypes(readFileSync(new URL('../send-push-notifications/index.ts', import.meta.url), 'utf8')
  .replace(/^import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];?\r?\n/gm, ''));
const notification = (overrides = {}) => ({
  id: '11111111-1111-4111-8111-111111111111', user_id: 'person-a',
  type: 'new_message', title: 'Synthetic room', body: 'Fixture message',
  event_id: null, circle_id: 'circle-a', topic_id: null, ...overrides,
});
const plain = (value) => JSON.parse(JSON.stringify(value));

function fixture(options = {}) {
  const rows = options.rows ?? [notification()];
  const calls = { clients: 0, rpc: [], reads: [], updates: [], provider: [] };
  const claimed = new Set();
  const receipts = [...(options.receipts ?? [{ id: '22222222-2222-4222-8222-222222222222' }])];
  const env = {
    SEND_PUSH_RUN_TOKEN: 'synthetic-run-token', SUPABASE_URL: 'https://database.invalid',
    SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key', ONESIGNAL_APP_ID: 'synthetic-app-id',
    ONESIGNAL_REST_API_KEY: 'synthetic-provider-key',
  };
  const database = {
    async rpc(name, args) {
      calls.rpc.push({ name, args: args === undefined ? undefined : plain(args) });
      if (name === 'expire_stale_notifications') {
        if (options.expiryThrow) throw options.expiryThrow;
        return { data: null, error: options.expiryError ?? null };
      }
      if (name === 'get_community_chat_push_targets_v2') {
        if (options.chatTargetThrow) throw options.chatTargetThrow;
        return { data: typeof options.chatTargets === 'function' ? options.chatTargets(args) : options.chatTargets ?? [], error: options.chatTargetError ?? null };
      }
      if (name === 'get_creator_page_join_push_targets') return { data: options.joinTargets ?? [], error: options.joinTargetError ?? null };
      if (name === 'get_creator_page_push_targets') {
        if (options.targetThrow) throw options.targetThrow;
        return { data: typeof options.targets === 'function' ? options.targets(args) : options.targets ?? [], error: options.targetError ?? null };
      }
      if(name==='get_scene_message_push_decisions'){
        if(options.invitationThrow)throw options.invitationThrow;
        return {data:options.invitationDecisions === undefined ? args.p_notification_ids.map(id=>({notification_id:id,user_id:rows.find(n=>n.id===id)?.user_id,decision:'ordinary'})) : typeof options.invitationDecisions==='function' ? options.invitationDecisions(args) : options.invitationDecisions,error:options.invitationError??null};
      }
      if (name === 'compute_user_badge_counts') return { data: options.badges ?? [{ user_id: 'person-a', badge: 7 }], error: null };
      if (name === 'get_member_chat_push_targets' || name === 'get_member_chat_push_targets_v2') {
        if (options.memberTargetThrow) throw options.memberTargetThrow;
        const eligibleRows=rows.filter(n=>args.p_notification_ids.includes(n.id));
        return {data:options.memberTargets===undefined ? eligibleRows.map(n=>({notification_id:n.id,user_id:n.user_id,event_id:n.event_id??null,circle_id:n.circle_id??null,eligible:true,reaction_message_id:null})) : typeof options.memberTargets==='function' ? options.memberTargets(args) : options.memberTargets,error:options.memberTargetError??null};
      }
      if (name === 'claim_pending_push_notifications_v2') {
        rows.forEach((row) => claimed.add(row.id));
        return { data: plain(rows.map(row => ({ ...row, push_attempt_id: row.push_attempt_id ?? row.id }))), error: null };
      }
      if (name === 'prepare_notification_push_attempts') {
        return { data: args.p_attempts.map(value => value.id).filter(id => claimed.has(id)), error: null };
      }
      if (name === 'settle_notification_push_attempts') {
        const retries = args.p_results.filter(value => value.outcome === 'retry').map(value => value.id);
        if (retries.length) calls.updates.push({
          table: 'app_notifications', update: { push_sent: false }, filters: [{ column: 'id', values: retries }],
        });
        if (options.releaseThrow) throw options.releaseThrow;
        if (options.releaseError) return { data: null, error: options.releaseError };
        for (const result of args.p_results) {
          if (result.outcome === 'retry') claimed.delete(result.id);
          else claimed.add(result.id);
        }
        return { data: args.p_results.map(value => value.id), error: null };
      }
      throw new Error(`Unexpected mocked RPC: ${name}`);
    },
    from(table) {
      let update, filters = [], range = [0, 999];
      const query = {
        select() { return query; }, not() { return query; }, order() { return query; },
        range(first, last) { range = [first, last]; return query; },
        update(value) { update = plain(value); return query; },
        in(column, values) { filters.push({ column, values: plain(values) }); return query; },
        eq(column, value) { filters.push({ column, values: [value] }); return query; },
        then(resolve, reject) {
          return Promise.resolve().then(() => {
            if (update !== undefined) {
              calls.updates.push({ table, update, filters });
              if (table !== 'app_notifications') throw new Error(`Unexpected mocked update: ${table}`);
              const ids = filters.find((filter) => filter.column === 'id')?.values ?? [];
              if (options.releaseThrow) throw options.releaseThrow;
              if (!options.releaseError) ids.forEach((id) => claimed.delete(id));
              return { data: options.releaseError ? null : ids.map((id) => ({ id })), error: options.releaseError ?? null };
            }
            calls.reads.push({ table, range });
            if (table === 'app_notifications') return {data:typeof options.attendeeTargets==='function' ? options.attendeeTargets(filters) : options.attendeeTargets ?? [],error:options.attendeeTargetError ?? null};
            if (table === 'device_tokens') return { data: (options.deviceRows ?? [{ user_id: 'person-a' }]).slice(range[0], range[1] + 1), error: null };
            if (table === 'profiles') return { data: (options.expoRows ?? []).slice(range[0], range[1] + 1), error: null };
            throw new Error(`Unexpected mocked read: ${table}`);
          }).then(resolve, reject);
        },
      };
      return query;
    },
  };
  let handler;
  const context = vm.createContext({
    ...joinTargets, ...createResult, ...notificationText, ...peopleRequestEligibility, ...pageTargets, ...pageInvitationTargets, ...chatTargets, ...memberTargets, ...attendeeTargets, isAuthorizedRunToken, Response, Request, AbortController,
    Deno: { env: { get: (key) => env[key] }, serve: (value) => { handler = value; } },
    createClient: () => { calls.clients++; return database; },
    console: { error() {}, warn() {}, log() {} },
    setTimeout: (callback) => { queueMicrotask(callback); return 1; }, clearTimeout() {},
    async fetch(url, request) {
      calls.provider.push({ url, method: request.method, headers: plain(request.headers), body: JSON.parse(request.body) });
      const next = receipts.shift();
      if (next === undefined) throw new Error('Unexpected extra mocked provider request');
      if (next instanceof Error) throw next;
      return next instanceof Response ? next : new Response(JSON.stringify(next), { status: 200 });
    },
  });
  vm.runInContext(source, context, { filename: 'send-push-notifications/index.ts' });
  return {
    calls, claimed,
    async run(token = env.SEND_PUSH_RUN_TOKEN) {
      const headers = token === null ? {} : { 'x-run-token': token };
      const response = await handler(new Request('https://handler.invalid', { method: 'POST', headers }));
      return { status: response.status, body: await response.json() };
    },
  };
}

test('denies an unauthorized run before any database or provider operation', async () => {
  const f = fixture();
  const result = await f.run('wrong-token');
  assert.equal(result.status, 403);
  assert.equal(f.calls.clients, 0);
  assert.deepEqual(f.calls.rpc, []);
  assert.deepEqual(f.calls.reads, []);
  assert.deepEqual(f.calls.provider, []);
});

test('expiry failure stops before audience discovery, claim and sending', async () => {
  const f = fixture({ expiryError: { message: 'Synthetic expiry failure' } });
  const result = await f.run();
  assert.ok(result.status >= 500, 'an unresolved expiry check must not report successful processing');
  assert.deepEqual(f.calls.rpc.map((call) => call.name), ['expire_stale_notifications']);
  assert.deepEqual(f.calls.reads, []);
  assert.deepEqual(f.calls.provider, []);
  assert.equal(f.claimed.size, 0);
});

test('a thrown expiry failure also returns a bounded error before any audience or claim access', async () => {
  const f = fixture({ expiryThrow: new Error('Synthetic database connection failure') });
  const result = await f.run();
  assert.equal(result.status, 503);
  assert.deepEqual(f.calls.rpc.map((call) => call.name), ['expire_stale_notifications']);
  assert.deepEqual(f.calls.reads, []);
  assert.deepEqual(f.calls.provider, []);
  assert.equal(f.claimed.size, 0);
  assert.ok(result.body.error);
});

test('unknown success receipts are released instead of classified as no subscription', async () => {
  for (const receipt of [null, {}, [], { unexpected: true }, { id: 17 }]) {
    const f = fixture({ receipts: [receipt] });
    const result = await f.run();
    assert.equal(result.body.oneSignalNoSubscription, 0, `unknown receipt: ${JSON.stringify(receipt)}`);
    assert.equal(result.body.oneSignalSent, 0);
    assert.equal(result.body.failed, 1);
    assert.equal(f.calls.updates.length, 1);
    assert.equal(f.claimed.size, 0);
    assert.deepEqual(f.calls.updates[0], {
      table: 'app_notifications', update: { push_sent: false },
      filters: [{ column: 'id', values: [notification().id] }],
    });
  }
});

test('a failed claim release is reported as an operational error', async () => {
  const f = fixture({
    receipts: [new Response(JSON.stringify({ errors: ['Synthetic provider failure'] }), { status: 503 })],
    releaseError: { message: 'Synthetic database release failure' },
  });
  const result = await f.run();
  assert.ok(result.status >= 500, 'failed restoration must not look like normal completion');
  assert.equal(result.body.failed, 1);
  assert.equal(f.calls.updates.length, 1);
  assert.equal(f.claimed.size, 1, 'the mock models the unrecovered claimed row');
});

test('an unknown receipt followed by a thrown release failure stays visibly unresolved', async () => {
  const f = fixture({ receipts: [null], releaseThrow: new Error('Synthetic release connection failure') });
  const result = await f.run();
  assert.equal(result.status, 503);
  assert.equal(result.body.sent, 0);
  assert.equal(result.body.oneSignalNoSubscription, 0);
  assert.equal(result.body.failed, 1);
  assert.ok(result.body.error);
  assert.equal(f.calls.updates.length, 1);
  assert.equal(f.claimed.size, 1);
});

test('a confirmed empty audience is terminal without claiming delivery or retrying', async () => {
  const f = fixture({ receipts: [{ id: '', errors: ['All included players are not subscribed'] }] });
  const result = await f.run();
  assert.equal(result.status, 200);
  assert.equal(result.body.sent, 0);
  assert.equal(result.body.oneSignalNoSubscription, 1);
  assert.equal(result.body.failed, 0);
  assert.deepEqual(f.calls.updates, []);
  assert.equal(f.claimed.size, 1);
});

test('a created receipt preserves the recipient, source routing, badge and stable idempotency key', async () => {
  const n = notification({ event_id: 'event-a', circle_id: null, topic_id: null });
  const f = fixture({ rows: [n] });
  const result = await f.run();
  assert.equal(result.body.oneSignalSent, 1);
  assert.equal(result.body.failed, 0);
  assert.deepEqual(f.calls.updates, []);
  assert.deepEqual(f.calls.provider, [{
    url: 'https://api.onesignal.com/notifications', method: 'POST',
    headers: { Authorization: 'Key synthetic-provider-key', 'Content-Type': 'application/json' },
    body: {
      app_id: 'synthetic-app-id', idempotency_key: n.id, target_channel: 'push',
      include_aliases: { external_id: [n.user_id] }, headings: { en: n.title }, contents: { en: n.body },
      data: { type: n.type, eventId: n.event_id, circleId: n.circle_id, topicId: n.topic_id },
      ios_badgeType: 'SetTo', ios_badgeCount: 7,
    },
  }]);
});

test('an unconfirmed attempt retries the same notification identity without resending accepted peers', async () => {
  const accepted = notification();
  const uncertain = notification({ id: '33333333-3333-4333-8333-333333333333' });
  const f = fixture({ rows: [accepted, uncertain], receipts: [{ id: 'provider-id' }, new Error('Synthetic timeout')] });
  const result = await f.run();
  assert.equal(result.body.oneSignalSent, 1);
  assert.equal(result.body.failed, 1);
  assert.deepEqual(f.calls.updates[0].filters[0].values, [uncertain.id]);
  assert.deepEqual([...f.claimed], [accepted.id]);
  const retry = fixture({ rows: [uncertain] });
  await retry.run();
  assert.equal(f.calls.provider[1].body.idempotency_key, retry.calls.provider[0].body.idempotency_key);
});

test('unreadable provider JSON remains an unconfirmed retry with the same claim', async () => {
  const f = fixture({ receipts: [new Response('not JSON', { status: 200 })] });
  const result = await f.run();
  assert.equal(result.body.sent, 0);
  assert.equal(result.body.oneSignalNoSubscription, 0);
  assert.equal(result.body.failed, 1);
  assert.equal(f.claimed.size, 0);
});

test('OneSignal keeps priority when the recipient also has a legacy Expo token', async () => {
  const f = fixture({ expoRows: [{ id: 'person-a', expo_push_token: 'synthetic-expo-token' }] });
  const result = await f.run();
  assert.equal(result.body.oneSignalSent, 1);
  assert.equal(result.body.expoSent, 0);
  assert.equal(f.calls.provider.length, 1);
  assert.equal(f.calls.provider[0].url, 'https://api.onesignal.com/notifications');
  assert.deepEqual(f.calls.rpc.find((call) => call.name === 'claim_pending_push_notifications_v2').args, {
    p_token_user_ids: ['person-a'], p_batch_size: 100,
  });
});

test('a provider-confirmed disabled OneSignal row uses the temporary Expo fallback', async () => {
  const f = fixture({
    deviceRows: [{ user_id: 'person-a', push_enabled: false, enabled_synced_at: '2026-10-06T00:00:00Z' }],
    expoRows: [{ id: 'person-a', expo_push_token: 'synthetic-expo-token' }],
    receipts: [{ data: [{ status: 'ok', id: 'synthetic-ticket' }] }, { data: { 'synthetic-ticket': { status: 'ok' } } }],
  });
  const result = await f.run();
  assert.equal(result.body.oneSignalSent, 0);
  assert.equal(result.body.expoSent, 1);
  assert.equal(f.calls.provider[0].url, 'https://exp.host/--/api/v2/push/send');
});

test('a confirmed empty OneSignal audience falls back to Expo without settling twice', async () => {
  const f = fixture({
    expoRows: [{ id: 'person-a', expo_push_token: 'synthetic-expo-token' }],
    receipts: [
      { id: '', errors: ['All included players are not subscribed'] },
      { data: [{ status: 'ok', id: 'synthetic-ticket' }] },
      { data: { 'synthetic-ticket': { status: 'ok' } } },
    ],
  });
  const result = await f.run();
  assert.equal(result.body.oneSignalFallbackQueued, 1);
  assert.equal(result.body.oneSignalNoSubscription, 0);
  assert.equal(result.body.expoSent, 1);
  assert.equal(result.body.sent, 1);
  assert.deepEqual(f.calls.rpc.filter(call => call.name === 'settle_notification_push_attempts').at(-1).args.p_results.map(row => row.outcome), ['completed']);
});

test('the legacy-only recipient retains its existing mocked Expo send and receipt path', async () => {
  const f = fixture({
    deviceRows: [], expoRows: [{ id: 'person-a', expo_push_token: 'synthetic-expo-token' }],
    receipts: [{ data: [{ status: 'ok', id: 'synthetic-ticket' }] }, { data: { 'synthetic-ticket': { status: 'ok' } } }],
  });
  const result = await f.run();
  assert.equal(result.body.oneSignalSent, 0);
  assert.equal(result.body.expoSent, 1);
  assert.deepEqual(f.calls.provider.map((call) => call.url), [
    'https://exp.host/--/api/v2/push/send', 'https://exp.host/--/api/v2/push/getReceipts',
  ]);
  assert.equal(f.calls.provider[0].body[0].to, 'synthetic-expo-token');
  assert.deepEqual(f.calls.provider[1].body, { ids: ['synthetic-ticket'] });
});

const pageNotice = (overrides = {}) => notification({ type: 'creator_page_update', circle_id: null, ...overrides });
const target = (n, overrides = {}) => ({ notification_id: n.id, user_id: n.user_id, page_id: '33333333-3333-4333-8333-333333333333', broadcast_id: '44444444-4444-4444-8444-444444444444', eligible: true, ...overrides });
test('page update carries exact source IDs and reuses its notification ID for OneSignal deduplication', async () => {
 const n=pageNotice(),f=fixture({rows:[n],targets:[target(n)]});const r=await f.run();assert.equal(r.body.sent,1);
 assert.deepEqual(f.calls.provider[0].body.data,{type:'creator_page_update',notificationId:n.id,creatorPageId:target(n).page_id,creatorPageBroadcastId:target(n).broadcast_id});
 assert.equal(f.calls.provider[0].body.idempotency_key,n.id);
 assert.deepEqual(f.calls.rpc.find(c=>c.name==='get_creator_page_push_targets').args,{p_notification_ids:[n.id]});
});
test('page opt-out suppresses delivery without releasing a terminal notification',async()=>{
 const n=pageNotice(),f=fixture({rows:[n],targets:[target(n,{eligible:false})]});const r=await f.run();assert.equal(r.body.sent,0);assert.equal(r.body.pageUpdatesSuppressed,1);assert.equal(f.calls.provider.length,0);assert.equal(f.calls.updates.length,0);
});
for(const reason of ['missing','foreign','duplicate','malformed','wrong-user','error','throw'])test(`page target ${reason} cannot fall through to an ordinary broadcast`,async()=>{
 const n=pageNotice(),row=target(n);let options={targets:[row]};
 if(reason==='missing')options={targets:[]};if(reason==='foreign')options={targets:[{...row,notification_id:'55555555-5555-4555-8555-555555555555'}]};
 if(reason==='duplicate')options={targets:[row,row]};if(reason==='malformed')options={targets:[{...row,page_id:['33333333-3333-4333-8333-333333333333']}]};
 if(reason==='wrong-user')options={targets:[{...row,user_id:'someone-else'}]};if(reason==='error')options={targetError:{message:'missing migration'}};if(reason==='throw')options={targetThrow:Error('lost response')};
 const f=fixture({rows:[n],...options});const r=await f.run();assert.equal(r.body.sent,0);assert.equal(r.body.failed,1);assert.equal(f.calls.provider.length,0);assert.deepEqual(f.calls.updates[0].filters[0].values,[n.id]);
});
test('an uncertain page target does not prevent ordinary OneSignal notifications',async()=>{
 const n=pageNotice(),ordinary=notification({id:'55555555-5555-4555-8555-555555555555'}),f=fixture({rows:[n,ordinary],targets:[]});const r=await f.run();assert.equal(r.body.sent,1);assert.equal(r.body.failed,1);assert.equal(f.calls.provider[0].body.idempotency_key,ordinary.id);
});
test('later page notifications recheck eligibility after earlier OneSignal requests',async()=>{
 const a=pageNotice(),b=pageNotice({id:'55555555-5555-4555-8555-555555555555'});let reads=0;
 const f=fixture({rows:[a,b],targets:args=>{reads++;const n=args.p_notification_ids[0]===a.id?a:b;return[target(n,{eligible:reads===1})];}});const r=await f.run();assert.equal(r.body.sent,1);assert.equal(r.body.pageUpdatesSuppressed,1);assert.equal(reads,2);
});
test('Expo keeps receipt indices aligned when a page update is suppressed beside an ordinary notification',async()=>{
 const n=pageNotice(),ordinary=notification({id:'55555555-5555-4555-8555-555555555555'}),f=fixture({rows:[n,ordinary],deviceRows:[],expoRows:[{id:'person-a',expo_push_token:'synthetic-expo-token'}],targets:[target(n,{eligible:false})],receipts:[{data:[{status:'ok',id:'synthetic-ticket'}]},{data:{'synthetic-ticket':{status:'ok'}}}]});const r=await f.run();assert.equal(r.body.expoSent,1);assert.equal(r.body.pageUpdatesSuppressed,1);assert.equal(f.calls.provider[0].body.length,1);assert.equal(f.calls.provider[0].body[0].data.type,'new_message');
});
test('Expo page update has exact targets and an uncertain lookup sends only the ordinary entry',async()=>{
 const n=pageNotice(),ordinary=notification({id:'55555555-5555-4555-8555-555555555555'});
 for(const fail of [false,true]){const f=fixture({rows:fail?[n,ordinary]:[n],deviceRows:[],expoRows:[{id:'person-a',expo_push_token:'synthetic-expo-token'}],targets:fail?[]:[target(n)],receipts:[{data:[{status:'ok',id:'synthetic-ticket'}]},{data:{'synthetic-ticket':{status:'ok'}}}]});const r=await f.run();assert.equal(r.body.expoSent,1);assert.equal(r.body.failed,fail?1:0);assert.equal(f.calls.provider[0].body[0].data.type,fail?'new_message':'creator_page_update');if(!fail)assert.equal(f.calls.provider[0].body[0].data.creatorPageId,target(n).page_id);}
});

const chatNotice = (overrides = {}) => notification({ event_id: null, circle_id: null, topic_id: '77777777-7777-4777-8777-777777777777', ...overrides });
const chatTarget = (notice, overrides = {}) => ({ notification_id: notice.id, user_id: notice.user_id,
 source_kind: notice.type === 'community_broadcast' ? 'broadcast' : 'topic', community_id: '88888888-8888-4888-8888-888888888888',
 topic_id: notice.topic_id, broadcast_id: notice.type === 'community_broadcast' ? '99999999-9999-4999-8999-999999999999' : null, eligible: true, ...overrides });
test('eligible topic keeps its original topic and stable notification identity at OneSignal', async () => {
 const n=chatNotice(),f=fixture({rows:[n],chatTargets:[chatTarget(n)]});const r=await f.run();assert.equal(r.body.oneSignalSent,1);
 assert.deepEqual(f.calls.provider[0].body.data,{type:'new_message',notificationId:n.id,communityId:'88888888-8888-4888-8888-888888888888',topicId:n.topic_id});assert.equal(f.calls.provider[0].body.idempotency_key,n.id);
});
test('a captured announcement carries exact source context without changing its notification type', async () => {
 const n=chatNotice({type:'community_broadcast',topic_id:null}),f=fixture({rows:[n],chatTargets:[chatTarget(n)]});const r=await f.run();assert.equal(r.body.oneSignalSent,1);assert.deepEqual(f.calls.provider[0].body.data,{type:'community_broadcast',notificationId:n.id,communityId:'88888888-8888-4888-8888-888888888888',communityBroadcastId:'99999999-9999-4999-8999-999999999999'});
});
test('a confirmed post-claim chat denial prevents the provider call and remains terminal', async () => {
 const n=chatNotice(),f=fixture({rows:[n],chatTargets:[chatTarget(n,{eligible:false})]});const r=await f.run();assert.equal(r.body.sent,0);assert.equal(r.body.communityChatsSuppressed,1);assert.equal(f.calls.provider.length,0);assert.equal(f.calls.updates.length,0);
});
for(const failure of ['missing','foreign','duplicate','wrong-user','cross-topic','malformed','error','throw'])test(`unconfirmed chat target ${failure} cannot fall through to a normal push`,async()=>{
 const n=chatNotice();const rows=failure==='missing'?[]:failure==='foreign'?[chatTarget(n,{notification_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'})]:failure==='duplicate'?[chatTarget(n),chatTarget(n)]:failure==='wrong-user'?[chatTarget(n,{user_id:'other'})]:failure==='cross-topic'?[chatTarget(n,{topic_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'})]:failure==='malformed'?[chatTarget(n,{eligible:'yes'})]:[chatTarget(n)];
 const f=fixture({rows:[n],chatTargets:rows,chatTargetError:failure==='error'?{message:'Offline'}:null,chatTargetThrow:failure==='throw'?Error('Unavailable'):null});const r=await f.run();assert.equal(r.body.sent,0);assert.equal(r.body.failed,1);assert.equal(f.calls.provider.length,0);assert.equal(f.calls.updates[0].update.push_sent,false);
});
test('the capture phase explicitly preserves a legacy announcement with no fabricated source',async()=>{
 const n=chatNotice({type:'community_broadcast',topic_id:null}),f=fixture({rows:[n],chatTargets:[chatTarget(n,{source_kind:'legacy',community_id:null,broadcast_id:null})]});const r=await f.run();assert.equal(r.body.sent,1);assert.deepEqual(f.calls.provider[0].body.data,{type:'community_broadcast'});
});
test('each later OneSignal chat rechecks eligibility after earlier provider requests',async()=>{
 const a=chatNotice(),b=chatNotice({id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'});let checks=0;const f=fixture({rows:[a,b],chatTargets:args=>{const n=args.p_notification_ids[0]===a.id?a:b;return[chatTarget(n,{eligible:++checks===1})];}});const r=await f.run();assert.equal(checks,2);assert.equal(r.body.sent,1);assert.equal(r.body.communityChatsSuppressed,1);assert.equal(f.calls.provider[0].body.idempotency_key,a.id);
});
test('Expo suppression keeps ordinary notification and receipt indices aligned',async()=>{
 const n=chatNotice(),ordinary=notification({id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}),f=fixture({rows:[n,ordinary],deviceRows:[],expoRows:[{id:'person-a',expo_push_token:'synthetic-expo-token'}],chatTargets:[chatTarget(n,{eligible:false})],receipts:[{data:[{status:'ok',id:'chat-mixed-ticket'}]},{data:{'chat-mixed-ticket':{status:'ok'}}}]});const r=await f.run();assert.equal(r.body.expoSent,1);assert.equal(r.body.communityChatsSuppressed,1);assert.equal(f.calls.provider[0].body.length,1);assert.equal(f.calls.provider[0].body[0].data.circleId,ordinary.circle_id);
});
test('Expo unknown chat lookup releases only that chat and still sends a page update',async()=>{
 const n=chatNotice(),page=pageNotice({id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}),f=fixture({rows:[n,page],deviceRows:[],expoRows:[{id:'person-a',expo_push_token:'synthetic-expo-token'}],targets:[target(page)],chatTargetThrow:Error('Unknown chat'),receipts:[{data:[{status:'ok',id:'page-mixed-ticket'}]},{data:{'page-mixed-ticket':{status:'ok'}}}]});const r=await f.run();assert.equal(r.body.expoSent,1);assert.equal(r.body.failed,1);assert.deepEqual(f.calls.updates[0].filters[0].values,[n.id]);assert.equal(f.calls.provider[0].body[0].data.creatorPageId,target(page).page_id);
});

const sceneEvent='33333333-3333-4333-8333-333333333333';
test('Scene attendee update has an explicit event payload on OneSignal without a Plan ID',async()=>{
 const row=notification({type:'broadcast',event_id:null,circle_id:null});const f=fixture({rows:[row],attendeeTargets:[{id:row.id,user_id:row.user_id,explore_event_id:sceneEvent,explore_event_origin_id:sceneEvent}]});
 await f.run();assert.deepEqual(f.calls.provider[0].body.data,{type:'attendee_message',notificationId:row.id,exploreEventId:sceneEvent});
});
test('Scene attendee update uses the same event identity on Expo',async()=>{
 const row=notification({type:'broadcast',event_id:null,circle_id:null});const f=fixture({rows:[row],deviceRows:[],expoRows:[{id:row.user_id,expo_push_token:'ExponentPushToken[synthetic]'}],attendeeTargets:[{id:row.id,user_id:row.user_id,explore_event_id:sceneEvent,explore_event_origin_id:sceneEvent}],receipts:[{data:[{status:'ok',id:'synthetic-ticket'}]},{data:{'synthetic-ticket':{status:'ok'}}}]});
 await f.run();assert.deepEqual(f.calls.provider[0].body[0].data,{type:'attendee_message',notificationId:row.id,exploreEventId:sceneEvent});
});
test('unconfirmed Scene metadata holds affected OneSignal delivery for retry',async()=>{
 const row=notification({type:'broadcast',event_id:null,circle_id:null});const f=fixture({rows:[row],attendeeTargetError:{message:'offline'}});
 await f.run();assert.equal(f.calls.provider.length,0);assert.equal(f.claimed.has(row.id),false);
});
test('unconfirmed Scene metadata holds affected Expo delivery for retry',async()=>{
 const row=notification({type:'broadcast',event_id:null,circle_id:null});const f=fixture({rows:[row],deviceRows:[],expoRows:[{id:row.user_id,expo_push_token:'ExponentPushToken[synthetic]'}],attendeeTargetError:{message:'offline'}});
 await f.run();assert.equal(f.calls.provider.length,0);assert.equal(f.claimed.has(row.id),false);
});
test('ordinary Plan broadcast retains its original payload and needs no Scene lookup',async()=>{
 const row=notification({type:'broadcast',event_id:'plan-id',circle_id:null});const f=fixture({rows:[row]});await f.run();assert.equal(f.calls.provider[0].body.data.eventId,'plan-id');assert.equal(f.calls.reads.filter(r=>r.table==='app_notifications').length,0);
});
test('confirmed ordinary broadcast without event keeps its legacy destination',async()=>{
 const row=notification({type:'broadcast',event_id:null,circle_id:null});const f=fixture({rows:[row],attendeeTargets:[{id:row.id,user_id:row.user_id,explore_event_id:null,explore_event_origin_id:null}]});await f.run();assert.equal(f.calls.provider[0].body.data.type,'broadcast');
});
for (const [label, target] of [
 ['wrong recipient',{user_id:'another-person',explore_event_id:sceneEvent,explore_event_origin_id:sceneEvent}],
 ['invalid event',{user_id:'person-a',explore_event_id:'../../plan'}],
]) test(`untrusted Scene target (${label}) never reaches a provider`,async()=>{
 const row=notification({type:'broadcast',event_id:null,circle_id:null});const f=fixture({rows:[row],attendeeTargets:[{id:row.id,...target}]});await f.run();assert.equal(f.calls.provider.length,0);assert.equal(f.claimed.has(row.id),false);
});

for(const expo of [false,true])test(`deleted Scene event retains full-update push identity (${expo?'Expo':'OneSignal'})`,async()=>{
 const row=notification({type:'broadcast',event_id:null,circle_id:null});
 const f=fixture({rows:[row],attendeeTargets:[{id:row.id,user_id:row.user_id,explore_event_id:null,explore_event_origin_id:sceneEvent}],...(expo?{deviceRows:[],expoRows:[{id:row.user_id,expo_push_token:'ExponentPushToken[synthetic]'}],receipts:[{data:[{status:'ok',id:'synthetic-ticket'}]},{data:{'synthetic-ticket':{status:'ok'}}}]}:{})});
 await f.run();const body=f.calls.provider[0].body;const payload=expo?body[0].data:body.data;
 assert.equal(payload.type,'attendee_message');assert.equal(payload.exploreEventId,sceneEvent);assert.equal(payload.notificationId,row.id);
});

for(const expo of [false,true])for(const decision of ['send','suppress','hold'])test(`invitation ${decision} is respected immediately before ${expo?'Expo':'OneSignal'}`,async()=>{
 const row=notification({type:'broadcast',event_id:null,circle_id:null});
 const f=fixture({rows:[row],attendeeTargets:[{id:row.id,user_id:row.user_id,explore_event_id:sceneEvent,explore_event_origin_id:sceneEvent}],invitationDecisions:[{notification_id:row.id,user_id:row.user_id,decision}],...(expo?{deviceRows:[],expoRows:[{id:row.user_id,expo_push_token:'ExponentPushToken[synthetic]'}],receipts:[{data:[{status:'ok',id:'synthetic-ticket'}]},{data:{'synthetic-ticket':{status:'ok'}}}]}:{})});
 const r=await f.run();assert.equal(r.body.sent,decision==='send'?1:0);
 if(decision==='send'){const payload=expo?f.calls.provider[0].body[0].data:f.calls.provider[0].body.data;assert.deepEqual(payload,{type:'attendee_message',notificationId:row.id,exploreEventId:sceneEvent});}
 else {assert.equal(f.calls.provider.length,0);assert.equal(r.body[decision==='hold'?'invitationsHeld':'invitationsSuppressed'],1);assert.equal(f.claimed.has(row.id),decision==='suppress');}
});
for(const expo of [false,true])for(const defect of ['missing','foreign','wrong-user','duplicate','unknown','error','throw'])test(`invitation ${defect} cannot leak through ${expo?'Expo':'OneSignal'}`,async()=>{
 const row=notification({type:'broadcast',event_id:null,circle_id:null}),valid={notification_id:row.id,user_id:row.user_id,decision:'send'};
 const invalid={missing:[],foreign:[{...valid,notification_id:'other'}],'wrong-user':[{...valid,user_id:'other'}],duplicate:[valid,valid],unknown:[{...valid,decision:'maybe'}],error:[valid],throw:[valid]}[defect];
 const f=fixture({rows:[row],attendeeTargets:[{id:row.id,user_id:row.user_id,explore_event_id:sceneEvent,explore_event_origin_id:sceneEvent}],invitationDecisions:invalid,...(defect==='error'?{invitationError:{message:'offline'}}:{}),...(defect==='throw'?{invitationThrow:Error('offline')}:{}),...(expo?{deviceRows:[],expoRows:[{id:row.user_id,expo_push_token:'ExponentPushToken[synthetic]'}]}:{})});
 const r=await f.run();assert.equal(r.body.sent,0);assert.equal(f.calls.provider.length,0);assert.equal(f.claimed.has(row.id),false);assert.equal(r.body.failed,1);
});

test('invitation eligibility is checked again after an earlier OneSignal request',async()=>{
 const rows=[notification({type:'broadcast',event_id:null,circle_id:null}),notification({id:'55555555-5555-4555-8555-555555555555',type:'broadcast',event_id:null,circle_id:null})];
 const f=fixture({rows,attendeeTargets:filters=>rows.filter(n=>filters[0].values.includes(n.id)).map(n=>({id:n.id,user_id:n.user_id,explore_event_id:sceneEvent,explore_event_origin_id:sceneEvent})),invitationDecisions:args=>args.p_notification_ids.map(id=>({notification_id:id,user_id:'person-a',decision:f.calls.provider.length?'suppress':'send'}))});
 const r=await f.run();assert.equal(r.body.sent,1);assert.equal(r.body.invitationsSuppressed,1);assert.equal(f.calls.provider.length,1);
});
test('Expo checks the next invitation batch again and keeps receipt indices aligned',async()=>{
 const rows=Array.from({length:101},(_,i)=>notification({id:`11111111-1111-4111-8111-${String(i+1).padStart(12,'0')}`,type:'broadcast',event_id:null,circle_id:null}));
 const tickets=Array.from({length:100},(_,i)=>({status:'ok',id:`fixture-${i}`}));
 const f=fixture({rows,deviceRows:[],expoRows:[{id:'person-a',expo_push_token:'synthetic-expo-token'}],attendeeTargets:filters=>rows.filter(n=>filters[0].values.includes(n.id)).map(n=>({id:n.id,user_id:n.user_id,explore_event_id:sceneEvent,explore_event_origin_id:sceneEvent})),invitationDecisions:args=>args.p_notification_ids.map(id=>({notification_id:id,user_id:'person-a',decision:f.calls.provider.length?'suppress':'send'})),receipts:[{data:tickets},{data:Object.fromEntries(tickets.map(t=>[t.id,{status:'ok'}]))}]});
 const r=await f.run();assert.equal(r.body.expoSent,100);assert.equal(r.body.invitationsSuppressed,1);assert.equal(f.calls.provider.filter(c=>c.url.endsWith('/send')).length,1);assert.equal(f.calls.provider[0].body.length,100);
});

const memberTarget=(n,overrides={})=>({notification_id:n.id,user_id:n.user_id,event_id:n.event_id??null,circle_id:n.circle_id??null,eligible:true,reaction_message_id:null,...overrides});
test('member chat rejects a recipient removed before OneSignal delivery',async()=>{
 const n=notification(),f=fixture({rows:[n],memberTargets:[memberTarget(n,{eligible:false})]});
 const r=await f.run();assert.equal(f.calls.provider.length,0);assert.equal(r.body.memberChatsSuppressed,1);assert.equal(r.body.failed,0);
});
test('member chat rechecks the next OneSignal alert after earlier dispatch',async()=>{
 const a=notification(),b=notification({id:'55555555-5555-4555-8555-555555555555'});let checks=0;
 const f=fixture({rows:[a,b],memberTargets:args=>args.p_notification_ids.map(id=>memberTarget(id===a.id?a:b,{eligible:++checks===1}))});
 const r=await f.run();assert.equal(checks,2);assert.equal(f.calls.provider.length,1);assert.equal(r.body.memberChatsSuppressed,1);
});
test('member chat unresolved or mismatched OneSignal targets never send and retain retry identity',async()=>{
 const n=notification();
 for(const options of [{memberTargetError:{message:'offline'}},{memberTargetThrow:Error('timeout')},{memberTargets:[]},{memberTargets:[memberTarget(n,{user_id:'wrong-person'})]},{memberTargets:[memberTarget(n,{circle_id:'wrong-circle'})]},{memberTargets:[memberTarget(n,{eligible:'yes'})]},{memberTargets:[memberTarget(n),memberTarget(n)]}]){
  const f=fixture(options),r=await f.run();assert.equal(f.calls.provider.length,0);assert.equal(r.body.failed,1);assert.equal(f.claimed.has(n.id),false);
 }
});
test('member chat Expo suppression keeps remaining notification and receipt identities aligned',async()=>{
 const a=notification(),b=notification({id:'55555555-5555-4555-8555-555555555555',event_id:'plan-b',circle_id:null});
 const f=fixture({rows:[a,b],deviceRows:[],expoRows:[{id:'person-a',expo_push_token:'synthetic-expo-token'}],memberTargets:[memberTarget(a,{eligible:false}),memberTarget(b)],receipts:[{data:[{status:'ok',id:'kept-ticket'}]},{data:{'kept-ticket':{status:'ok'}}}]});
 const r=await f.run();assert.equal(r.body.expoSent,1);assert.equal(r.body.memberChatsSuppressed,1);assert.equal(f.calls.provider[0].body.length,1);assert.equal(f.calls.provider[0].body[0].data.eventId,b.event_id);
});
test('member chat unresolved Expo targets withhold only those alerts',async()=>{
 const a=notification(),ordinary=notification({id:'55555555-5555-4555-8555-555555555555',type:'admin_alert',circle_id:null});
 const f=fixture({rows:[a,ordinary],deviceRows:[],expoRows:[{id:'person-a',expo_push_token:'synthetic-expo-token'}],memberTargetError:{message:'offline'},receipts:[{data:[{status:'ok',id:'ordinary-ticket'}]},{data:{'ordinary-ticket':{status:'ok'}}}]});
 const r=await f.run();assert.equal(r.body.failed,1);assert.equal(r.body.expoSent,1);assert.equal(f.calls.provider[0].body[0].data.type,'admin_alert');assert.equal(f.claimed.has(a.id),false);
});
test('member chat next Expo batch uses fresh eligibility',async()=>{
 const rows=Array.from({length:101},(_,i)=>notification({id:`11111111-1111-4111-8111-${String(i+1).padStart(12,'0')}`}));let batches=0;
 const tickets=Array.from({length:100},(_,i)=>({status:'ok',id:`member-${i}`}));
 const f=fixture({rows,deviceRows:[],expoRows:[{id:'person-a',expo_push_token:'synthetic-expo-token'}],memberTargets:args=>{batches++;return args.p_notification_ids.map(id=>memberTarget(rows.find(n=>n.id===id),{eligible:batches===1}));},receipts:[{data:tickets},{data:Object.fromEntries(tickets.map(t=>[t.id,{status:'ok'}]))}]});
 const r=await f.run();assert.equal(batches,2);assert.equal(r.body.expoSent,100);assert.equal(r.body.memberChatsSuppressed,1);
});

for(const channel of ['onesignal','expo'])test(`community reaction context survives the actual ${channel} sender`,async()=>{
 const n=chatNotice({type:'community_broadcast',topic_id:null});
 const row=chatTarget(n,{message_id:'99999999-9999-4999-8999-999999999999',message_source:'broadcast',destination_topic_id:'77777777-7777-4777-8777-777777777777'});
 const f=fixture({rows:[n],chatTargets:[row],...(channel==='expo'?{deviceRows:[],expoRows:[{id:'person-a',expo_push_token:'synthetic-expo-token'}],receipts:[{data:[{status:'ok',id:'reaction-ticket'}]},{data:{'reaction-ticket':{status:'ok'}}}]}:{})});
 const r=await f.run();assert.equal(r.body.sent,1);const payload=channel==='expo'?f.calls.provider[0].body[0].data:f.calls.provider[0].body.data;
 assert.equal(payload.reactionMessageId,row.message_id);assert.equal(payload.reactionMessageSource,'broadcast');assert.equal(payload.topicId,row.destination_topic_id);assert.equal(payload.notificationId,n.id);
});
test('invalid reaction identity is held by the actual handler',async()=>{
 const n=chatNotice({type:'community_broadcast',topic_id:null});const f=fixture({rows:[n],chatTargets:[chatTarget(n,{message_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',message_source:'broadcast'})]});
 const r=await f.run();assert.equal(r.body.sent,0);assert.equal(r.body.failed,1);assert.equal(f.calls.provider.length,0);assert.equal(f.claimed.has(n.id),false);
});

for (const provider of ['onesignal','expo']) for (const kind of ['event','circle']) {
 test(`member reaction ${kind} retains exact message through ${provider}`, async()=>{
  const room='55555555-5555-4555-8555-555555555555', message='66666666-6666-4666-8666-666666666666';
  const n=notification({event_id:kind==='event'?room:null,circle_id:kind==='circle'?room:null});
  const target={notification_id:n.id,user_id:n.user_id,event_id:n.event_id,circle_id:n.circle_id,eligible:true,reaction_message_id:message};
  const f=fixture({rows:[n],memberTargets:[target],...(provider==='expo'?{deviceRows:[],expoRows:[{id:n.user_id,expo_push_token:'synthetic-expo-token'}],receipts:[{data:[{status:'ok',id:'ticket'}]},{data:{ticket:{status:'ok'}}}]}:{})});
  await f.run();assert.equal(f.calls.provider.length,provider==='expo'?2:1);assert.ok(f.calls.rpc.some(call=>call.name==='get_member_chat_push_targets_v2'));
  const body=f.calls.provider[0].body,data=provider==='expo'?body[0].data:body.data;
  assert.equal(data.reactionMessageId,message);assert.equal(data.reactionMessageSource,'chat');assert.equal(data.notificationId,n.id);
  assert.equal(data.eventId,n.event_id);assert.equal(data.circleId,n.circle_id);
 });
}
for (const provider of ['onesignal','expo']) for (const badId of ['../../another-room', undefined, 42, {}, false]) test(`member reaction invalid message ${JSON.stringify(badId)} never dispatches through ${provider}`,async()=>{
 const n=notification(),target={notification_id:n.id,user_id:n.user_id,event_id:null,circle_id:n.circle_id,eligible:true,reaction_message_id:badId};
 const f=fixture({rows:[n],memberTargets:[target],...(provider==='expo'?{deviceRows:[],expoRows:[{id:n.user_id,expo_push_token:'synthetic-expo-token'}]}:{})});
 await f.run();assert.equal(f.calls.provider.length,0);assert.ok(!f.claimed.has(n.id),'unresolved identity remains retryable');
});

const joinNotice = (kind = 'request') => notification({ type: 'community_join_' + kind, circle_id: null });
const joinTarget = (kind = 'request', overrides = {}) => ({ notification_id: notification().id, user_id: 'person-a', legacy: false,
  page_id: '33333333-3333-4333-8333-333333333333', member_id: '44444444-4444-4444-8444-444444444444', kind, eligible: true, ...overrides });
for (const channel of ['onesignal', 'expo']) {
  const transport = channel === 'expo' ? { deviceRows: [], expoRows: [{ id: 'person-a', expo_push_token: 'ExponentPushToken[synthetic]' }], receipts: [{data:[{status:'ok',id:'ticket'}]}, {data:{ticket:{status:'ok'}}}] } : {};
  for (const kind of ['request', 'approved', 'declined']) test(`${channel} ${kind} carries exact source and recipient`, async () => {
    const target = joinTarget(kind);
    const f = fixture({ ...transport, rows: [joinNotice(kind)], joinTargets: [target] });
    await f.run();
    assert.ok(f.calls.provider.length > 0);
    const body = f.calls.provider[0].body;
    assert.deepEqual((channel === 'expo' ? body[0] : body).data, {type:'community_join_'+kind,notificationId:target.notification_id,creatorPageId:target.page_id,communityMemberId:target.member_id});
    if (channel === 'onesignal') assert.equal(body.idempotency_key, target.notification_id);
  });
  test(`${channel} revoked join source is suppressed without provider or retry`, async () => {
    const f = fixture({...transport, rows:[joinNotice()],joinTargets:[joinTarget('request',{eligible:false})]});
    const result=await f.run(); assert.equal(f.calls.provider.length,0); assert.equal(result.body.failed,0);
  });
  test(`${channel} unconfirmed join source is retried without provider`, async () => {
    for (const options of [{joinTargetError:{message:'unavailable'}},{joinTargets:[]},{joinTargets:[joinTarget('approved')]},{joinTargets:[joinTarget('request',{user_id:'different-user'})]},{joinTargets:[joinTarget('request',{legacy:true})]}]) {
      const f=fixture({...transport,rows:[joinNotice()],...options}); const result=await f.run();
      assert.equal(f.calls.provider.length,0); assert.equal(result.body.failed,1); assert.equal(f.claimed.size,0);
    }
  });
  test(`${channel} explicitly unmapped legacy joining notice preserves existing payload`, async () => {
    const f=fixture({...transport,rows:[joinNotice()],joinTargets:[joinTarget(null,{legacy:true,page_id:null,member_id:null})]});
    await f.run(); const body=f.calls.provider[0].body;
    assert.deepEqual((channel==='expo'?body[0]:body).data,{type:'community_join_request',eventId:null,circleId:null,topicId:null});
  });
}
