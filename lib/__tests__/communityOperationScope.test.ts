jest.mock('../supabase', () => ({ supabase: { auth: { getUser: jest.fn() }, from: jest.fn(), rpc: jest.fn() } }));
jest.mock('../blocking', () => ({ getBlockedWith: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'generated-uuid' }));

import { addChatMentionReference } from '../chatMentionIdentity';
import { supabase } from '../supabase';
import { getBlockedWith } from '../blocking';
import * as community from '../communityChat';

const getUser = jest.mocked(supabase.auth.getUser);
const from = jest.mocked(supabase.from);
const rpc = jest.mocked(supabase.rpc);
const blocked = jest.mocked(getBlockedWith);
type Request = { table: string; operation: string; filters: Array<[string, unknown]>; payload?: unknown; columns?: string; order: unknown[]; limit?: number; or?: string; conflict?: unknown };
const requests: Request[] = [];
const execute = jest.fn();
let epoch = 1;
const scope = () => { const captured = epoch; return { userId: 'account-a', isCurrent: () => captured === epoch }; };
const auth = (id = 'account-a') => ({ data: { user: { id } }, error: null } as any);
const receipt = { id: 'client-uuid', created_at: '2026-09-13T20:00:00Z' };
const row = { id: 'message-one', sender_id: 'account-a', created_at: receipt.created_at, body: 'hello', kind: 'message', payload: null, image_url: null, edited_at: null };
function pending<T = any>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
async function flush() { for (let i = 0; i < 30; i++) await Promise.resolve(); }
const obsolete = { name: 'ObsoleteCommunityOperationError' };

beforeEach(() => {
  jest.clearAllMocks(); epoch = 1; requests.length = 0;
  getUser.mockResolvedValue(auth());
  blocked.mockResolvedValue(new Set());
  rpc.mockResolvedValue({ data: { cards: [], attendee_topics: [] }, error: null } as any);
  execute.mockReset().mockImplementation((request: Request) => ({ data: request.operation === 'insert' ? { ...receipt, ...(request.payload as object) } : [], error: null }));
  from.mockImplementation(((table: string) => {
    const request: Request = { table, operation: 'select', filters: [], order: [] }; requests.push(request);
    const chain: any = {};
    chain.select = (columns: string) => { request.columns = columns; return chain; };
    for (const operation of ['insert', 'update', 'delete', 'upsert']) chain[operation] = (payload: unknown, conflict: unknown) => { request.operation = operation; request.payload = payload; request.conflict = conflict; return chain; };
    for (const filter of ['eq', 'in', 'gte', 'is']) chain[filter] = (key: string, value: unknown) => { request.filters.push([key, value]); return chain; };
    chain.order = (...args: unknown[]) => { request.order.push(args); return chain; };
    chain.limit = (value: number) => { request.limit = value; return chain; };
    chain.or = (value: string) => { request.or = value; return chain; };
    chain.single = chain.maybeSingle = () => chain;
    chain.then = (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve().then(() => execute(request)).then(resolve, reject);
    return chain;
  }) as any);
});

const mutations: Array<[string, (owner: ReturnType<typeof scope>) => Promise<unknown>]> = [
  ['legacy topic join', owner => community.joinTopic('topic-a', owner)],
  ['send', owner => community.sendCommunityMessage('community-a', 'hello', undefined, 'client-uuid', owner)],
  ['edit', owner => community.editCommunityMessage('message-one', 'edited', owner)],
  ['delete', owner => community.deleteCommunityMessage('message-one', owner)],
  ['reaction', owner => community.toggleBroadcastReaction('message-one', '❤️', true, owner)],
  ['reaction removal', owner => community.toggleBroadcastReaction('message-one', 'heart', false, owner)],
  ['read marker', owner => community.markBroadcastsRead('community-a', owner)],
  ['message page', owner => community.getCommunityBroadcasts('community-a', undefined, owner)],
];

it.each(mutations)('%s cannot adopt another user after its internal auth await', async (_name, run) => {
  const identity = pending(); getUser.mockReturnValueOnce(identity.promise);
  const operation = run(scope()); const assertion = expect(operation).rejects.toMatchObject(obsolete);
  epoch++;
  identity.resolve(auth('account-b'));
  await assertion;
  expect(from).not.toHaveBeenCalled();
});

it('rejects a retired caller before starting auth, including an A→B→A epoch', async () => {
  const owner = scope(); epoch += 2;
  await expect(community.sendCommunityMessage('community-a', 'old text', undefined, 'client-uuid', owner)).rejects.toMatchObject(obsolete);
  expect(getUser).not.toHaveBeenCalled();
});

it('rejects mismatched auth even before the caller observer reports a change', async () => {
  getUser.mockResolvedValueOnce(auth('account-b'));
  await expect(community.sendCommunityMessage('community-a', 'old text', undefined, 'client-uuid', scope())).rejects.toMatchObject(obsolete);
  expect(from).not.toHaveBeenCalled();
});

it('does not perform receipt lookup after a retired insert loses its response', async () => {
  const insert = pending(); execute.mockReturnValueOnce(insert.promise);
  const operation = community.sendCommunityMessage('community-a', 'text', undefined, 'client-uuid', scope());
  const assertion = expect(operation).rejects.toMatchObject(obsolete);
  await flush(); epoch++;
  insert.resolve({ data: null, error: new Error('response lost') });
  await assertion;
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ operation: 'insert', payload: { sender_id: 'account-a', community_id: 'community-a', id: 'client-uuid' } });
});

it('rejects a late receipt while preserving its UUID, community and initiating sender filters', async () => {
  const lookup = pending(); execute.mockReturnValueOnce({ data: null, error: new Error('timeout') }).mockReturnValueOnce(lookup.promise);
  const operation = community.sendCommunityMessage('community-a', 'text', undefined, 'client-uuid', scope());
  const assertion = expect(operation).rejects.toMatchObject(obsolete);
  await flush();
  expect(requests[1].filters).toEqual([['id', 'client-uuid'], ['community_id', 'community-a'], ['sender_id', 'account-a']]);
  epoch += 2; lookup.resolve({ data: receipt, error: null });
  await assertion;
});

it('does not continue blocked filtering or enrichment after the primary page is retired', async () => {
  const page = pending(); execute.mockReturnValueOnce(page.promise);
  const operation = community.getCommunityBroadcasts('community-a', undefined, scope());
  const assertion = expect(operation).rejects.toMatchObject(obsolete);
  await flush(); epoch++;
  page.resolve({ data: [row], error: null });
  await assertion;
  expect(blocked).not.toHaveBeenCalled();
  expect(requests).toHaveLength(1);
});

it('does not return or start further work after a delayed block check loses its account', async () => {
  const check = pending<Set<string>>(); blocked.mockReturnValueOnce(check.promise);
  execute.mockReturnValueOnce({ data: [row], error: null });
  const operation = community.getCommunityBroadcasts('community-a', undefined, scope());
  const assertion = expect(operation).rejects.toMatchObject(obsolete);
  await flush();
  expect(requests).toHaveLength(4);
  epoch++;
  check.resolve(new Set()); await assertion;
  expect(requests).toHaveLength(4);
});

it('does not return account-specific reactions from a retired enrichment result', async () => {
  const reactions = pending();
  execute.mockImplementation((request: Request) => request.table === 'community_broadcast_reactions' ? reactions.promise : { data: request.table === 'community_broadcasts' ? [row] : [], error: null });
  const operation = community.getCommunityBroadcasts('community-a', undefined, scope());
  const assertion = expect(operation).rejects.toMatchObject(obsolete);
  await flush(); epoch++;
  reactions.resolve({ data: [{ broadcast_id: row.id, emoji: 'heart', user_id: 'account-a' }], error: null });
  await assertion;
});

it('does not acknowledge a read marker after its owning visit retires', async () => {
  const write = pending(); execute.mockReturnValueOnce(write.promise);
  const operation = community.markBroadcastsRead('community-a', scope());
  const assertion = expect(operation).rejects.toMatchObject(obsolete);
  await flush(); epoch++;
  write.resolve({ error: null }); await assertion;
  expect(requests[0]).toMatchObject({ table: 'community_broadcast_reads', operation: 'upsert', payload: { community_id: 'community-a', user_id: 'account-a' }, conflict: { onConflict: 'community_id,user_id' } });
});

it('recovers a current lost-response send with the original UUID, room and sender', async () => {
  const userResult = auth(); getUser.mockResolvedValueOnce(userResult);
  execute.mockImplementationOnce(() => { userResult.data.user.id = 'mutated-user-object'; throw new Error('response lost'); })
    .mockResolvedValueOnce({ data: { ...receipt, body: 'x'.repeat(4000), image_url: 'https://example.invalid/photo.jpg' }, error: null });
  await expect(community.sendCommunityMessage('community-a', ` ${'x'.repeat(4002)} `, 'https://example.invalid/photo.jpg', 'client-uuid', scope())).resolves.toBeUndefined();
  expect(getUser).toHaveBeenCalledTimes(1);
  expect(requests[0]).toMatchObject({ table: 'community_broadcasts', operation: 'insert', columns: 'id, created_at, body, image_url', payload: { id: 'client-uuid', community_id: 'community-a', sender_id: 'account-a', body: 'x'.repeat(4000), image_url: 'https://example.invalid/photo.jpg', kind: 'message' } });
  expect(requests[1].filters).toEqual([['id', 'client-uuid'], ['community_id', 'community-a'], ['sender_id', 'account-a']]);
});

it('keeps existing unscoped send and signed-out read-marker behavior', async () => {
  await expect(community.sendCommunityMessage('community-a', ' hello ')).resolves.toBeUndefined();
  expect(requests[0].payload).toMatchObject({ id: 'generated-uuid', body: 'hello', sender_id: 'account-a', image_url: null });
  getUser.mockResolvedValueOnce({ data: { user: null }, error: null } as any);
  await expect(community.markBroadcastsRead('community-a')).resolves.toBeUndefined();
  expect(requests).toHaveLength(1);
});

it('preserves edit/delete ownership filters and legacy reaction storage keys and duplicate semantics', async () => {
  await community.editCommunityMessage('message-one', ' edited ', scope());
  await community.deleteCommunityMessage('message-one', scope());
  await community.toggleBroadcastReaction('message-one', 'heart', false, scope());
  execute.mockResolvedValueOnce({ data: null, error: { code: '23505' } });
  await expect(community.toggleBroadcastReaction('message-one', '❤️', true, scope())).resolves.toBeUndefined();
  expect(requests[0]).toMatchObject({ operation: 'update', payload: { body: 'edited' }, filters: [['id', 'message-one'], ['sender_id', 'account-a'], ['kind', 'message']] });
  expect(requests[1]).toMatchObject({ operation: 'delete', filters: [['id', 'message-one'], ['sender_id', 'account-a'], ['kind', 'message']] });
  expect(requests[2]).toMatchObject({ table: 'community_broadcast_reactions', operation: 'delete', filters: [['broadcast_id', 'message-one'], ['user_id', 'account-a'], ['emoji', 'heart']] });
  expect(requests[3].payload).toEqual({ broadcast_id: 'message-one', user_id: 'account-a', emoji: '❤️' });
});

it('keeps current auth failures honest but makes a retired rejected auth read obsolete', async () => {
  const failure = new Error('auth unavailable');
  getUser.mockResolvedValueOnce({ data: { user: null }, error: failure } as any);
  await expect(community.sendCommunityMessage('community-a', 'text', undefined, undefined, scope())).rejects.toBe(failure);
  const identity = pending(); getUser.mockReturnValueOnce(identity.promise);
  const operation = community.editCommunityMessage('message-one', 'text', scope());
  const assertion = expect(operation).rejects.toMatchObject(obsolete);
  epoch++; identity.resolve({ data: { user: null }, error: failure });
  await assertion;
  expect(requests).toHaveLength(0);
  expect(community.isObsoleteCommunityOperation(new community.ObsoleteCommunityOperationError())).toBe(true);
  expect(community.isObsoleteCommunityOperation(failure)).toBe(false);
});

it('preserves raw pagination identity, blocked filtering, intro payload and own reaction enrichment', async () => {
  const intro = { ...row, id: 'intro-original-id', kind: 'intro', payload: { user_id: 'account-a', first_name: 'A', area: 'LA', question: 'A question', answer: 'An existing answer' } };
  const hidden = { ...row, id: 'raw-oldest-hidden', sender_id: 'blocked-peer', created_at: '2026-09-12T20:00:00Z' };
  execute.mockImplementation((request: Request) => ({ data: request.table === 'community_broadcasts' ? [intro, hidden]
    : request.table === 'community_broadcast_reactions' ? [{ broadcast_id: intro.id, emoji: 'heart', user_id: 'account-a' }]
      : request.table === 'profiles_public' ? [{ id: 'account-a', first_name_display: 'A', profile_photo_url: null }] : [], error: null }));
  blocked.mockResolvedValueOnce(new Set(['blocked-peer']));
  const cursor = { created_at: '2026-09-14T20:00:00Z', id: 'newer-id' };
  const page = await community.getCommunityBroadcasts('community-a', cursor, scope());
  expect(page.messages).toHaveLength(1);
  expect(page.messages[0]).toMatchObject({ id: intro.id, kind: 'intro', payload: intro.payload, sender_name: 'A', reactions: [{ emoji: 'heart', count: 1, mine: true }] });
  expect(page.olderCursor).toEqual({ id: hidden.id, created_at: hidden.created_at });
  expect(page.hasMore).toBe(false);
  expect(requests[0].order).toEqual([['created_at', { ascending: false }], ['id', { ascending: false }]]);
  expect(requests[0].or).toContain(cursor.id);
  expect(blocked).toHaveBeenCalledWith('account-a', ['account-a', 'blocked-peer']);
});

it('keeps direct React Query payload callers compatible while rejecting a retired scoped payload', async () => {
  await expect(community.getCommunityChatPayload({ queryKey: ['community-chat-cards'] })).resolves.toEqual({ cards: [], attendee_topics: [] });
  await expect(community.getCommunityChatPayload()).resolves.toEqual({ cards: [], attendee_topics: [] });
  const payload = pending(); rpc.mockReturnValueOnce(payload.promise as any);
  const operation = community.getCommunityChatPayload(scope());
  const assertion = expect(operation).rejects.toMatchObject(obsolete);
  epoch++; payload.resolve({ data: { cards: [{ name: 'PRIVATE_ACCOUNT_A' }] }, error: null });
  await assertion;
  expect(rpc).toHaveBeenCalledWith('get_my_community_chat_cards');
  const explicitWithQueryKey = { ...scope(), queryKey: ['community-chat-cards'] }; epoch++;
  const calls = rpc.mock.calls.length;
  await expect(community.getCommunityChatPayload(explicitWithQueryKey)).rejects.toMatchObject(obsolete);
  expect(rpc).toHaveBeenCalledTimes(calls);
});

it('does not fetch member profiles after the original membership read retires', async () => {
  const members = pending(); execute.mockReturnValueOnce(members.promise);
  const operation = community.getCommunityChatMembers('community-a', scope());
  const assertion = expect(operation).rejects.toMatchObject(obsolete);
  await flush(); epoch++; members.resolve({ data: [{ user_id: 'account-a' }], error: null });
  await assertion;
  expect(requests).toHaveLength(1);
  expect(requests[0].filters).toEqual([['community_id', 'community-a'], ['status', 'active']]);
});

it('rejects late member profile and pinned event responses without changing their source queries', async () => {
  const profiles = pending();
  execute.mockResolvedValueOnce({ data: [{ user_id: 'account-a' }], error: null }).mockReturnValueOnce(profiles.promise);
  const operation = community.getCommunityChatMembers('community-a', scope());
  const assertion = expect(operation).rejects.toMatchObject(obsolete);
  await flush(); epoch++; profiles.resolve({ data: [{ id: 'account-a', first_name_display: 'PRIVATE_A' }], error: null });
  await assertion;
  expect(requests[1]).toMatchObject({ table: 'profiles_public', filters: [['id', ['account-a']]] });
  const event = pending(); execute.mockReturnValueOnce(event.promise);
  const pin = community.getPinnedCommunityEvent('community-a', scope());
  const pinAssertion = expect(pin).rejects.toMatchObject(obsolete);
  await flush(); epoch++; event.resolve({ data: [{ id: 'event-one', title: 'PRIVATE_EVENT' }], error: null });
  await pinAssertion;
  expect(requests[2].filters).toEqual(expect.arrayContaining([['community_id', 'community-a'], ['status', 'Live'], ['pin_to_chat', true]]));
});

it('reply send cannot adopt a replacement account after its internal auth await', async () => {
  const identity = pending(); getUser.mockReturnValueOnce(identity.promise);
  const operation = community.sendBroadcastReply('broadcast-one', ' hello ', scope());
  const assertion = expect(operation).rejects.toMatchObject(obsolete);
  epoch++; identity.resolve(auth('account-b')); await assertion;
  expect(requests).toHaveLength(0);
});

it('reply enrichment cannot start auth or profile reads after its primary result retires', async () => {
  const replies = pending(); execute.mockReturnValueOnce(replies.promise);
  const operation = community.getBroadcastReplies('broadcast-one', scope());
  const assertion = expect(operation).rejects.toMatchObject(obsolete);
  await flush(); epoch++;
  replies.resolve({ data: [row], error: null }); await assertion;
  expect(getUser).not.toHaveBeenCalled();
  expect(requests).toHaveLength(1);
});

it('reply enrichment cannot filter as a different user after its internal auth await', async () => {
  execute.mockReturnValueOnce({ data: [row], error: null });
  const identity = pending(); getUser.mockReturnValueOnce(identity.promise);
  const operation = community.getBroadcastReplies('broadcast-one', scope());
  const assertion = expect(operation).rejects.toMatchObject(obsolete);
  await flush(); epoch++;
  identity.resolve(auth('account-b')); await assertion;
  expect(blocked).not.toHaveBeenCalled();
  expect(requests).toHaveLength(1);
});

it('reply enrichment stops before profiles when its block lookup retires and rejects late profiles too', async () => {
  const blockCheck = pending<Set<string>>(); blocked.mockReturnValueOnce(blockCheck.promise);
  execute.mockResolvedValueOnce({ data: [row], error: null });
  const first = community.getBroadcastReplies('broadcast-one', scope());
  const firstAssertion = expect(first).rejects.toMatchObject(obsolete);
  await flush(); epoch++; blockCheck.resolve(new Set()); await firstAssertion;
  expect(requests).toHaveLength(1);
  const profile = pending();
  execute.mockResolvedValueOnce({ data: [row], error: null }).mockReturnValueOnce(profile.promise);
  const second = community.getBroadcastReplies('broadcast-one', scope());
  const secondAssertion = expect(second).rejects.toMatchObject(obsolete);
  await flush(); epoch += 2;
  profile.resolve({ data: [{ id: 'account-a', first_name_display: 'PRIVATE_NAME' }], error: null });
  await secondAssertion;
});

it('preserves current reply IDs/order, mutual block filtering, sender identity and send body contract', async () => {
  const reply = { id: 'original-reply-id', body: 'an existing reply', created_at: receipt.created_at, sender_id: 'account-a' };
  execute.mockResolvedValueOnce({ data: [reply, { ...reply, id: 'blocked-reply', sender_id: 'blocked-peer' }], error: null })
    .mockResolvedValueOnce({ data: [{ id: 'account-a', first_name_display: 'A', profile_photo_url: 'https://example.invalid/a.jpg' }], error: null });
  blocked.mockResolvedValueOnce(new Set(['blocked-peer']));
  await expect(community.getBroadcastReplies('broadcast-one', scope())).resolves.toEqual({replies:[
    { ...reply, sender_name: 'A', sender_photo: 'https://example.invalid/a.jpg' },
  ], hasMore:false,olderCursor:{id:'blocked-reply',created_at:reply.created_at}});
  expect(requests[0]).toMatchObject({ table: 'community_broadcast_replies', columns: 'id, body, created_at, sender_id, mention_data', filters: [['broadcast_id', 'broadcast-one']], order: [['created_at', { ascending: false }], ['id', { ascending: false }]], limit: 60 });
  await expect(community.sendBroadcastReply('broadcast-one', ' new reply ', scope())).resolves.toBeUndefined();
  expect(requests[2]).toMatchObject({ operation: 'insert', payload: { broadcast_id: 'broadcast-one', sender_id: 'account-a', body: 'new reply' } });
});

it('exact broadcast reads preserve original reply/reaction identity and omit handle enrichment', async () => {
  execute.mockImplementation((r: Request) => ({ data: r.table === 'community_broadcasts' ? [{ ...row, kind: 'intro' }]
    : r.table === 'profiles_public' ? [{ id: 'account-a', first_name_display: 'A', profile_photo_url: null }]
      : r.table === 'community_broadcast_replies' ? [{ broadcast_id: row.id }]
        : r.table === 'community_broadcast_reactions' ? [{ broadcast_id: row.id, emoji: '❤', user_id: 'account-a' }] : [], error: null }));
  const page = await community.getCommunityBroadcasts('community-a', undefined, scope(), { messageIds: [row.id], strictEnrichment: true });
  expect(page.messages[0]).toMatchObject({ id: row.id, reply_count: 1, reactions: [{ emoji: '❤', count: 1, mine: true }], sender_name: 'A' });
  expect(requests[0].filters).toEqual([['community_id', 'community-a'], ['id', [row.id]]]);
  expect(requests.find(r => r.table === 'profiles_public')?.columns).toBe('id, first_name_display, profile_photo_url');
});

it('new strict enrichment distinguishes a failed reply read from zero replies', async () => {
  const failure = Error('reply read unavailable');
  execute.mockImplementation((r: Request) => r.table === 'community_broadcast_replies' ? { data: null, error: failure }
    : { data: r.table === 'community_broadcasts' ? [row] : [], error: null });
  await expect(community.getCommunityBroadcasts('community-a', undefined, scope(), { messageIds: [row.id], strictEnrichment: true })).rejects.toBe(failure);
});

it('topic history resolves original reply parents outside the loaded page within the same topic', async () => {
  const child = { ...row, reply_to_message_id: 'parent', image_url: null }, parent = { ...row, id: 'parent', body: 'Original parent', sender_id: 'parent-sender' };
  execute.mockImplementation((r: Request) => ({ data: r.table === 'community_topic_messages'
    ? r.filters.some(([key, value]) => key === 'id' && (value as string[]).includes('parent')) ? [parent] : [child]
    : r.table === 'profiles_public' ? [{ id: 'account-a', first_name_display: 'A' }, { id: 'parent-sender', first_name_display: 'Parent' }] : [], error: null }));
  const page = await community.getTopicMessages('intro-topic', undefined, scope(), { messageIds: [row.id], strictEnrichment: true, resolveReplyParents: true });
  expect(page.messages).toHaveLength(1);
  expect(page.messages[0]).toMatchObject({ id: row.id, reply_to_message_id: 'parent', reply_to: { id: 'parent', body: 'Original parent', sender_name: 'Parent' } });
  expect(requests.filter(r => r.table === 'community_topic_messages').map(r => r.filters)).toEqual([
    [['topic_id', 'intro-topic'], ['id', [row.id]]], [['topic_id', 'intro-topic'], ['id', ['parent']]],
  ]);
});

it('an off-page blocked reply parent remains unavailable without hiding the child message', async () => {
  const child = { ...row, reply_to_message_id: 'parent' }, parent = { ...row, id: 'parent', body: 'BLOCKED_BODY', sender_id: 'blocked-peer' };
  execute.mockImplementation((r: Request) => ({ data: r.table === 'community_topic_messages'
    ? r.filters.some(([key, value]) => key === 'id' && (value as string[]).includes('parent')) ? [parent] : [child] : [], error: null }));
  blocked.mockResolvedValue(new Set(['blocked-peer']));
  const page = await community.getTopicMessages('intro-topic', undefined, scope(), { messageIds: [row.id], strictEnrichment: true, resolveReplyParents: true });
  expect(page.messages).toHaveLength(1);
  expect(page.messages[0]).toMatchObject({ id: row.id, reply_to_message_id: 'parent', reply_to: null });
  expect(JSON.stringify(page)).not.toContain('BLOCKED_BODY');
});

const selectedId='54000000-0000-4000-8000-000000000001';
const otherId='54000000-0000-4000-8000-000000000002';
function alexMention(id=selectedId) { return addChatMentionReference('Hi @Alex',null,id,'Alex',3); }
it('sends main mentions with the selected identity and confirms the exact saved body', async () => {
 const mentions=alexMention();
 execute.mockResolvedValueOnce({data:{...receipt,community_id:'community-a',sender_id:'account-a',kind:'message',image_url:null,body:'Hi @Alex',mention_data:mentions},error:null});
 await expect(community.sendCommunityMessage('community-a','Hi @Alex',undefined,'client-uuid',scope(),mentions)).resolves.toBeUndefined();
 expect(requests[0].payload).toMatchObject({body:'Hi @Alex',mention_data:mentions});
 expect(requests[0].columns).toBe('id, created_at, community_id, sender_id, body, kind, image_url, mention_data');
});
it('does not confirm a send from a same-name different-person receipt', async () => {
 execute.mockResolvedValue({data:{...receipt,community_id:'community-a',sender_id:'account-a',kind:'message',image_url:null,body:'Hi @Alex',mention_data:alexMention(otherId)},error:null});
 await expect(community.sendCommunityMessage('community-a','Hi @Alex',undefined,'client-uuid',scope(),alexMention())).rejects.toThrow('identity');
 expect(requests).toHaveLength(2);
 expect(requests[1].filters).toEqual([['id','client-uuid'],['community_id','community-a'],['sender_id','account-a']]);
});
it('can recover a lost main send response with the original mention identity', async () => {
 execute.mockResolvedValueOnce({data:null,error:Error('response lost')}).mockResolvedValueOnce({data:{...receipt,community_id:'community-a',sender_id:'account-a',kind:'message',image_url:null,body:'Hi @Alex',mention_data:alexMention()},error:null});
 await expect(community.sendCommunityMessage('community-a','Hi @Alex',undefined,'client-uuid',scope(),alexMention())).resolves.toBeUndefined();
 expect(requests[1].columns).toBe('id, created_at, community_id, sender_id, body, kind, image_url, mention_data');
});
it('clears explicit mention identity atomically when editing and checks the exact original revision', async () => {
 const original={id:'message-one',body:'Hi @Alex',edited_at:null,mentions:alexMention()};
 execute.mockResolvedValueOnce({data:{id:'message-one',body:'Hello everyone',mention_data:null},error:null});
 await expect(community.editCommunityMessage('message-one','Hello everyone',scope(),{communityId:'community-a',original,mentions:null})).resolves.toBeUndefined();
 expect(requests[0].payload).toMatchObject({body:'Hello everyone',mention_data:null});
 expect(requests[0].filters).toEqual([['id','message-one'],['community_id','community-a'],['sender_id','account-a'],['kind','message'],['body',original.body],['edited_at',null],['mention_data',JSON.stringify(original.mentions)]]);
});
it.each([null,{id:'message-one',body:'Hi @Alex',mention_data:alexMention(otherId)}])('keeps an edit unresolved when its guarded receipt differs: %j', async data => {
 execute.mockResolvedValueOnce({data,error:null});
 await expect(community.editCommunityMessage('message-one','Hi @Alex',scope(),{communityId:'community-a',original:{id:'message-one',body:'Before',edited_at:null},mentions:alexMention()})).rejects.toThrow('could not be confirmed');
 expect(requests[0].filters).toContainEqual(['mention_data',null]);
});
it('refuses invalid mention offsets before dispatch and preserves legacy sends separately', async () => {
 await expect(community.sendCommunityMessage('community-a','Changed label',undefined,'client-uuid',scope(),alexMention())).rejects.toThrow('mentions');
 expect(requests).toHaveLength(0);
});

it('confirms a lost reply response by original UUID, parent, sender, body and selected mention identity',async()=>{
 const body='Hi @Alex';const mentions=addChatMentionReference(body,null,'54000000-0000-4000-8000-000000000001','Alex',3);
 const saved={...receipt,id:'reply-id',body,sender_id:'account-a',broadcast_id:'parent-id',mention_data:mentions};
 execute.mockRejectedValueOnce(Error('response lost')).mockResolvedValueOnce({data:saved,error:null});
 await expect(community.sendBroadcastReply('parent-id',body,scope(),'reply-id',mentions)).resolves.toBeUndefined();
 expect(requests[0].payload).toEqual({id:'reply-id',broadcast_id:'parent-id',sender_id:'account-a',body,mention_data:mentions});
 expect(requests[1].filters).toEqual([['id','reply-id'],['broadcast_id','parent-id'],['sender_id','account-a']]);
 expect(requests.filter(r=>r.operation==='insert')).toHaveLength(1);
});
it.each(['id','body','sender_id','broadcast_id','mention_data'])('does not confirm a reply receipt with different %s',async(field)=>{
 const saved={...receipt,id:'reply-id',body:'Hello',sender_id:'account-a',broadcast_id:'parent-id',mention_data:null,[field]:field==='mention_data'?{version:1,text:'Hi @Alex',references:[] }:'other'};
 execute.mockResolvedValue({data:saved,error:null});
 await expect(community.sendBroadcastReply('parent-id','Hello',scope(),'reply-id',null)).rejects.toThrow('could not be confirmed');
});
it('does not look up a reply after the sending visit retires',async()=>{
 const sent=pending();execute.mockReturnValueOnce(sent.promise);const promise=community.sendBroadcastReply('parent-id','Hello',scope(),'reply-id',null);const rejection=expect(promise).rejects.toMatchObject(obsolete);
 await flush();epoch++;sent.resolve({data:null,error:Error('lost')});await rejection;expect(requests).toHaveLength(1);
});
it('rejects malformed reply identity before write and keeps historical reply metadata',async()=>{
 await expect(community.sendBroadcastReply('parent-id','Hello',scope(),'reply-id',{version:1,text:'Other',references:[]})).rejects.toThrow('mentions');expect(requests).toHaveLength(0);
 const body='Hi @Alex';const mentions=addChatMentionReference(body,null,'54000000-0000-4000-8000-000000000001','Alex',3);
 execute.mockResolvedValueOnce({data:[{...row,body,mention_data:mentions}],error:null}).mockResolvedValueOnce({data:[],error:null});
 expect((await community.getBroadcastReplies('parent-id',scope())).replies[0].mention_data).toEqual(mentions);
});


it('reply mentions derive eligible people from the readable parent community and exclude blocked people', async()=>{
 execute.mockImplementation((request:Request)=>({error:null,data:request.table==='community_broadcasts'?{id:'parent',community_id:'community-a',sender_id:'author'}:request.table==='community_members'?[{user_id:'alex-one'},{user_id:'alex-two'}]:request.table==='profiles_public'?[{id:'alex-one',first_name_display:'Alex'},{id:'alex-two',first_name_display:'Alex'}]:[]}));
 blocked.mockResolvedValue(new Set(['alex-one']));
 await expect(community.getBroadcastReplyMembers('parent',scope())).resolves.toEqual([{id:'alex-two',first_name:'Alex',avatar_url:null}]);
 expect(requests.find(r=>r.table==='community_members')?.filters).toEqual([['community_id','community-a'],['status','active']]);
});
it('reply tagging refuses an unreadable or blocked original author',async()=>{
 execute.mockResolvedValueOnce({data:null,error:null});
 await expect(community.getBroadcastReplyMembers('missing',scope())).rejects.toThrow('unavailable');
 expect(requests).toHaveLength(1);
 execute.mockImplementation((request:Request)=>({error:null,data:request.table==='community_broadcasts'?{id:'parent',community_id:'community-a',sender_id:'author'}:[]}));
 blocked.mockResolvedValue(new Set(['author']));
 await expect(community.getBroadcastReplyMembers('parent',scope())).rejects.toThrow('unavailable');
});
it('reply member lookup retires a pending parent read before querying its community',async()=>{
 const parent=pending();execute.mockReturnValueOnce(parent.promise);
 const read=community.getBroadcastReplyMembers('parent',scope());const rejection=expect(read).rejects.toMatchObject(obsolete);await flush();epoch++;
 parent.resolve({data:{id:'parent',community_id:'community-a',sender_id:'author'},error:null});await rejection;expect(requests).toHaveLength(1);
});


it('bounds a main-chat media insert and reconciles its original receipt', async () => {
  jest.useFakeTimers();
  try {
    const body = 'washedup-location:v1:{"latitude":34,"longitude":-118,"address":"Ocean Park"}';
    execute.mockReturnValueOnce(new Promise(() => {})).mockResolvedValueOnce({ data: { ...receipt, body, image_url: null }, error: null });
    const work = community.sendCommunityMessage('community-a', body, undefined, receipt.id, scope());
    await flush(); jest.advanceTimersByTime(12_001); await flush(); await work;
    expect(requests[1].filters).toEqual([['id', receipt.id], ['community_id', 'community-a'], ['sender_id', 'account-a']]);
  } finally { jest.useRealTimers(); }
});

it.each(['id', 'body', 'image_url'])('does not accept a different %s as confirmation of a main-chat photo', async field => {
  execute.mockResolvedValue({ data: { ...receipt, body: 'Caption', image_url: 'https://example.test/photo.jpg', [field]: 'different' }, error: null });
  await expect(community.sendCommunityMessage('community-a', 'Caption', 'https://example.test/photo.jpg', receipt.id, scope())).rejects.toThrow('saved message or mention identity differs');
});

it('bounds a stalled media receipt lookup without reporting delivery', async () => {
  jest.useFakeTimers();
  try {
    execute.mockResolvedValueOnce({ data: null, error: new Error('Lost response') }).mockReturnValueOnce(new Promise(() => {}));
    const work = community.sendCommunityMessage('community-a', 'Caption', 'https://example.test/photo.jpg', receipt.id, scope()).catch(error => error);
    await flush(); await flush(); expect(requests).toHaveLength(2); await jest.advanceTimersByTimeAsync(8_001); await flush();
    expect(await work).toBeInstanceOf(Error);
  } finally { jest.useRealTimers(); }
});

it('reply pagination keeps a raw cursor through a completely blocked page', async () => {
  const raw = Array.from({length:60},(_,i)=>({...row,id:`reply-${60-i}`,sender_id:'blocked-peer'}));
  execute.mockResolvedValueOnce({data:raw,error:null}); blocked.mockResolvedValueOnce(new Set(['blocked-peer']));
  const first=await community.getBroadcastReplies('parent',scope());
  expect(first.replies).toEqual([]); expect(first.hasMore).toBe(true);
  expect(first.olderCursor).toEqual({id:'reply-1',created_at:row.created_at});
  await community.getBroadcastReplies('parent',scope(),first.olderCursor!);
  expect(requests.filter(r=>r.table==='community_broadcast_replies')[1].or)
    .toBe(`created_at.lt.${row.created_at},and(created_at.eq.${row.created_at},id.lt.reply-1)`);
});


it('legacy topic join rejects mismatched auth even before the observer reports it', async () => {
 getUser.mockResolvedValueOnce(auth('account-b'));
 await expect(community.joinTopic('topic-a',scope())).rejects.toMatchObject(obsolete);
 expect(from).not.toHaveBeenCalled();
});
it('legacy topic join preserves the initiating user and exact topic upsert', async () => {
 await community.joinTopic('topic-a',scope());
 expect(requests).toHaveLength(1);expect(requests[0]).toMatchObject({table:'community_topic_members',operation:'upsert',payload:{topic_id:'topic-a',user_id:'account-a'},conflict:{onConflict:'topic_id,user_id'}});
});


it.each([[200, 400], [400, 200]])('overlaps a %i ms privacy check with %i ms enrichment after history, without early disclosure', async (privacyMs, metadataMs) => {
  jest.useFakeTimers();
  try {
    const hidden = { ...row, id: 'hidden', sender_id: 'blocked-peer' };
    const delayed = (value: unknown, ms: number) => new Promise(resolve => setTimeout(() => resolve(value), ms));
    blocked.mockImplementationOnce(() => delayed(new Set(['blocked-peer']), privacyMs) as Promise<Set<string>>);
    execute.mockImplementation((request: Request) => delayed({ data: request.table === 'community_broadcasts' ? [row, hidden]
      : request.table === 'profiles_public' ? [{ id: 'account-a', first_name_display: 'A' }]
      : request.table === 'community_broadcast_reactions' ? [{ broadcast_id: row.id, emoji: 'heart', user_id: 'account-a' }]
      : [{ broadcast_id: row.id }], error: null }, request.table === 'community_broadcasts' ? 100 : metadataMs));
    let page: community.CommunityBroadcastPage | undefined;
    const operation = community.getCommunityBroadcasts('community-a', undefined, scope(), { strictEnrichment: true }).then(result => { page = result; });
    await jest.advanceTimersByTimeAsync(499);
    expect(page).toBeUndefined();
    await jest.advanceTimersByTimeAsync(1);
    expect(page?.messages.map(message => message.id)).toEqual([row.id]);
    expect(page?.messages[0]).toMatchObject({ sender_name: 'A', reply_count: 1, reactions: [{ emoji: 'heart', count: 1, mine: true }] });
    expect(page?.olderCursor?.id).toBe(hidden.id);
    await operation;
  } finally { await jest.runAllTimersAsync(); jest.useRealTimers(); }
});

it('never returns messages when the account changes while privacy is pending after enrichment', async () => {
  const privacy = pending<Set<string>>();
  blocked.mockReturnValueOnce(privacy.promise);
  execute.mockImplementation((request: Request) => ({ data: request.table === 'community_broadcasts' ? [row] : [], error: null }));
  const owner = scope();
  const operation = community.getCommunityBroadcasts('community-a', undefined, owner);
  const assertion = expect(operation).rejects.toMatchObject(obsolete);
  await flush();
  expect(requests.map(request => request.table)).toContain('profiles_public');
  epoch++;
  privacy.resolve(new Set());
  await assertion;
});

it('keeps a fully blocked page empty even if speculative metadata fails', async () => {
  blocked.mockResolvedValueOnce(new Set(['account-a']));
  execute.mockImplementation((request: Request) => request.table === 'community_broadcasts'
    ? { data: [row], error: null } : Promise.reject(Error('Metadata unavailable')));
  const page = await community.getCommunityBroadcasts('community-a', undefined, scope(), { strictEnrichment: true });
  expect(page.messages).toEqual([]);
  expect(page.olderCursor).toEqual({ id: row.id, created_at: row.created_at });
  await flush();
});

it('does not start privacy or metadata reads for an empty history page', async () => {
  const page = await community.getCommunityBroadcasts('community-a', undefined, scope());
  expect(page).toEqual({ messages: [], hasMore: false, olderCursor: null });
  expect(blocked).not.toHaveBeenCalled();
  expect(requests.map(request => request.table)).toEqual(['community_broadcasts']);
});


it('handles an early metadata rejection while privacy is still pending', async () => {
  const privacy = pending<Set<string>>(), failure = Error('Metadata transport failed');
  blocked.mockReturnValueOnce(privacy.promise);
  execute.mockImplementation((request: Request) => request.table === 'community_broadcasts'
    ? { data: [row], error: null } : Promise.reject(failure));
  const operation = community.getCommunityBroadcasts('community-a', undefined, scope());
  const assertion = expect(operation).rejects.toBe(failure);
  await flush();
  expect(requests).toHaveLength(4);
  privacy.resolve(new Set());
  await assertion;
});

it('fails closed if the privacy transport rejects after metadata has completed', async () => {
  let rejectPrivacy!: (error: Error) => void;
  blocked.mockReturnValueOnce(new Promise<Set<string>>((_resolve, reject) => { rejectPrivacy = reject; }));
  execute.mockImplementation((request: Request) => ({ data: request.table === 'community_broadcasts' ? [row] : [], error: null }));
  const failure = Error('Privacy unavailable');
  const operation = community.getCommunityBroadcasts('community-a', undefined, scope());
  const assertion = expect(operation).rejects.toBe(failure);
  await flush();
  expect(requests).toHaveLength(4);
  rejectPrivacy(failure);
  await assertion;
});

it('returns a fully blocked page without waiting for stalled metadata', async () => {
  const metadata = pending();
  blocked.mockResolvedValueOnce(new Set(['account-a']));
  execute.mockImplementation((request: Request) => request.table === 'community_broadcasts'
    ? { data: [row], error: null } : metadata.promise);
  let result: community.CommunityBroadcastPage | undefined;
  const operation = community.getCommunityBroadcasts('community-a', undefined, scope(), { strictEnrichment: true }).then(page => { result = page; });
  await flush();
  expect(result?.messages).toEqual([]);
  await operation;
  epoch++;
  metadata.resolve({ data: [], error: null });
  await flush();
});


it('recovers a stalled reply insert using the same receipt after its phase deadline', async () => {
 jest.useFakeTimers(); const insert=pending();
 execute.mockReturnValueOnce(insert.promise).mockResolvedValueOnce({data:{...receipt,id:'reply-id',body:'Hello',sender_id:'account-a',broadcast_id:'parent-id'},error:null});
 const operation=community.sendBroadcastReply('parent-id','Hello',scope(),'reply-id').catch(error=>error);
 try {
  await jest.advanceTimersByTimeAsync(12_001);
  expect(requests).toHaveLength(2);
  expect(await operation).toBeUndefined();
  expect(requests[1].filters).toEqual([['id','reply-id'],['broadcast_id','parent-id'],['sender_id','account-a']]);
 } finally {insert.resolve({data:null,error:Error('Late response')});await operation;jest.useRealTimers();}
});

it('ends a stalled reply identity check without dispatching a write', async () => {
 jest.useFakeTimers();const identity=pending();getUser.mockReturnValueOnce(identity.promise);
 let finished=false;const operation=community.sendBroadcastReply('parent-id','Hello',scope(),'reply-id').catch(error=>{finished=true;return error;});
 try {
  await jest.advanceTimersByTimeAsync(8_001);expect(finished).toBe(true);
  expect(await operation).toMatchObject({name:'RequestDeadlineError'});expect(requests).toHaveLength(0);
 } finally {identity.resolve(auth());await operation;jest.useRealTimers();}
});


it.each(['id','community_id','sender_id','body','kind','image_url','mention_data'])('rejects a main text receipt with different %s', async field => {
 const saved={...receipt,community_id:'community-a',sender_id:'account-a',body:'Hello',kind:'message',image_url:null,mention_data:null,[field]:'wrong'};
 execute.mockResolvedValue({data:saved,error:null});
 await expect(community.sendCommunityMessage('community-a','Hello',undefined,receipt.id,scope())).rejects.toThrow();
 expect(requests.filter(request=>request.operation==='insert')).toHaveLength(1);
 expect(requests[1].filters).toEqual([['id',receipt.id],['community_id','community-a'],['sender_id','account-a']]);
});

it('bounds both reply write and receipt lookup without dispatching a second write', async () => {
 jest.useFakeTimers(); const insert = pending(), lookup = pending();
 execute.mockReturnValueOnce(insert.promise).mockReturnValueOnce(lookup.promise);
 let finished = false;
 const operation = community.sendBroadcastReply('parent-id', 'Hello', scope(), 'reply-id').catch(error => { finished = true; return error; });
 try {
  await jest.advanceTimersByTimeAsync(12_001);
  expect(finished).toBe(false); expect(requests).toHaveLength(2);
  await jest.advanceTimersByTimeAsync(8_000);
  expect(finished).toBe(true); expect(await operation).toMatchObject({ name: 'RequestDeadlineError' });
  expect(requests.filter(request => request.operation === 'insert')).toHaveLength(1);
 } finally {
  insert.resolve({ data: null, error: Error('Late insert') }); lookup.resolve({ data: null, error: null });
  await operation; jest.useRealTimers();
 }
});

it('publishes read-only text after privacy, before slow metadata, then returns complete details',async()=>{
 const privacy=pending<Set<string>>(),metadata=pending();blocked.mockReturnValueOnce(privacy.promise);
 execute.mockImplementation((r:Request)=>r.table==='community_broadcasts'?{data:[row,{...row,id:'blocked',sender_id:'blocked-person'}],error:null}:metadata.promise);
 const onBasicPage=jest.fn();const operation=community.getCommunityBroadcasts('community-a',undefined,scope(),{strictEnrichment:true,onBasicPage});
 await flush();expect(onBasicPage).not.toHaveBeenCalled();
 privacy.resolve(new Set(['blocked-person']));await flush();
 expect(onBasicPage).toHaveBeenCalledTimes(1);expect(onBasicPage.mock.calls[0][0].messages).toMatchObject([{id:row.id,metadata_pending:true,reactions:[],reply_count:0}]);
 metadata.resolve({data:[],error:null});const full=await operation;expect(full.messages).toHaveLength(1);expect(full.messages[0].metadata_pending).toBeUndefined();
});
it('publishes no early text when privacy fails or the account retires',async()=>{
 const privacy=pending<Set<string>>();blocked.mockReturnValueOnce(privacy.promise);execute.mockImplementation((r:Request)=>({data:r.table==='community_broadcasts'?[row]:[],error:null}));
 const onBasicPage=jest.fn();const operation=community.getCommunityBroadcasts('community-a',undefined,scope(),{onBasicPage});const failure=expect(operation).rejects.toMatchObject(obsolete);
 await flush();epoch++;privacy.resolve(new Set());await failure;expect(onBasicPage).not.toHaveBeenCalled();
});
it('does not promote missing metadata to confirmed empty reactions after early text',async()=>{
 execute.mockImplementation((r:Request)=>r.table==='community_broadcasts'?{data:[row],error:null}:{data:null,error:Error('Metadata failed')});
 const onBasicPage=jest.fn();await expect(community.getCommunityBroadcasts('community-a',undefined,scope(),{strictEnrichment:true,onBasicPage})).rejects.toThrow('Metadata failed');
 expect(onBasicPage.mock.calls[0][0].messages[0].metadata_pending).toBe(true);
});
