import React from 'react';
import { act, create } from 'react-test-renderer';
import { isObsoleteTopicOperation, isUnconfirmedTopicReaction, useTopicChat } from '../useTopicChat';
import type { TopicMessage } from '../../lib/communityChat';

const mockRead = jest.fn(), mockTransport = jest.fn(), mockProfile = jest.fn();
const mockInvalidate = jest.fn(), mockClient = { invalidateQueries: mockInvalidate };
const mockAuthRead = jest.fn(), mockUnsubscribe = jest.fn();
const mockListeners = new Set<(event: string, session: any) => void>();
const mockChannels: any[] = [];
jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => mockClient }));
jest.mock('../../lib/communityChat', () => ({ getTopicMessages: (...args: any[]) => mockRead(...args) }));
jest.mock('../../lib/blocking', () => ({ getBlockedWith: async () => new Set() }));
jest.mock('../../lib/contentFilter', () => ({ checkContent: () => ({ ok: true }) }));
jest.mock('../../lib/logger', () => ({ logError: jest.fn() }));
jest.mock('../../lib/supabase', () => ({ supabase: {
  auth: {
    getUser: () => mockAuthRead(),
    onAuthStateChange: (callback: any) => {
      mockListeners.add(callback);
      return { data: { subscription: { unsubscribe: () => { mockListeners.delete(callback); mockUnsubscribe(); } } } };
    },
  },
  from: (table: string) => {
    let operation = 'select', payload: unknown;
    const filters: Record<string, unknown> = {};
    const finish = () => table === 'profiles_public' ? mockProfile(filters.id) : mockTransport(table, operation, payload, filters);
    const chain: any = {
      select: () => chain,
      eq: (key: string, value: unknown) => { filters[key] = value; return chain; },
      is: (key: string, value: unknown) => { filters[key] = value; return chain; },
      insert: (value: unknown) => { operation = 'insert'; payload = value; return chain; },
      update: (value: unknown) => { operation = 'update'; payload = value; return chain; },
      delete: () => { operation = 'delete'; return chain; },
      single: finish, maybeSingle: finish, limit: finish,
      then: (resolve: any, reject: any) => Promise.resolve(finish()).then(resolve, reject),
    };
    return chain;
  },
  channel: (name: string) => {
    const callbacks: Record<string, any> = {};
    const channel: any = { name, callbacks, on: (_kind: string, filter: any, callback: any) => { callbacks[filter.table] = callback; return channel; }, subscribe: () => channel };
    mockChannels.push(channel); return channel;
  },
  removeChannel: jest.fn(),
} }));

function deferred<T = any>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function message(id: string, extra: Partial<TopicMessage> = {}): TopicMessage {
  return { id, body: `Body ${id}`, created_at: `2026-09-13T10:0${id === 'new' ? '2' : '1'}:00Z`,
    sender_id: 'alice', sender_name: 'Alice', sender_photo: null, image_url: null, reply_to_message_id: null,
    edited_at: null, reply_to: null, reactions: [], ...extra };
}
function page(rows: TopicMessage[]) { return { messages: rows, hasMore: false, olderCursor: null }; }
function identity(id: string | null) { return { data: { user: id ? { id } : null }, error: null }; }
function emit(id: string | null) { act(() => { mockListeners.forEach(listener => listener('SIGNED_IN', id ? { user: { id } } : null)); }); }
async function flush() { await act(async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); }); }
const cleanups: Array<() => void> = [];
function mount() {
  let chat!: ReturnType<typeof useTopicChat>, tree!: ReturnType<typeof create>, mounted = true;
  function Harness({ id }: { id: string }) { chat = useTopicChat(id); return null; }
  act(() => { tree = create(<Harness id="topic-a" />); });
  const unmount = () => { if (mounted) { act(() => tree.unmount()); mounted = false; } };
  cleanups.push(unmount);
  return { get chat() { return chat; }, navigate: (id: string) => act(() => tree.update(<Harness id={id} />)), unmount };
}
function start(work: () => Promise<void>) {
  let result!: Promise<unknown>;
  act(() => { result = work().then(() => undefined, error => error); });
  return result;
}
beforeEach(() => {
  jest.clearAllMocks(); mockListeners.clear(); mockChannels.splice(0);
  mockAuthRead.mockReset().mockResolvedValue(identity('alice'));
  mockRead.mockReset().mockResolvedValue(page([message('old')]));
  mockProfile.mockReset().mockImplementation((id: string) => Promise.resolve({ data: { first_name_display: id, profile_photo_url: `${id}.jpg` }, error: null }));
  mockTransport.mockReset().mockResolvedValue({ data: null, error: null });
});
afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); });

it.each(['edit', 'delete'] as const)('failed %s restores only its message change and keeps later incoming rows', async kind => {
  const fixture = mount(); await flush();
  const pending = deferred(); mockTransport.mockReturnValueOnce(pending.promise);
  const result = start(() => kind === 'edit' ? fixture.chat.editMessage('old', 'Edited') : fixture.chat.deleteMessage('old'));
  await flush();
  mockRead.mockResolvedValueOnce(page(kind === 'edit' ? [message('old'), message('new')] : [message('new')]));
  await act(async () => { await fixture.chat.refresh(true); });
  await act(async () => { pending.resolve({ error: new Error('Rejected') }); await result; });
  expect(fixture.chat.messages.map(row => row.id)).toEqual(['old', 'new']);
  expect(fixture.chat.messages[0].body).toBe('Body old');
});

it.each(['edit', 'delete'] as const)('a retired %s failure cannot restore an old A snapshot after A → B → A', async kind => {
  const fixture = mount(); await flush();
  const pending = deferred(); mockTransport.mockReturnValueOnce(pending.promise);
  const result = start(() => kind === 'edit' ? fixture.chat.editMessage('old', 'Edited') : fixture.chat.deleteMessage('old'));
  await flush(); fixture.navigate('topic-b'); await flush();
  mockRead.mockResolvedValueOnce(page([message('new')])); fixture.navigate('topic-a'); await flush();
  await act(async () => { pending.resolve({ error: new Error('Retired rejection') }); await result; });
  expect(fixture.chat.messages.map(row => row.id)).toEqual(['new']);
});

it('an older failed edit cannot undo a newer successful edit of the same row', async () => {
  const fixture = mount(); await flush();
  const pending = deferred(); mockTransport.mockReturnValueOnce(pending.promise);
  const old = start(() => fixture.chat.editMessage('old', 'First edit')); await flush();
  await act(async () => { await fixture.chat.editMessage('old', 'Second edit'); });
  await act(async () => { pending.resolve({ error: new Error('First rejected') }); await old; });
  expect(fixture.chat.messages[0].body).toBe('Second edit');
});

it('a retired send receipt cannot confirm the new visit’s pending row with the same client UUID', async () => {
  const fixture = mount(); await flush();
  const previous = deferred(), current = deferred(); mockTransport.mockReturnValueOnce(previous.promise).mockReturnValueOnce(current.promise);
  const first = start(() => fixture.chat.sendMessage('Old visit send', undefined, undefined, undefined, 'send-id')); await flush();
  fixture.navigate('topic-b'); await flush(); fixture.navigate('topic-a'); await flush();
  const second = start(() => fixture.chat.sendMessage('Current send', undefined, undefined, undefined, 'send-id')); await flush();
  await act(async () => { previous.resolve({ data: { id: 'send-id', created_at: '2026-09-13T11:00:00Z' }, error: null }); await first; });
  expect(fixture.chat.messages.find(row => row.id === 'send-id')).toMatchObject({ body: 'Current send', delivery_state: 'sending' });
  expect(mockInvalidate).not.toHaveBeenCalled();
  await act(async () => { current.resolve({ data: { ...message('send-id', { body: 'Current send' }), topic_id: 'topic-a', created_at: '2026-09-13T12:00:00Z' }, error: null }); await second; });
  expect(fixture.chat.messages.find(row => row.id === 'send-id')?.delivery_state).toBeUndefined();
});

it('retired reaction reads do not continue a write after changing rooms', async () => {
  const fixture = mount(); await flush();
  const read = deferred(); mockTransport.mockReturnValueOnce(read.promise);
  const result = start(() => fixture.chat.toggleReaction('old', '❤️')); await flush();
  fixture.navigate('topic-b'); await flush(); fixture.navigate('topic-a'); await flush();
  await act(async () => { read.resolve({ data: [], error: null }); await result; });
  expect(mockTransport).toHaveBeenCalledTimes(1);
  expect(fixture.chat.messages[0].reactions).toEqual([]);
});

it('an old reaction finalizer cannot release the next visit’s mutation lock', async () => {
  const fixture = mount(); await flush();
  const previous = deferred(), current = deferred(); mockTransport.mockReturnValueOnce(previous.promise).mockReturnValueOnce(current.promise);
  const old = start(() => fixture.chat.toggleReaction('old', '❤️')); await flush();
  fixture.navigate('topic-b'); await flush(); fixture.navigate('topic-a'); await flush();
  const next = start(() => fixture.chat.toggleReaction('old', '🔥')); await flush();
  expect(mockTransport).toHaveBeenCalledTimes(2);
  await act(async () => { previous.resolve({ error: new Error('Old read') }); await old; });
  await act(async () => { await fixture.chat.toggleReaction('old', '👍'); });
  expect(mockTransport).toHaveBeenCalledTimes(2);
  await act(async () => { current.resolve({ data: [], error: null }); await next; });
  expect(fixture.chat.messages[0].reactions).toEqual([{ user_id: 'alice', reaction: '🔥' }]);
});

it('reaction rollback preserves another member’s newer reaction', async () => {
  const fixture = mount(); await flush();
  const read = deferred(); mockTransport.mockReturnValueOnce(read.promise);
  const result = start(() => fixture.chat.toggleReaction('old', '❤️')); await flush();
  mockRead.mockResolvedValueOnce(page([message('old', { reactions: [{ user_id: 'bob', reaction: '🔥' }] })]));
  await act(async () => { await fixture.chat.refresh(true); });
  await act(async () => { read.resolve({ error: new Error('Rejected') }); await result; });
  expect(fixture.chat.messages[0].reactions).toEqual([{ user_id: 'bob', reaction: '🔥' }]);
});

it('observes sign-out and rejects retained callbacks before starting transport', async () => {
  const fixture = mount(); await flush();
  const old = fixture.chat; emit(null); await flush();
  expect(fixture.chat.currentUserId).toBeNull();
  expect(fixture.chat.messages).toEqual([]);
  await act(async () => {
    await Promise.allSettled([old.sendMessage('Retired'), old.editMessage('old', 'Retired'), old.deleteMessage('old'), old.toggleReaction('old', '❤️')]);
  });
  expect(mockTransport).not.toHaveBeenCalled();
});

it('account A → B → A retires pending work even when topic and final user IDs match', async () => {
  const fixture = mount(); await flush();
  const pending = deferred(); mockTransport.mockReturnValueOnce(pending.promise);
  const result = start(() => fixture.chat.editMessage('old', 'Old Alice edit')); await flush();
  emit('bob'); await flush(); expect(fixture.chat.currentUserId).toBe('bob');
  mockRead.mockResolvedValueOnce(page([message('new')])); emit('alice'); await flush();
  await act(async () => { pending.resolve({ error: new Error('Old Alice rejection') }); await result; });
  expect(fixture.chat.messages.map(row => row.id)).toEqual(['new']);
});

it('does not publish late account profile reads or accept an initial identity older than an auth event', async () => {
  const initial = deferred(), aliceProfile = deferred(); mockAuthRead.mockReturnValueOnce(initial.promise);
  mockProfile.mockImplementationOnce(() => aliceProfile.promise);
  const fixture = mount(); emit('alice'); await flush(); emit('bob'); await flush();
  await act(async () => { aliceProfile.resolve({ data: { first_name_display: 'Old Alice' }, error: null }); initial.resolve(identity('alice')); }); await flush();
  expect(fixture.chat.currentUserId).toBe('bob');
  expect(fixture.chat.currentUserName).toBe('bob');
});

it('retires pending reaction work and all retained mutation callbacks after unmount', async () => {
  const fixture = mount(); await flush();
  const read = deferred(); mockTransport.mockReturnValueOnce(read.promise);
  const old = fixture.chat, result = start(() => old.toggleReaction('old', '❤️')); await flush(); fixture.unmount();
  await act(async () => { read.resolve({ data: [], error: null }); await result; });
  await act(async () => { await Promise.allSettled([old.sendMessage('After unmount'), old.editMessage('old', 'After unmount'), old.deleteMessage('old')]); });
  expect(mockTransport).toHaveBeenCalledTimes(1);
  expect(mockInvalidate).not.toHaveBeenCalled();
  expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
});

it.each(['edit', 'delete'] as const)('a rejected %s promise uses a message-level rollback, too', async kind => {
  const fixture = mount(); await flush();
  const pending = deferred(); mockTransport.mockReturnValueOnce(pending.promise);
  const result = start(() => kind === 'edit' ? fixture.chat.editMessage('old', 'Edited') : fixture.chat.deleteMessage('old'));
  await flush(); mockRead.mockResolvedValueOnce(page(kind === 'edit' ? [message('old'), message('new')] : [message('new')]));
  await act(async () => { await fixture.chat.refresh(true); });
  await act(async () => { pending.reject(new Error('Network rejection')); await result; });
  expect(fixture.chat.messages.map(row => row.id)).toEqual(['old', 'new']);
  expect(fixture.chat.messages[0].body).toBe('Body old');
});

it.each(['send', 'edit', 'delete', 'reaction'] as const)('late successful %s rejects with the obsolete-operation contract after unmount', async kind => {
  const fixture = mount(); await flush();
  const pending = deferred();
  if (kind === 'reaction') mockTransport.mockResolvedValueOnce({ data: [], error: null });
  mockTransport.mockReturnValueOnce(pending.promise);
  const old = fixture.chat;
  const result = start(() => kind === 'send' ? old.sendMessage('Sending', undefined, undefined, undefined, 'send-id')
    : kind === 'edit' ? old.editMessage('old', 'Edited') : kind === 'delete' ? old.deleteMessage('old') : old.toggleReaction('old', '❤️'));
  await flush(); fixture.unmount();
  let outcome: unknown;
  await act(async () => { pending.resolve({ data: { id: 'send-id', created_at: '2026-09-13T11:00:00Z' }, error: null }); outcome = await result; });
  expect(isObsoleteTopicOperation(outcome)).toBe(true);
  expect(old.isCurrent()).toBe(false);
  expect(mockInvalidate).not.toHaveBeenCalled();
});

it('keeps the exact client UUID and original receipt lookup filters after a lost insert response', async () => {
  const fixture = mount(); await flush();
  mockTransport.mockResolvedValueOnce({ data: null, error: new Error('Response lost') })
    .mockResolvedValueOnce({ data: { id: 'exact-client-id', created_at: '2026-09-13T11:00:00Z', body: 'Photo caption', image_url: 'https://example.test/photo.jpg', location_lat: 34, location_lng: -118, reply_to_message_id: 'old' }, error: null });
  await act(async () => { await fixture.chat.sendMessage('  Photo caption  ', 'https://example.test/photo.jpg', 'old', { latitude: 34, longitude: -118 }, 'exact-client-id'); });
  expect(mockTransport.mock.calls).toEqual([
    ['community_topic_messages', 'insert', { id: 'exact-client-id', topic_id: 'topic-a', sender_id: 'alice', body: 'Photo caption', image_url: 'https://example.test/photo.jpg', reply_to_message_id: 'old', location_lat: 34, location_lng: -118 }, {}],
    ['community_topic_messages', 'select', undefined, { id: 'exact-client-id', topic_id: 'topic-a', sender_id: 'alice' }],
  ]);
  expect(fixture.chat.messages.find(row => row.id === 'exact-client-id')).toMatchObject({ body: 'Photo caption', delivery_state: undefined, reply_to_message_id: 'old' });
  expect(mockInvalidate.mock.calls).toEqual([[{ queryKey: ['community-chat-cards'] }], [{ queryKey: ['community-chat-rows'] }]]);
});

it('does not run a receipt lookup or remove a new account’s messages after an obsolete insert fails', async () => {
  const fixture = mount(); await flush();
  const pending = deferred(); mockTransport.mockReturnValueOnce(pending.promise);
  const result = start(() => fixture.chat.sendMessage('Sending', undefined, undefined, undefined, 'send-id')); await flush();
  mockRead.mockResolvedValueOnce(page([message('new', { sender_id: 'bob' })])); emit('bob'); await flush();
  let outcome: unknown;
  await act(async () => { pending.resolve({ error: new Error('Lost response') }); outcome = await result; });
  expect(isObsoleteTopicOperation(outcome)).toBe(true);
  expect(mockTransport).toHaveBeenCalledTimes(1);
  expect(fixture.chat.messages.map(row => row.id)).toEqual(['new']);
});

it('waits for known identity, exposes initial identity errors and retries through the existing refresh action', async () => {
  mockAuthRead.mockResolvedValueOnce({ data: { user: null }, error: new Error('Identity unavailable') });
  const fixture = mount(); await flush();
  expect(fixture.chat.currentUserId).toBeNull();
  expect(fixture.chat.loading).toBe(false);
  expect(fixture.chat.loadError).toBe(true);
  expect(mockRead).not.toHaveBeenCalled();
  expect(mockChannels).toHaveLength(0);
  await act(async () => { await fixture.chat.refresh(); }); await flush();
  expect(fixture.chat.currentUserId).toBe('alice');
  expect(fixture.chat.loadError).toBe(false);
  expect(fixture.chat.messages.map(row => row.id)).toEqual(['old']);
  expect(mockAuthRead).toHaveBeenCalledTimes(2);
});

it('retires account-scoped newest reads and reacts immediately before an auth event commits', async () => {
  const fixture = mount(); await flush();
  const pending = deferred(); mockRead.mockReturnValueOnce(pending.promise);
  const old = fixture.chat, result = start(() => old.refresh(true));
  let obsolete!: Promise<unknown>;
  act(() => {
    mockListeners.forEach(listener => listener('SIGNED_IN', { user: { id: 'bob' } }));
    obsolete = old.sendMessage('Old account callback').catch(error => error);
  }); await flush();
  expect(isObsoleteTopicOperation(await obsolete)).toBe(true);
  expect(mockTransport).not.toHaveBeenCalled();
  mockRead.mockResolvedValueOnce(page([message('new')])); emit('alice'); await flush();
  await act(async () => { pending.resolve(page([message('old', { body: 'Retired read' })])); await result; });
  expect(fixture.chat.messages.map(row => row.id)).toEqual(['new']);
  expect(old.isCurrent()).toBe(false);
});

it('shows a successful reaction update when the server has an own row missing from the local snapshot', async () => {
  const fixture = mount(); await flush();
  mockTransport.mockResolvedValueOnce({ data: [{ id: 'server-reaction', reaction: '🔥' }], error: null });
  await act(async () => { await fixture.chat.toggleReaction('old', '❤️'); });
  expect(mockTransport.mock.calls).toEqual([
    ['community_topic_message_reactions', 'select', undefined, { message_id: 'old', user_id: 'alice' }],
    ['community_topic_message_reactions', 'update', { reaction: '❤️' }, { id: 'server-reaction' }],
  ]);
  expect(fixture.chat.messages[0].reactions).toEqual([{ user_id: 'alice', reaction: '❤️' }]);
});

it('shows exactly one current own reaction after inserting a row absent from the server but present in the old snapshot', async () => {
  mockRead.mockResolvedValueOnce(page([message('old', { reactions: [{ user_id: 'alice', reaction: '🔥' }, { user_id: 'bob', reaction: '👍' }] })]));
  const fixture = mount(); await flush();
  mockTransport.mockResolvedValueOnce({ data: [], error: null });
  await act(async () => { await fixture.chat.toggleReaction('old', '❤️'); });
  expect(mockTransport.mock.calls[1]).toEqual(['community_topic_message_reactions', 'insert', { message_id: 'old', user_id: 'alice', reaction: '❤️' }, {}]);
  expect(fixture.chat.messages[0].reactions).toEqual([{ user_id: 'bob', reaction: '👍' }, { user_id: 'alice', reaction: '❤️' }]);
});

it('preserves another member’s queued update when applying its optimistic own reaction', async () => {
  const fixture = mount(); await flush();
  mockRead.mockResolvedValueOnce(page([message('old', { reactions: [{ user_id: 'bob', reaction: '🔥' }] })]));
  const pending = deferred(); mockTransport.mockReturnValueOnce(pending.promise);
  let work!: Promise<unknown>;
  await act(async () => {
    // Queue the fresh server state and the optimistic action in one batch, so
    // the latter must use updater-current reactions rather than messagesRef.
    await fixture.chat.refresh(true);
    work = fixture.chat.toggleReaction('old', '❤️').catch(error => error);
  });
  expect(fixture.chat.messages[0].reactions).toEqual([{ user_id: 'bob', reaction: '🔥' }, { user_id: 'alice', reaction: '❤️' }]);
  await act(async () => { pending.resolve({ data: [], error: null }); await work; });
  expect(fixture.chat.messages[0].reactions).toEqual([{ user_id: 'bob', reaction: '🔥' }, { user_id: 'alice', reaction: '❤️' }]);
});

it('retains the existing toggle-off rule when the server already stores the chosen reaction', async () => {
  mockRead.mockResolvedValueOnce(page([message('old', { reactions: [{ user_id: 'bob', reaction: '🔥' }] })]));
  const fixture = mount(); await flush();
  mockTransport.mockResolvedValueOnce({ data: [{ id: 'server-reaction', reaction: '❤️' }], error: null });
  await act(async () => { await fixture.chat.toggleReaction('old', '❤️'); });
  expect(mockTransport.mock.calls[1]).toEqual(['community_topic_message_reactions', 'delete', undefined, { id: 'server-reaction' }]);
  expect(fixture.chat.messages[0].reactions).toEqual([{ user_id: 'bob', reaction: '🔥' }]);
});
it('a restored reply outside the current history page loads its exact parent before sending', async () => {
  const fixture=mount();await flush();mockRead.mockResolvedValueOnce(page([message('older-parent')]));mockTransport.mockResolvedValue({data:{...message('fixed-reply',{body:'A restored reply',reply_to_message_id:'older-parent'}),topic_id:'topic-a',created_at:'2026-09-18T19:00:00Z'},error:null});
  await act(async()=>{await fixture.chat.sendMessage('A restored reply',undefined,'older-parent',undefined,'fixed-reply');});
  expect(mockRead.mock.calls.at(-1)[3]).toEqual({messageIds:['older-parent'],strictEnrichment:true});
  expect(mockTransport.mock.calls.find(call=>call[1]==='insert')?.[2]).toMatchObject({id:'fixed-reply',reply_to_message_id:'older-parent'});
});
it('an unavailable restored reply is not silently sent as a new unthreaded message', async () => {
  const fixture=mount();await flush();mockRead.mockResolvedValueOnce(page([]));
  await act(async()=>{await expect(fixture.chat.sendMessage('Reply',undefined,'missing-parent')).rejects.toThrow('original message');});
  expect(mockTransport.mock.calls.some(call=>call[1]==='insert')).toBe(false);
});

const selectedMention={version:1 as const,text:'@Alex',references:[{userId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',label:'Alex',start:0,end:5}]};
it('sends selected topic identities with body-bound exact receipts',async()=>{
 const f=mount();await flush();const pending=deferred();mockTransport.mockReturnValueOnce(pending.promise);
 const sending=start(()=>f.chat.sendMessage(' @Alex ',undefined,undefined,undefined,'mention-id',{...selectedMention,text:' @Alex ',references:[{...selectedMention.references[0],start:1,end:6}]}));await flush();
 expect(f.chat.messages.find(row=>row.id==='mention-id')?.mention_data).toEqual(selectedMention);
 expect(mockTransport.mock.calls[0][2]).toMatchObject({body:'@Alex',mention_data:selectedMention});
 await act(async()=>{pending.resolve({data:{topic_id:'topic-a',sender_id:'alice',id:'mention-id',body:'@Alex',created_at:'2026-09-13T11:00:00Z',mention_data:selectedMention},error:null});await sending;});
 expect(f.chat.messages.find(row=>row.id==='mention-id')).toMatchObject({mention_data:selectedMention,delivery_state:undefined});
});
it('refuses a same-body topic receipt for a different selected person',async()=>{
 const f=mount();await flush();mockTransport.mockResolvedValue({data:{topic_id:'topic-a',sender_id:'alice',id:'mention-id',body:'@Alex',created_at:'2026-09-13T11:00:00Z',mention_data:{...selectedMention,references:[{...selectedMention.references[0],userId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd'}]}},error:null});
 await act(async()=>{await expect(f.chat.sendMessage('@Alex',undefined,undefined,undefined,'mention-id',selectedMention)).rejects.toThrow('Delivery could not be confirmed');});
 expect(f.chat.messages.some(row=>row.id==='mention-id')).toBe(false);
});
it('edits identity atomically with exact room, original body, revision and identity guards',async()=>{
 const previous={...selectedMention,references:[{...selectedMention.references[0],userId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd'}]};
 mockRead.mockResolvedValue(page([message('old',{body:'@Alex',mention_data:previous})]));const f=mount();await flush();
 mockTransport.mockResolvedValue({data:{id:'old',body:'@Alex',mention_data:selectedMention},error:null});
 await act(async()=>{await f.chat.editMessage('old','@Alex',selectedMention,{id:'old',body:'@Alex',edited_at:null,mentions:previous});});
 expect(mockTransport.mock.calls[0]).toMatchObject(['community_topic_messages','update',{body:'@Alex',mention_data:selectedMention},{id:'old',sender_id:'alice',topic_id:'topic-a',body:'@Alex',edited_at:null,mention_data:JSON.stringify(previous)}]);
 expect(f.chat.messages[0].mention_data).toEqual(selectedMention);
});
it('restores previous topic identity when conditional edit finds no matching row',async()=>{
 mockRead.mockResolvedValue(page([message('old',{body:'@Alex',mention_data:selectedMention})]));const f=mount();await flush();
 await act(async()=>{await expect(f.chat.editMessage('old','Revised',null,{id:'old',body:'@Alex',edited_at:null,mentions:selectedMention})).rejects.toThrow('not been confirmed');});
 expect(f.chat.messages[0]).toMatchObject({body:'@Alex',mention_data:selectedMention});
});


it('recovers a stalled pin insert with an exact receipt and keeps one message on same-ID retry', async () => {
  jest.useFakeTimers();
  try {
    const fixture = mount(); await flush();
    const accepted = message('pin-id', { body: 'Ocean Park', location_lat: 34, location_lng: -118 });
    mockTransport.mockReturnValueOnce(new Promise(() => {})).mockResolvedValueOnce({ data: accepted, error: null });
    const result = start(() => fixture.chat.sendLocation(34, -118, 'Ocean Park', 'pin-id'));
    await flush();
    await act(async () => { jest.advanceTimersByTime(12_001); }); await flush(); await result;
    expect(fixture.chat.messages.filter(row => row.id === 'pin-id')).toHaveLength(1);
    mockTransport.mockResolvedValueOnce({ data: null, error: new Error('Duplicate') }).mockResolvedValueOnce({ data: accepted, error: null });
    await act(async () => { await fixture.chat.sendLocation(34, -118, 'Ocean Park', 'pin-id'); });
    expect(fixture.chat.messages.filter(row => row.id === 'pin-id')).toHaveLength(1);
    expect(mockTransport.mock.calls[1][3]).toEqual({ id: 'pin-id', topic_id: 'topic-a', sender_id: 'alice' });
  } finally { jest.useRealTimers(); }
});

it.each(['body', 'image_url', 'location_lat', 'location_lng', 'reply_to_message_id'])('refuses a media receipt with a different %s', async field => {
  const fixture = mount(); await flush();
  mockTransport.mockResolvedValue({ data: { ...message('pin-id', { body: 'Ocean Park', location_lat: 34, location_lng: -118 }), [field]: 'different' }, error: null });
  await act(async () => { await expect(fixture.chat.sendLocation(34, -118, 'Ocean Park', 'pin-id')).rejects.toThrow('could not be confirmed'); });
  expect(fixture.chat.messages.some(row => row.id === 'pin-id')).toBe(false);
});

it('a stalled pin lookup ends and a late retired attempt cannot confirm or remove a newer same-ID row', async () => {
  jest.useFakeTimers();
  try {
    const fixture = mount(); await flush();
    const late = deferred();
    mockTransport.mockResolvedValueOnce({ data: null, error: new Error('Lost') }).mockReturnValueOnce(late.promise);
    const first = start(() => fixture.chat.sendLocation(34, -118, 'Ocean Park', 'pin-id'));
    await flush(); await act(async () => { jest.advanceTimersByTime(8_001); }); await flush();
    expect(await first).toBeInstanceOf(Error);
    const accepted = message('pin-id', { body: 'Ocean Park', location_lat: 34, location_lng: -118 });
    mockTransport.mockResolvedValueOnce({ data: accepted, error: null });
    await act(async () => { await fixture.chat.sendLocation(34, -118, 'Ocean Park', 'pin-id'); });
    await act(async () => { late.resolve({ data: accepted, error: null }); });
    expect(fixture.chat.messages.filter(row => row.id === 'pin-id')).toHaveLength(1);
    expect(fixture.chat.messages.find(row => row.id === 'pin-id')?.delivery_state).toBeUndefined();
  } finally { jest.useRealTimers(); }
});

it('retiring a media attempt before its insert response prevents lookup and removes only its optimistic row', async () => {
  const fixture = mount(); await flush();
  const pending = deferred(); mockTransport.mockReturnValueOnce(pending.promise);
  let active = true;
  const result = start(() => fixture.chat.sendLocation(34, -118, 'Ocean Park', 'pin-id', { userId: 'alice', isCurrent: () => active }));
  await flush(); active = false;
  await act(async () => { pending.resolve({ data: null, error: new Error('Lost') }); await result; });
  expect(mockTransport).toHaveBeenCalledTimes(1);
  expect(fixture.chat.messages.map(row => row.id)).toEqual(['old']);
});


it('expires a stalled reaction read, releases its lock and never writes from its late result', async () => {
  jest.useFakeTimers();
  try {
    const fixture = mount(); await flush();
    const pending = deferred(); mockTransport.mockReturnValueOnce(pending.promise);
    const result = start(() => fixture.chat.toggleReaction('old', '❤️')); await flush();
    expect(fixture.chat.messages[0].reactions).toEqual([{ user_id: 'alice', reaction: '❤️' }]);
    let settled: unknown; void result.then(value => { settled = value; });
    await act(async () => { await jest.advanceTimersByTimeAsync(12_000); });
    expect(settled).toBeInstanceOf(Error);
    expect((settled as Error).message).toContain('took too long');
    expect(fixture.chat.messages[0].reactions).toEqual([]);
    await act(async () => { await fixture.chat.toggleReaction('old', '🔥'); });
    expect(fixture.chat.messages[0].reactions).toEqual([{ user_id: 'alice', reaction: '🔥' }]);
    const calls = mockTransport.mock.calls.length;
    await act(async () => { pending.resolve({ data: [{ id: 'late-row', reaction: '❤️' }], error: null }); });
    expect(mockTransport).toHaveBeenCalledTimes(calls);
    expect(fixture.chat.messages[0].reactions).toEqual([{ user_id: 'alice', reaction: '🔥' }]);
  } finally { jest.useRealTimers(); }
});

it('a timed-out retired reaction read cannot change the new account or unlock its pending action', async () => {
  jest.useFakeTimers();
  try {
    const fixture = mount(); await flush();
    const previous = deferred(), current = deferred();
    mockTransport.mockReturnValueOnce(previous.promise).mockReturnValueOnce(current.promise);
    const first = start(() => fixture.chat.toggleReaction('old', '❤️')); await flush();
    await act(async () => { await jest.advanceTimersByTimeAsync(1_000); });
    emit('bob'); await flush();
    const next = start(() => fixture.chat.toggleReaction('old', '🔥')); await flush();
    await act(async () => { await jest.advanceTimersByTimeAsync(11_000); });
    let firstResult: unknown; void first.then(value => { firstResult = value; }); await flush();
    expect(isObsoleteTopicOperation(firstResult)).toBe(true);
    await act(async () => { await fixture.chat.toggleReaction('old', '👍'); });
    expect(mockTransport).toHaveBeenCalledTimes(2);
    await act(async () => { current.resolve({ data: [], error: null }); await next; });
    await act(async () => previous.resolve({ data: [], error: null }));
    expect(fixture.chat.messages[0].reactions).toEqual([{ user_id: 'bob', reaction: '🔥' }]);
  } finally { jest.useRealTimers(); }
});

it('restored legacy edits use original room, body and revision guards without rewriting mention identity', async () => {
  const f = mount(); await flush();
  const original = { id: 'old', body: 'Original on restore', edited_at: '2026-09-26T12:00:00Z' };
  mockTransport.mockResolvedValueOnce({ data: { id: 'old', body: 'Legacy revision' }, error: null });
  await act(async () => { await f.chat.editMessage('old', 'Legacy revision', undefined, original); });
  expect(mockTransport.mock.calls[0][3]).toEqual({ id: 'old', sender_id: 'alice', topic_id: 'topic-a', body: original.body, edited_at: original.edited_at });
  expect(mockTransport.mock.calls[0][2]).not.toHaveProperty('mention_data');
  expect(f.chat.messages[0].body).toBe('Legacy revision');
});

it('a stalled restored legacy edit exits, does not retry its write and cannot replace a newer server row when it resolves', async () => {
  jest.useFakeTimers();
  try {
    const f = mount(); await flush();
    const pending = deferred(); mockTransport.mockReturnValueOnce(pending.promise);
    let outcome: unknown;
    const result = start(() => f.chat.editMessage('old', 'Legacy revision', undefined, { id: 'old', body: 'Body old', edited_at: null }));
    result.then(value => { outcome = value; }); await flush();
    await act(async () => { jest.advanceTimersByTime(12_000); }); await flush();
    expect(outcome).toBeInstanceOf(Error);
    expect((outcome as Error).message).toContain('took too long');
    expect(f.chat.messages[0].body).toBe('Body old');
    expect(mockTransport).toHaveBeenCalledTimes(1);
    mockRead.mockResolvedValueOnce(page([message('old', { body: 'Newer server revision', edited_at: '2026-09-27T12:00:00Z' })]));
    await act(async () => { await f.chat.refresh(true); });
    await act(async () => { pending.resolve({ data: { id: 'old', body: 'Legacy revision' }, error: null }); }); await flush();
    expect(f.chat.messages[0].body).toBe('Newer server revision');
    expect(mockTransport).toHaveBeenCalledTimes(1);
  } finally { jest.useRealTimers(); }
});

it('an unmatched restored legacy revision stays unconfirmed instead of claiming a successful edit', async () => {
  const f = mount(); await flush();
  mockTransport.mockResolvedValueOnce({ data: null, error: null });
  await act(async () => {
    await expect(f.chat.editMessage('old', 'Legacy revision', undefined, { id: 'old', body: 'Older body', edited_at: null }))
      .rejects.toThrow('not been confirmed');
  });
  expect(f.chat.messages[0].body).toBe('Body old');
  expect(mockTransport.mock.calls[0][3]).toMatchObject({ topic_id: 'topic-a', body: 'Older body', edited_at: null });
});


it.each(['insert', 'update', 'delete'] as const)('confirms a committed reaction %s after response loss without another write', async operation => {
  const before = operation === 'insert' ? [] : [{ user_id: 'alice', reaction: operation === 'delete' ? '❤️' : '🔥' }];
  mockRead.mockResolvedValueOnce(page([message('old', { reactions: before })]));
  const fixture = mount(); await flush();
  const serverBefore = operation === 'insert' ? [] : [{ id: 'reaction-id', reaction: before[0].reaction }];
  const serverAfter = operation === 'delete' ? [] : [{ id: 'reaction-id', reaction: '❤️' }];
  mockTransport.mockResolvedValueOnce({ data: serverBefore, error: null })
    .mockResolvedValueOnce({ data: null, error: new Error('Response lost after commit') })
    .mockResolvedValueOnce({ data: serverAfter, error: null });
  await act(async () => { await fixture.chat.toggleReaction('old', '❤️'); });
  expect(mockTransport.mock.calls.map(call => call[1])).toEqual(['select', operation, 'select']);
  expect(mockTransport.mock.calls[2][3]).toEqual({ message_id: 'old', user_id: 'alice' });
  expect(fixture.chat.messages[0].reactions).toEqual(operation === 'delete' ? [] : [{ user_id: 'alice', reaction: '❤️' }]);
});

it.each(['insert', 'delete'] as const)('an uncertain %s retry checks and confirms the original result without inverting it', async operation => {
  const before = operation === 'insert' ? [] : [{ user_id: 'alice', reaction: '❤️' }];
  mockRead.mockResolvedValueOnce(page([message('old', { reactions: before })]));
  const fixture = mount(); await flush();
  mockTransport.mockResolvedValueOnce({ data: operation === 'insert' ? [] : [{ id: 'reaction-id', reaction: '❤️' }], error: null })
    .mockResolvedValueOnce({ data: null, error: new Error('Response lost') })
    .mockResolvedValueOnce({ data: null, error: new Error('Receipt offline') });
  let result: unknown;
  await act(async () => { result = await fixture.chat.toggleReaction('old', '❤️').catch(error => error); }); await flush();
  expect(isUnconfirmedTopicReaction(result)).toBe(true);
  mockTransport.mockResolvedValueOnce({ data: operation === 'insert' ? [{ id: 'reaction-id', reaction: '❤️' }] : [], error: null });
  await act(async () => { await fixture.chat.toggleReaction('old', '❤️'); });
  expect(mockTransport.mock.calls.map(call => call[1])).toEqual(['select', operation, 'select', 'select']);
  expect(fixture.chat.messages[0].reactions).toEqual(operation === 'delete' ? [] : [{ user_id: 'alice', reaction: '❤️' }]);
});

it('an explicit retry reapplies an uncommitted desired change and a retained older retry cannot undo a newer choice', async () => {
  const fixture = mount(); await flush();
  mockTransport.mockResolvedValueOnce({ data: [], error: null })
    .mockResolvedValueOnce({ data: null, error: new Error('Write unknown') })
    .mockResolvedValueOnce({ data: [], error: null });
  let result: unknown;
  await act(async () => { result = await fixture.chat.toggleReaction('old', '❤️').catch(error => error); }); await flush();
  if (!isUnconfirmedTopicReaction(result)) throw Error('Expected uncertain reaction');
  const retryOriginal = result.retry;
  mockTransport.mockResolvedValueOnce({ data: [], error: null }).mockResolvedValueOnce({ data: null, error: null });
  await act(async () => { await retryOriginal(); });
  expect(mockTransport.mock.calls.map(call => call[1])).toEqual(['select', 'insert', 'select', 'select', 'insert']);
  mockTransport.mockResolvedValueOnce({ data: [{ id: 'reaction-id', reaction: '❤️' }], error: null });
  await act(async () => { await fixture.chat.toggleReaction('old', '🔥'); });
  const count = mockTransport.mock.calls.length;
  await act(async () => { await expect(retryOriginal()).rejects.toMatchObject({ name: 'ObsoleteTopicOperationError' }); });
  expect(mockTransport).toHaveBeenCalledTimes(count);
  expect(fixture.chat.messages[0].reactions).toEqual([{ user_id: 'alice', reaction: '🔥' }]);
});

it('a stalled reaction receipt releases its lock and its late result cannot replace a successful retry', async () => {
  jest.useFakeTimers();
  try {
    const fixture = mount(); await flush();
    const receipt = deferred();
    mockTransport.mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: null, error: new Error('Response lost') }).mockReturnValueOnce(receipt.promise);
    const first = start(() => fixture.chat.toggleReaction('old', '❤️')); await flush();
    await act(async () => { await jest.advanceTimersByTimeAsync(8_000); });
    const result = await first; expect(isUnconfirmedTopicReaction(result)).toBe(true);
    mockTransport.mockResolvedValueOnce({ data: [{ id: 'reaction-id', reaction: '❤️' }], error: null });
    await act(async () => { await fixture.chat.toggleReaction('old', '❤️'); });
    const count = mockTransport.mock.calls.length;
    await act(async () => { receipt.resolve({ data: [], error: null }); });
    expect(mockTransport).toHaveBeenCalledTimes(count);
    expect(fixture.chat.messages[0].reactions).toEqual([{ user_id: 'alice', reaction: '❤️' }]);
  } finally { jest.useRealTimers(); }
});

it.each(['room', 'account', 'unmount'] as const)('retires an uncertain reaction receipt after %s changes', async kind => {
  const fixture = mount(); await flush();
  const receipt = deferred();
  mockTransport.mockResolvedValueOnce({ data: [], error: null })
    .mockResolvedValueOnce({ data: null, error: new Error('Response lost') }).mockReturnValueOnce(receipt.promise);
  const first = start(() => fixture.chat.toggleReaction('old', '❤️')); await flush();
  if (kind === 'room') { fixture.navigate('topic-b'); await flush(); fixture.navigate('topic-a'); }
  else if (kind === 'account') { emit('bob'); await flush(); emit('alice'); }
  else fixture.unmount();
  await flush();
  const count = mockTransport.mock.calls.length;
  await act(async () => { receipt.resolve({ data: [{ id: 'reaction-id', reaction: '❤️' }], error: null }); });
  expect(isObsoleteTopicOperation(await first)).toBe(true);
  expect(mockTransport).toHaveBeenCalledTimes(count);
  if (kind !== 'unmount') expect(fixture.chat.messages[0].reactions).toEqual([]);
});


it.each(['room', 'account', 'unmount'] as const)('an uncertainty retry retained before %s retirement cannot dispatch a read or write', async kind => {
  const fixture = mount(); await flush();
  mockTransport.mockResolvedValueOnce({ data: [], error: null })
    .mockResolvedValueOnce({ data: null, error: new Error('Response lost') })
    .mockResolvedValueOnce({ data: null, error: new Error('Receipt lost') });
  let result: unknown;
  await act(async () => { result = await fixture.chat.toggleReaction('old', '❤️').catch(error => error); }); await flush();
  if (!isUnconfirmedTopicReaction(result)) throw Error('Expected uncertain reaction');
  const retryOriginal = result.retry;
  if (kind === 'room') { fixture.navigate('topic-b'); await flush(); fixture.navigate('topic-a'); }
  else if (kind === 'account') { emit('bob'); await flush(); emit('alice'); }
  else fixture.unmount();
  await flush(); const count = mockTransport.mock.calls.length;
  await act(async () => { await expect(retryOriginal()).rejects.toMatchObject({ name: 'ObsoleteTopicOperationError' }); });
  expect(mockTransport).toHaveBeenCalledTimes(count);
});

it('a late receipt cannot undo a different explicit choice or release its in-flight lock', async () => {
  jest.useFakeTimers();
  try {
    const fixture = mount(); await flush();
    const oldRead = deferred(), newRead = deferred();
    mockTransport.mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: null, error: new Error('Response lost') }).mockReturnValueOnce(oldRead.promise);
    const first = start(() => fixture.chat.toggleReaction('old', '❤️')); await flush();
    await act(async () => { await jest.advanceTimersByTimeAsync(8_000); });
    const uncertainty = await first; expect(isUnconfirmedTopicReaction(uncertainty)).toBe(true);
    mockTransport.mockReturnValueOnce(newRead.promise);
    const second = start(() => fixture.chat.toggleReaction('old', '🔥')); await flush();
    await act(async () => { oldRead.resolve({ data: [{ id: 'reaction-id', reaction: '❤️' }], error: null }); });
    await act(async () => { await fixture.chat.toggleReaction('old', '👍'); });
    expect(mockTransport).toHaveBeenCalledTimes(4);
    await act(async () => { newRead.resolve({ data: [{ id: 'reaction-id', reaction: '❤️' }], error: null }); await second; });
    expect(fixture.chat.messages[0].reactions).toEqual([{ user_id: 'alice', reaction: '🔥' }]);
    const count = mockTransport.mock.calls.length;
    if (!isUnconfirmedTopicReaction(uncertainty)) throw Error('Expected uncertain reaction');
    await act(async () => { await expect(uncertainty.retry()).rejects.toMatchObject({ name: 'ObsoleteTopicOperationError' }); });
    expect(mockTransport).toHaveBeenCalledTimes(count);
  } finally { jest.useRealTimers(); }
});


it('a different choice retires an old uncertainty retry even when the new preflight fails', async () => {
  const fixture = mount(); await flush();
  mockTransport.mockResolvedValueOnce({ data: [], error: null })
    .mockResolvedValueOnce({ data: null, error: new Error('Write unknown') })
    .mockResolvedValueOnce({ data: [], error: null });
  let old: unknown;
  await act(async () => { old = await fixture.chat.toggleReaction('old', '❤️').catch(error => error); });
  if (!isUnconfirmedTopicReaction(old)) throw Error('Expected uncertain reaction');
  const retryOriginal = old.retry;
  mockTransport.mockResolvedValueOnce({ data: null, error: new Error('New choice read failed') });
  await act(async () => { await expect(fixture.chat.toggleReaction('old', '🔥')).rejects.toThrow('New choice read failed'); });
  const count = mockTransport.mock.calls.length;
  await act(async () => { await expect(retryOriginal()).rejects.toMatchObject({ name: 'ObsoleteTopicOperationError' }); });
  expect(mockTransport).toHaveBeenCalledTimes(count);
});

it('bounds a stalled write, checks its desired receipt and ignores a later write acknowledgement', async () => {
  jest.useFakeTimers();
  try {
    const fixture = mount(); await flush();
    const write = deferred();
    mockTransport.mockResolvedValueOnce({ data: [], error: null }).mockReturnValueOnce(write.promise)
      .mockResolvedValueOnce({ data: [{ id: 'reaction-id', reaction: '❤️' }], error: null });
    const first = start(() => fixture.chat.toggleReaction('old', '❤️')); await flush();
    await act(async () => { await jest.advanceTimersByTimeAsync(11_999); });
    expect(mockTransport.mock.calls.map(call => call[1])).toEqual(['select', 'insert']);
    await act(async () => { await jest.advanceTimersByTimeAsync(1); await first; });
    expect(mockTransport.mock.calls.map(call => call[1])).toEqual(['select', 'insert', 'select']);
    mockTransport.mockResolvedValueOnce({ data: [{ id: 'reaction-id', reaction: '❤️' }], error: null });
    await act(async () => { await fixture.chat.toggleReaction('old', '🔥'); });
    const count = mockTransport.mock.calls.length;
    await act(async () => { write.resolve({ data: null, error: null }); });
    expect(mockTransport).toHaveBeenCalledTimes(count);
    expect(fixture.chat.messages[0].reactions).toEqual([{ user_id: 'alice', reaction: '🔥' }]);
  } finally { jest.useRealTimers(); }
});


it.each(['id', 'topic_id', 'sender_id', 'body', 'image_url', 'reply_to_message_id', 'location_lat', 'location_lng', 'mention_data'])('rejects a text acknowledgement with a different %s', async field => {
 const saved={id:'stable-text',topic_id:'topic-a',sender_id:'alice',body:'Original',created_at:'2026-10-06T12:00:00Z',image_url:null,reply_to_message_id:null,location_lat:null,location_lng:null,mention_data:null,[field]:'wrong'};
 mockTransport.mockResolvedValue({data:saved,error:null});const f=mount();await flush();
 await act(async()=>{await expect(f.chat.sendMessage('Original',undefined,undefined,undefined,'stable-text')).rejects.toThrow('Delivery could not be confirmed');});
 expect(mockTransport.mock.calls.filter(call=>call[1]==='insert')).toHaveLength(1);
 expect(f.chat.messages.some(row=>row.id==='stable-text')).toBe(false);
});

it.each([false, true])('bounds a stalled topic delete and respects account retirement (%s)', async retire => {
  jest.useFakeTimers();
  const deletion = deferred();
  let pending: Promise<unknown> | undefined;
  try {
    const fixture = mount(); await flush();
    mockTransport.mockReturnValueOnce(deletion.promise);
    let settled = false;
    pending = start(() => fixture.chat.deleteMessage('old')).then(value => {settled=true;return value;});
    await flush();
    if (retire) {emit('bob');await flush();}
    await act(async () => jest.advanceTimersByTime(12000)); await flush();
    expect(settled).toBe(true);
    expect(await pending).toMatchObject({name:retire ? 'ObsoleteTopicOperationError' : 'RequestDeadlineError'});
    if (!retire) expect(fixture.chat.messages.some(row => row.id === 'old')).toBe(true);
    expect(mockTransport).toHaveBeenCalledTimes(1);
    const before = fixture.chat.messages;
    await act(async () => deletion.resolve({error:null})); await flush();
    expect(fixture.chat.messages).toEqual(before);
  } finally {
    deletion.resolve({error:null}); await flush(); await pending;
    jest.useRealTimers();
  }
});
