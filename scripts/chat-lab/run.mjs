/** Local-only integration lab: real Auth, PostgREST, Realtime, three sessions.
 * Scoped schema fixture, not production parity or a native UI benchmark.
 * Node 24+ runs the app's TypeScript receipt and deduplication utilities. */
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {createClient} from '@supabase/supabase-js';
import WebSocket from 'ws';
import {subscribeChatWhenReady} from '../../lib/chatRealtimeSubscription.ts';
import {resolveChatSendReceipt} from '../../lib/chatSendReceipt.ts';
import {mergeTopicMessagesWithPending} from '../../lib/topicPendingMessages.ts';

const [connectionPath, reportPath] = process.argv.slice(2);
const reconnectCycles = Number(process.env.CHAT_LAB_RECONNECT_CYCLES ?? 6);
assert(Number.isInteger(reconnectCycles) && reconnectCycles >= 1 && reconnectCycles <= 100,
  'CHAT_LAB_RECONNECT_CYCLES must be an integer from 1 to 100');
assert(connectionPath && reportPath, 'Usage: node run.mjs /private/local-connection.json /local/report.json');
const config = JSON.parse(await readFile(connectionPath, 'utf8'));
const endpoint = new URL(config.API_URL);
assert(endpoint.protocol === 'http:' && endpoint.hostname === '127.0.0.1' && endpoint.port,
  'Refusing any endpoint except an explicit IPv4 loopback HTTP port');
assert(config.ANON_KEY && config.SERVICE_ROLE_KEY, 'Local connection credentials are required');
const nativeFetch = globalThis.fetch;
const localFetch = (url, options = {}) => {
  assert.equal(new URL(typeof url === 'string' ? url : url.url ?? url).origin, endpoint.origin,
    'Refusing a request outside this local test server');
  return nativeFetch(url, {...options, redirect: 'error', signal: options.signal ?? AbortSignal.timeout(12000)});
};
class LocalSocket extends WebSocket {
  constructor(url, protocols) {
    const target = new URL(url);
    assert(target.protocol === 'ws:' && target.hostname === '127.0.0.1' && target.port === endpoint.port,
      'Refusing a nonlocal WebSocket');
    super(url, protocols);
  }
}
const clients = [];
const client = key => {
  const value = createClient(endpoint.href, key, {
    auth: {persistSession: false, autoRefreshToken: false, detectSessionInUrl: false},
    global: {fetch: localFetch}, realtime: {transport: LocalSocket},
  });
  clients.push(value); return value;
};
const admin = client(config.SERVICE_ROLE_KEY);
const checks = [], timings = [], streams = [];
let typingCloseWindows = 0;
const typingReconnectCycles = 20;
const pendingJoins = new Set();
const run = randomUUID(), community = randomUUID(), topic = randomUUID();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label, deadline = 12000) {
  const start = performance.now();
  while (!await predicate()) {
    if (performance.now() - start > deadline) throw Error(`Timed out: ${label}`);
    await pause(20);
  }
}
function ok(result) { if (result.error) throw Error(`Local service error: ${result.error.code ?? result.error.name}: ${result.error.message}`); return result.data; }
async function actor(name) {
  const email = `${name}-${run}@chat-lab.invalid`, password = randomUUID();
  const user = ok(await admin.auth.admin.createUser({email, password, email_confirm: true})).user;
  const api = client(config.ANON_KEY);
  const session = ok(await api.auth.signInWithPassword({email, password})).session;
  assert.equal(session.user.id, user.id);
  await api.realtime.setAuth(session.access_token);
  return {api, id: user.id, rows: [], ready: false, events: [], channel: null};
}
async function listen(person) {
  person.ready = false;
  const diagnostics={statuses:[],system:[]};streams.push(diagnostics);
  person.channel = person.api.channel(`lab:${topic}:${randomUUID()}`)
    .on('postgres_changes', {event: 'INSERT', schema: 'public', table: 'community_topic_messages', filter: `topic_id=eq.${topic}`}, event => {
      person.events.push(event.new);
      person.rows = mergeTopicMessagesWithPending([...person.rows, event.new], []);
    })
    .on('system', {}, event => {diagnostics.system.push({extension:event.extension,status:event.status,message:event.message});if (event.extension === 'postgres_changes' && event.status === 'ok') person.ready = true;})
    ;
  person.stopWaiting = subscribeChatWhenReady(() => person.api.realtime.isDisconnecting(),
    () => {person.channel.subscribe((status, error) => {diagnostics.statuses.push({status,error:error?.message});});},
    () => person.channel !== null);
  pendingJoins.add(person.stopWaiting);
  await until(() => person.ready, 'Postgres stream readiness');
}
async function stopListening(person) {
  person.stopWaiting?.();
  if (person.channel) await person.api.removeChannel(person.channel);
  person.api.realtime.disconnect(); person.channel = null; person.ready = false;
}
async function history(person) {
  const data = ok(await person.api.from('community_topic_messages').select('*').eq('topic_id', topic)
    .order('created_at').order('id').limit(1000));
  person.rows = mergeTopicMessagesWithPending(data, []); return data;
}
async function send(person, text, id = randomUUID(), loseResponse = false) {
  const result = await resolveChatSendReceipt(async () => {
    const result = await person.api.from('community_topic_messages')
      .insert({id, topic_id: topic, sender_id: person.id, body: text}).select('*').single();
    if (loseResponse && !result.error) throw Error('Injected response loss after the real server committed');
    return result;
  }, () => person.api.from('community_topic_messages').select('*')
    .eq('id', id).eq('topic_id', topic).eq('sender_id', person.id).maybeSingle());
  assert(result.receipt, `Send was not confirmed: ${result.failure?.message}`);
  assert.equal(result.receipt.id, id);
  return id;
}
async function check(name, work) {
  const start = performance.now(); await work();
  checks.push({name, passed: true, elapsedMs: Math.round(performance.now() - start)});
  console.log(`PASS ${name}`);
}
let failure;
try {
  const marker = ok(await admin.from('chat_lab_marker').select('id').single());
  assert.equal(marker.id, 'washedup-local-chat-lab-v1', 'This must be the disposable chat lab');
  const [alice, bob, outsider] = await Promise.all(['alice', 'bob', 'outsider'].map(actor));
  ok(await admin.from('communities').insert({id: community, name: `Local lab ${run}`}));
  ok(await admin.from('community_topics').insert({id: topic, community_id: community, name: 'Local chat'}));
  ok(await admin.from('community_members').insert([alice, bob].map(p => ({community_id: community, user_id: p.id, status: 'active'}))));
  ok(await admin.from('community_topic_members').insert([alice, bob].map(p => ({topic_id: topic, user_id: p.id}))));
  await Promise.all([alice, bob, outsider].map(listen));
  await check('Two separately authenticated clients receive each other’s live inserts', async () => {
    for (const [sender, receiver] of [[alice, bob], [bob, alice]]) {
      const start = performance.now(), id = await send(sender, 'Hello from another session');
      await until(() => receiver.rows.some(row => row.id === id), 'other session live message');
      timings.push(performance.now() - start);
      assert.equal(receiver.rows.find(row => row.id === id).sender_id, sender.id);
    }
  });
  await check('Unicode and multiline text survive the real transport', async () => {
    const body = 'See you ☀️\nCafé — 你好', id = await send(alice, body);
    await until(() => bob.rows.some(row => row.id === id), 'unicode delivery');
    assert.equal(bob.rows.find(row => row.id === id).body, body);
  });
  await check('Forty simultaneous sends with identical text retain forty distinct UUIDs', async () => {
    const ids = await Promise.all(Array.from({length: 40}, (_, i) => send(i % 2 ? alice : bob, 'Same words')));
    await until(() => [alice, bob].every(p => ids.every(id => p.rows.some(row => row.id === id))), 'burst delivery');
    for (const person of [alice, bob]) assert.equal(person.rows.filter(row => ids.includes(row.id)).length, 40);
  });
  await check('Lost insert response is recovered by the app receipt helper without another insert', async () => {
    const id = await send(alice, 'Saved despite response loss', undefined, true);
    await until(() => bob.rows.some(row => row.id === id), 'lost-response recipient');
    assert.equal((await history(alice)).filter(row => row.id === id).length, 1);
  });
  await check('Same-UUID retry leaves one server row and one received event', async () => {
    const id = await send(alice, 'Retry original');
    await send(alice, 'Retry original', id);
    await until(() => bob.rows.some(row => row.id === id), 'retry recipient');
    assert.equal((await history(alice)).filter(row => row.id === id).length, 1);
    assert.equal(bob.events.filter(row => row.id === id).length, 1);
  });
  await check('A disconnected receiver catches up twenty missed messages through history', async () => {
    await stopListening(bob); const before = bob.events.length;
    const ids = await Promise.all(Array.from({length: 20}, () => send(alice, 'While receiver was disconnected')));
    assert.equal(bob.events.length, before);
    await listen(bob); const rows = await history(bob);
    assert(ids.every(id => rows.some(row => row.id === id)));
    const live = await send(alice, 'After reconnect');
    await until(() => bob.rows.some(row => row.id === live), 'post-reconnect live event');
  });
  await check(`${reconnectCycles} repeated reconnects recover history and keep live delivery working`, async () => {
    for (let cycle = 0; cycle < reconnectCycles; cycle++) {
      await stopListening(bob); const missed = await send(alice, `Missed cycle ${cycle}`);
      await listen(bob); assert((await history(bob)).some(row => row.id === missed));
      const live = await send(alice, `Live cycle ${cycle}`);
      await until(() => bob.rows.some(row => row.id === live), 'cycle live event');
    }
  });
  await check('An unrelated authenticated user cannot read, receive, or insert room messages', async () => {
    assert.deepEqual(await history(outsider), []);
    const refused = await outsider.api.from('community_topic_messages').insert({id: randomUUID(), topic_id: topic, sender_id: outsider.id, body: 'Must be refused'});
    assert(refused.error, 'Outsider insert must be rejected by RLS');
    assert.equal(outsider.events.length, 0);
  });
  await check('Sender impersonation is refused by database policy', async () => {
    const refused = await bob.api.from('community_topic_messages').insert({id: randomUUID(), topic_id: topic, sender_id: alice.id, body: 'Must be refused'});
    assert(refused.error, 'Forged sender must be rejected');
  });
  await check('Archived-room sends are refused while existing history remains readable', async () => {
    ok(await admin.from('community_topics').update({archived: true}).eq('id', topic));
    const refused = await alice.api.from('community_topic_messages').insert({id: randomUUID(), topic_id: topic, sender_id: alice.id, body: 'Must be refused'});
    assert(refused.error, 'Archived-room insert must be rejected');
    const a = await history(alice), b = await history(bob);
    assert.deepEqual(a.map(row => row.id), b.map(row => row.id));
    assert.equal(a.length, 66 + 2 * reconnectCycles);
  });
  await check('Shared-name typing broadcasts recover through twenty socket teardowns', async () => {
    // Leave data channels so removing typing is genuinely the last socket user.
    await Promise.all([alice, bob].map(stopListening));
    const received = new Map([[alice, []], [bob, []]]);
    const joins = new Map();
    const join = async person => {
      let active = true, ready = false;
      if (person.api.realtime.isDisconnecting()) typingCloseWindows++;
      const channel = person.api.channel(`typing:community-topic:${topic}`, {config: {broadcast: {self: false}}})
        .on('broadcast', {event: 'typing'}, event => { if (active) received.get(person).push(event.payload); });
      const cancel = subscribeChatWhenReady(() => person.api.realtime.isDisconnecting(),
        () => channel.subscribe(status => { if (active) ready = status === 'SUBSCRIBED'; }), () => active);
      pendingJoins.add(cancel);
      joins.set(person, {channel, stop: () => {active = false; cancel();}});
      await until(() => ready, 'typing broadcast join');
    };
    await Promise.all([alice, bob].map(join));
    for (let cycle = 0; cycle < typingReconnectCycles; cycle++) {
      const previous = joins.get(bob);
      previous.stop();
      await bob.api.removeChannel(previous.channel);
      await join(bob);
      for (const [sender, receiver] of [[alice, bob], [bob, alice]]) {
        const result = await joins.get(sender).channel.send({type: 'broadcast', event: 'typing',
          payload: {userId: sender.id, name: 'Local tester', isTyping: cycle % 2 === 0, cycle}});
        assert.equal(result, 'ok');
        await until(() => received.get(receiver).some(p => p.userId === sender.id && p.cycle === cycle
          && p.isTyping === (cycle % 2 === 0)), 'typing broadcast after socket close');
      }
    }
    assert(typingCloseWindows > 0, 'Must exercise an actual SDK closing window');
    for (const person of [alice, bob]) {
      assert.equal(received.get(person).length, typingReconnectCycles);
      const last = joins.get(person); last.stop(); await person.api.removeChannel(last.channel);
    }
  });
} catch (error) {
  failure = error.message; console.error(`FAIL ${failure}`); process.exitCode = 1;
} finally {
  for (const stop of pendingJoins) stop();
  for (const value of clients) {await value.removeAllChannels(); value.realtime.disconnect(); value.auth.stopAutoRefresh();}
  await writeFile(reportPath, JSON.stringify({scope: 'Local real services with scoped topic-policy fixture; not full-app/native/production parity', checks, failure,
    streams, reconnectCycles, typingReconnectCycles, typingCloseWindows, expectedMessages: 66 + 2 * reconnectCycles,
    localRoundTripMs: timings.map(Math.round), realServiceClients: 3, productionRequests: 0}, null, 2) + '\n');
}
