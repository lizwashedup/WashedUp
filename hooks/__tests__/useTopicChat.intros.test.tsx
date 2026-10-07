import React from 'react';
import { act, create } from 'react-test-renderer';
import { useTopicChat } from '../useTopicChat';
import type { TopicMessage, TopicMessagePage } from '../../lib/communityChat';

const mockCore = jest.fn(), mockOlderBroadcasts = jest.fn();
jest.mock('../../lib/chatReactionReader',()=>({readLoadedTopicReactions:jest.fn().mockResolvedValue([])}));
jest.mock('../../lib/topicLoadedHistory',()=>({readLoadedTopicEdits:jest.fn().mockResolvedValue([])}));
const mockRead = jest.fn(), mockBlocked = jest.fn(), mockInsert = jest.fn();
const mockInvalidate = jest.fn();
const mockClient = { invalidateQueries: mockInvalidate };
const mockRemoveChannel = jest.fn();
const mockChannels: Array<{ name: string; callbacks: Record<string, (payload?: any) => void> }> = [];
jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => mockClient }));
jest.mock('../../lib/communityRoomHistory', () => ({ getCommunityRoomHistory: (...args: any[]) => mockCore(...args) }));
jest.mock('../../lib/communityChat', () => ({ getTopicMessages: (...args: any[]) => mockRead(...args), getCommunityBroadcasts:(...args:any[])=>mockOlderBroadcasts(...args) }));
jest.mock('../../lib/blocking', () => ({ getBlockedWith: (...args: any[]) => mockBlocked(...args) }));
jest.mock('../../lib/logger', () => ({ logError: jest.fn() }));
jest.mock('../../lib/contentFilter', () => ({ checkContent: () => ({ ok: true }) }));
jest.mock('../../lib/supabase', () => ({ supabase: {
  auth: {
    getUser: async () => ({ data: { user: { id: 'viewer' } }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: jest.fn() } } }),
  },
  from: (table: string) => {
    let inserting = false;
    const chain: any = {};
    for (const method of ['select', 'eq']) chain[method] = () => chain;
    chain.insert = () => { inserting = true; return chain; };
    chain.single = () => inserting ? mockInsert() : Promise.resolve({ data: null, error: null });
    chain.maybeSingle = async () => ({ data: table === 'profiles_public' ? { first_name_display: 'Alice', profile_photo_url: null } : null, error: null });
    return chain;
  },
  channel: (name: string) => {
    const callbacks: Record<string, (payload?: any) => void> = {};
    mockChannels.push({ name, callbacks });
    const channel: any = { on: (kind: string, filter: any, callback: any) => { callbacks[kind==='system'?'system':filter.table+(filter.event==='DELETE'?'_delete':'')] = callback; return channel; }, subscribe: () => channel };
    return channel;
  },
  removeChannel: (...args: any[]) => mockRemoveChannel(...args),
} }));

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function message(n: number, body = `Message ${n}`, extra: Partial<TopicMessage> = {}): TopicMessage {
  return {
    id: `message-${n}`, body, created_at: new Date(Date.UTC(2026, 8, 13, 12, n)).toISOString(),
    sender_id: 'other', sender_name: 'Alex', sender_photo: null, image_url: null,
    reply_to_message_id: null, edited_at: null, reply_to: null, reactions: [], ...extra,
  };
}
function page(rows: TopicMessage[], hasMore = false, cursor = rows[0]): TopicMessagePage {
  return { messages: rows, hasMore, olderCursor: cursor ? { id: cursor.id, created_at: cursor.created_at } : null };
}
const close: Array<() => void> = [];
function mount(initial: string | undefined = 'topic-a', context: any = { kind: 'intros', communityId: 'page-a' }) {
  let chat!: ReturnType<typeof useTopicChat>;
  let renderer!: ReturnType<typeof create>;
  let mounted = true;
  function Harness({ id }: { id: string | undefined }) { chat = useTopicChat(id, context); return null; }
  act(() => { renderer = create(<Harness id={initial} />); });
  const unmount = () => { if (mounted) { act(() => renderer.unmount()); mounted = false; } };
  close.push(unmount);
  return { get chat() { return chat; }, navigate: (id: string | undefined) => act(() => renderer.update(<Harness id={id} />)), unmount };
}
async function flush() { await act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); }); }
beforeEach(() => {
  jest.clearAllMocks(); mockCore.mockReset().mockResolvedValue(mixed([item('broadcast', 10), item('topic', 11)]));
  mockRead.mockReset().mockResolvedValue(page([message(10)], true));
  mockBlocked.mockReset().mockResolvedValue(new Set());
  mockInsert.mockReset(); mockChannels.splice(0);
  mockOlderBroadcasts.mockReset().mockResolvedValue({messages:[],hasMore:false,olderCursor:null});
});
afterEach(() => close.splice(0).forEach(fn => fn()));


function item(source: 'broadcast' | 'topic', n: number, body?: string): any {
  const data = message(n, body);
  return { source, key: `${source}:${data.id}`, message: source === 'topic' ? data : { ...data, kind: 'intro', reply_count: 0 } };
}
function mixed(items: any[], hasMore = false, cursor = items[0]): any {
  return { messages: [...items].reverse(), hasMore, olderCursor: cursor ? { source: cursor.source, id: cursor.message.id, created_at: cursor.message.created_at, communityId: 'page-a', role: 'intros' } : null };
}
it('reads mapped Intros through the source-aware reader without a legacy topic read', async () => {
  const fixture = mount(); await flush(); expect(mockRead).not.toHaveBeenCalled(); expect(mockCore).toHaveBeenCalled(); expect(fixture.chat.roomItems.map(row => row.key)).toEqual(['broadcast:message-10', 'topic:message-11']);
});
it('retains both source items when their original IDs are identical', async () => {
  mockCore.mockResolvedValue(mixed([item('broadcast', 10), item('topic', 10)])); const fixture = mount(); await flush(); expect(fixture.chat.roomItems.map(row => row.key)).toEqual(['broadcast:message-10', 'topic:message-10']);
});
it('waiting for mapping cannot read or send through a guessed legacy topic', async () => {
  const fixture = mount('topic-a', { kind: 'waiting' }); await flush(); expect(mockRead).not.toHaveBeenCalled(); expect(mockCore).not.toHaveBeenCalled(); expect(fixture.chat.loading).toBe(true);
  await expect(fixture.chat.sendMessage('hello')).rejects.toThrow('changed'); expect(mockInsert).not.toHaveBeenCalled();
});
it('mapping failure is a recoverable load error rather than an empty room', async () => {
  const fixture = mount('topic-a', { kind: 'waiting', error: true }); await flush(); expect(fixture.chat.loadError).toBe(true); expect(fixture.chat.loading).toBe(false); expect(fixture.chat.roomItems).toEqual([]);
});
it('replaces stale topic rows when a mixed newest page contains broadcasts only', async () => {
  const fixture = mount(); await flush(); mockCore.mockResolvedValue(mixed([item('broadcast', 9), item('broadcast', 12)], true)); await act(async () => fixture.chat.refresh(true));
  expect(fixture.chat.messages).toEqual([]); expect(fixture.chat.roomItems.map(row => row.key)).toEqual(['broadcast:message-9', 'broadcast:message-12']);
});
it('a fully filtered page advances the shared cursor and clears only its covered window', async () => {
  mockCore.mockResolvedValueOnce(mixed([item('broadcast', 10), item('topic', 11)], true)); const fixture = mount(); await flush();
  const filtered = mixed([], true, item('broadcast', 9)); mockCore.mockResolvedValueOnce(filtered); await act(async () => fixture.chat.refresh()); expect(fixture.chat.roomItems).toEqual([]); expect(fixture.chat.hasOlder).toBe(true);
  mockCore.mockResolvedValueOnce(mixed([item('topic', 8)])); await act(async () => fixture.chat.loadOlder()); expect(mockCore.mock.calls.at(-1)[3]).toEqual(filtered.olderCursor); expect(fixture.chat.roomItems.map(row => row.key)).toEqual(['topic:message-8']);
});
it('older source pages extend history without collapsing equal UUIDs', async () => {
  mockCore.mockResolvedValueOnce(mixed([item('topic', 10)], true)); const fixture = mount(); await flush(); mockCore.mockResolvedValueOnce(mixed([item('broadcast', 10), item('topic', 9)]));
  await act(async () => fixture.chat.loadOlder()); expect(fixture.chat.roomItems.map(row => row.key)).toEqual(['topic:message-9', 'broadcast:message-10', 'topic:message-10']);
});
it('a stale refresh cannot replace a newer broadcast snapshot', async () => {
  const fixture = mount(); await flush(); const old = deferred<any>(); mockCore.mockReturnValueOnce(old.promise).mockResolvedValueOnce(mixed([item('broadcast', 10, 'Current')])); let waiting!: Promise<void>;
  act(() => { waiting = fixture.chat.refresh(true); }); await act(async () => fixture.chat.refresh(true)); await act(async () => { old.resolve(mixed([item('broadcast', 10, 'Stale')])); await waiting; }); expect(fixture.chat.roomItems[0].message.body).toBe('Current');
});
it('a retired room read cannot repopulate the next visit', async () => {
  const old = deferred<any>(); mockCore.mockReturnValueOnce(old.promise); const fixture = mount(); await flush(); fixture.navigate('topic-b'); await flush();
  await act(async () => old.resolve(mixed([item('broadcast', 5, 'Retired')]))); expect(fixture.chat.roomItems.some(row => row.message.body === 'Retired')).toBe(false);
});
it('existing optimistic sends stay in the topic source beside the broadcast history', async () => {
  const receipt = deferred<any>(); mockInsert.mockReturnValueOnce(receipt.promise); const fixture = mount(); await flush(); let sending!: Promise<void>;
  act(() => { sending = fixture.chat.sendMessage('Hello', undefined, undefined, undefined, 'own-send'); }); await flush(); expect(fixture.chat.roomItems.some(row => row.source === 'topic' && row.message.id === 'own-send' && row.message.delivery_state === 'sending')).toBe(true);
  expect(fixture.chat.roomItems.some(row => row.source === 'broadcast')).toBe(true); await act(async () => { receipt.resolve({ data: { id: 'own-send', created_at: '2026-09-15T12:00:00Z' }, error: null }); await sending; });
  expect(fixture.chat.roomItems.find(row => row.key === 'topic:own-send')?.message).toMatchObject({ body: 'Hello', delivery_state: undefined });
});
it('broadcast changes use the existing coalesced realtime refresh queue', async () => {
  const fixture = mount(); await flush(); mockCore.mockResolvedValue(mixed([item('broadcast', 12)])); act(() => mockChannels.at(-1)?.callbacks.community_broadcasts()); await flush(); expect(fixture.chat.roomItems.map(row => row.key)).toEqual(['broadcast:message-12']);
});

it('an older response cannot resurrect either source inside a newer authoritative mixed window', async () => {
  mockCore.mockResolvedValueOnce(mixed([item('topic', 10)], true)); const fixture = mount(); await flush();
  const old = deferred<any>(); mockCore.mockReturnValueOnce(old.promise).mockResolvedValueOnce(mixed([item('broadcast', 8), item('topic', 11)], true)); let waiting!: Promise<void>;
  act(() => { waiting = fixture.chat.loadOlder(); }); await act(async () => fixture.chat.refresh(true));
  await act(async () => { old.resolve(mixed([item('broadcast', 9, 'Deleted'), item('topic', 9, 'Deleted')], true)); await waiting; });
  expect(fixture.chat.roomItems.some(row => row.message.body === 'Deleted')).toBe(false); expect(fixture.chat.roomItems.map(row => row.key)).toEqual(['broadcast:message-8', 'topic:message-11']);
});

it.each(['intros','topic'] as const)('releases a stalled %s refresh and preserves readable history',async kind=>{
 jest.useFakeTimers();const fixture=mount('topic-a',kind==='intros'?{kind:'intros',communityId:'page-a'}:null);try{
  await flush();const before=fixture.chat.messages;const reader=kind==='intros'?mockCore:mockRead;reader.mockReturnValueOnce(new Promise(()=>{}));
  let pending!:Promise<void>;act(()=>{pending=fixture.chat.refresh();});await flush();expect(fixture.chat.loading).toBe(true);
  await act(async()=>{await jest.advanceTimersByTimeAsync(12_000);});expect(fixture.chat.loading).toBe(false);expect(fixture.chat.loadError).toBe(true);expect(fixture.chat.messages).toEqual(before);await pending;
 }finally{fixture.unmount();jest.useRealTimers();}
});

it('refreshes an older mapped intro body, reactions and reply count without replacing mixed history', async()=>{
 mockCore.mockResolvedValue(mixed([item('broadcast',10),item('topic',11)],true));const fixture=mount();await flush();
 mockCore.mockResolvedValueOnce(mixed([item('broadcast',1)]));await act(async()=>fixture.chat.loadOlder());
 for(const [table,body,reactions,reply_count] of [
  ['community_broadcasts','Revised intro',[],0],
  ['community_broadcast_reactions','Revised intro',[{emoji:'❤️',count:1,mine:false}],0],
  ['community_broadcast_replies','Revised intro',[{emoji:'❤️',count:1,mine:false}],1],
  ['community_broadcast_reactions','Revised intro',[],1],
 ] as const){
  mockOlderBroadcasts.mockResolvedValueOnce({messages:[{...item('broadcast',1,body).message,reactions,reply_count}],hasMore:false,olderCursor:null});
  act(()=>mockChannels[0].callbacks[table]());await flush();
  expect(fixture.chat.roomItems[0].message).toMatchObject({body,reactions,reply_count});
  expect(fixture.chat.roomItems.map(row=>row.key)).toEqual(['broadcast:message-1','broadcast:message-10','topic:message-11']);
 }
 expect(mockOlderBroadcasts.mock.calls[0][3]).toEqual({messageIds:['message-1'],strictEnrichment:true,broadcastKind:'intro'});
 expect(mockOlderBroadcasts.mock.calls[0][2].userId).toBe('viewer');
});

it('mapped intros refresh batches older IDs and reconciles reconnect deletions atomically',async()=>{
 mockCore.mockResolvedValue(mixed([item('topic',200)],true));const fixture=mount();await flush();
 const older=Array.from({length:125},(_,i)=>item('broadcast',i+1));
 mockCore.mockResolvedValueOnce(mixed(older));await act(async()=>fixture.chat.loadOlder());
 mockOlderBroadcasts.mockImplementation((_page,_cursor,_scope,options)=>({messages:options.messageIds.filter((id:string)=>id!=='message-1').map((id:string)=>({...older.find(row=>row.message.id===id)!.message,body:'Refreshed'})),hasMore:false,olderCursor:null}));
 act(()=>mockChannels[0].callbacks.system({status:'ok',extension:'postgres_changes'}));await flush();
 expect(mockOlderBroadcasts).toHaveBeenCalledTimes(3);
 expect(mockOlderBroadcasts.mock.calls.map(call=>call[3].messageIds.length)).toEqual([60,60,5]);
 expect(fixture.chat.roomItems).toHaveLength(125);
 expect(fixture.chat.roomItems.some(row=>row.message.id==='message-1')).toBe(false);
 expect(fixture.chat.messages[0].body).toBe('Message 200');
});

it('mapped intro partial failure retains history, drains a queued refresh and retires late results',async()=>{
 mockCore.mockResolvedValue(mixed([item('topic',10)],true));const fixture=mount();await flush();
 mockCore.mockResolvedValueOnce(mixed([item('broadcast',1)]));await act(async()=>fixture.chat.loadOlder());
 const failure=deferred<any>();mockOlderBroadcasts.mockReturnValueOnce(failure.promise).mockResolvedValueOnce({messages:[item('broadcast',1,'Recovered').message],hasMore:false,olderCursor:null});
 act(()=>mockChannels[0].callbacks.community_broadcasts());await flush();act(()=>mockChannels[0].callbacks.community_broadcasts());
 await act(async()=>failure.reject(Error('Interrupted')));await flush();
 expect(fixture.chat.roomItems[0].message.body).toBe('Recovered');expect(mockOlderBroadcasts).toHaveBeenCalledTimes(2);
 const late=deferred<any>();mockOlderBroadcasts.mockReturnValueOnce(late.promise);act(()=>mockChannels[0].callbacks.community_broadcasts());await flush();
 fixture.navigate('topic-b');await flush();await act(async()=>late.resolve({messages:[item('broadcast',1,'Old account').message],hasMore:false,olderCursor:null}));
 expect(fixture.chat.roomItems.some(row=>row.message.body==='Old account')).toBe(false);
});

it('removes an older mapped intro from an ID-only delete and ignores the retired callback',async()=>{
 mockCore.mockResolvedValue(mixed([item('topic',10)],true));const fixture=mount();await flush();
 mockCore.mockResolvedValueOnce(mixed([item('broadcast',1)]));await act(async()=>fixture.chat.loadOlder());
 const deleted=mockChannels[0].callbacks.community_broadcasts_delete;
 act(()=>deleted({old:{id:'message-1'},eventType:'DELETE'}));await flush();
 expect(fixture.chat.roomItems.some(row=>row.key==='broadcast:message-1')).toBe(false);
 mockCore.mockResolvedValue(mixed([item('broadcast',1,'Different visit')]));fixture.navigate('topic-b');await flush();
 act(()=>deleted({old:{id:'message-1'},eventType:'DELETE'}));await flush();
 expect(fixture.chat.roomItems[0].message.body).toBe('Different visit');
});
