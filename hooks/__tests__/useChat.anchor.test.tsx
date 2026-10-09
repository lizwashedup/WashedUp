import React from 'react';
import { act, create } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useChat, ChatMessage, ConversationKey } from '../useChat';
import { getMemberChatAnchorWindow, MemberChatMessageUnavailableError } from '../../lib/memberChatMessageAnchor';
jest.mock('../../lib/memberChatMessageAnchor', () => ({ ...jest.requireActual('../../lib/memberChatMessageAnchor'), getMemberChatAnchorWindow: jest.fn() }));
const readAnchor = jest.mocked(getMemberChatAnchorWindow);

jest.mock('../../lib/supabase', () => ({ supabase: {
  from: jest.fn(), channel: jest.fn(), removeChannel: jest.fn(),
  auth: { getUser: jest.fn(), getSession: jest.fn(), onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })) },
} }));
jest.mock('../../lib/logger', () => ({ logError: jest.fn() }));
jest.mock('../../lib/contentFilter', () => ({ checkContent: () => ({ ok: true }) }));

type ReadResult = { data: ChatMessage[] | null; error: Error | null };
const readMessages = jest.fn<Promise<ReadResult>, []>();
const readProfiles = jest.fn();
const readReactions = jest.fn();
const writeMessage = jest.fn();
const readReceipts = jest.fn();
const clearNotifications = jest.fn();
let blocked: string[];
let callbacks: Record<string, (payload: any) => void | Promise<void>>;
const cleanup: Array<() => void> = [];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
function message(n: number, extra: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: `message-${String(n).padStart(3, '0')}`, event_id: 'plan-a', user_id: 'other',
    content: `Message ${n}`, message_type: 'user',
    created_at: new Date(Date.UTC(2026, 8, 12, 12, n)).toISOString(), ...extra,
  };
}
const result = (...rows: ChatMessage[]): ReadResult => ({ data: rows, error: null });

function mount(key: ConversationKey = { kind: 'event', id: 'plan-a' }, initialAnchor: string | null = null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  let chat!: ReturnType<typeof useChat>;
  let renderer!: ReturnType<typeof create>;
  function Harness({ room, anchor }: { room: ConversationKey; anchor: string | null }) { chat = useChat(room, anchor); return null; }
  let currentRoom = key; let currentAnchor = initialAnchor;
  const tree = (room: ConversationKey) => <QueryClientProvider client={client}><Harness room={room} anchor={currentAnchor} /></QueryClientProvider>;
  act(() => { renderer = create(tree(key)); });
  cleanup.push(() => { act(() => renderer.unmount()); client.clear(); });
  return {
    client,
    get chat() { return chat; },
    navigate: (room: ConversationKey) => { currentRoom = room; act(() => renderer.update(tree(room))); },
    anchor: (anchor: string | null) => { currentAnchor = anchor; act(() => renderer.update(tree(currentRoom))); },
  };
}
async function flush() { await act(async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); }); }
async function emit(event: string, row: ChatMessage) {
  await act(async () => { await callbacks[event]({ [event === 'DELETE' ? 'old' : 'new']: row }); });
}

beforeEach(() => {
  jest.clearAllMocks();
  readMessages.mockReset(); readAnchor.mockReset();
  readProfiles.mockReset().mockResolvedValue({ data: [{ id: 'other', first_name_display: 'Alex', profile_photo_url: 'local-test-photo' }] });
  readReactions.mockReset().mockResolvedValue({ data: [], error: null });
  writeMessage.mockReset();
  blocked = [];
  callbacks = {};
  jest.mocked(supabase.auth.getUser).mockResolvedValue({ data: { user: { id: 'viewer' } }, error: null } as any);
  jest.mocked(supabase.from).mockImplementation((table: string) => {
    let insert = false;
    const chain: any = {};
    for (const method of ['select', 'eq', 'order', 'in', 'or']) chain[method] = jest.fn(() => chain);
    chain.insert = jest.fn(() => { insert = true; return chain; });
    chain.upsert = jest.fn((...args) => { readReceipts(...args); return chain; });
    chain.update = jest.fn((...args) => { clearNotifications(...args); return chain; });
    chain.limit = jest.fn(() => readMessages());
    chain.single = jest.fn(() => insert ? writeMessage() : Promise.resolve({ data: null, error: null }));
    chain.maybeSingle = jest.fn(async () => ({ data: table === 'profiles' ? { blocked_users: blocked } : null, error: null }));
    chain.then = (yes: any, no: any) => (table === 'profiles_public' ? readProfiles() : table === 'message_reactions' ? readReactions() : Promise.resolve({ data: [], error: null })).then(yes, no);
    return chain;
  });
  jest.mocked(supabase.channel).mockImplementation(() => {
    const channel: any = {
      on: jest.fn((kind, filter, callback) => { callbacks[kind === 'system' ? 'system' : filter.event] = callback; return channel; }),
      subscribe: jest.fn(() => channel),
    };
    return channel;
  });
});
afterEach(() => cleanup.splice(0).forEach(close => close()));


const anchorResult = (rows: ChatMessage[], upper: ChatMessage | null = null, older: ChatMessage | null = null) => ({
  messages: rows, hasMore: !!older, olderCursor: older, upperCursor: upper, blockedIds: {},
});
it.each(['event', 'circle'] as const)('opens and refreshes the exact %s window without marking newer messages read', async kind => {
  readAnchor.mockResolvedValue(anchorResult([message(2), message(3)], message(3)));
  const fixture = mount({ kind, id: 'plan-a' }, message(2).id); await flush();
  expect(fixture.chat.messages.map(row => row.id)).toEqual([message(2).id, message(3).id]);
  expect(fixture.chat.loading).toBe(false);
  expect(readMessages).not.toHaveBeenCalled(); expect(readReceipts).not.toHaveBeenCalled(); expect(clearNotifications).not.toHaveBeenCalled();
  await act(async () => { await callbacks.system({ status: 'ok', extension: 'postgres_changes' }); }); await flush();
  expect(readAnchor).toHaveBeenCalledTimes(2); expect(readMessages).not.toHaveBeenCalled();
  await emit('INSERT', message(99)); await flush();
  expect(fixture.chat.messages.map(row => row.id)).toEqual([message(2).id, message(3).id]);
});
it('Latest replaces history without reopening the room or retiring a send scope', async () => {
  readAnchor.mockResolvedValue(anchorResult([message(2)], message(3)));
  readMessages.mockResolvedValue(result(message(99)));
  const fixture = mount(undefined, message(2).id); await flush();
  const scope = fixture.chat.operationScope; const channels = jest.mocked(supabase.channel).mock.calls.length;
  fixture.anchor(null); await flush();
  expect(fixture.chat.operationScope).toBe(scope); expect(scope!.isCurrent()).toBe(true);
  expect(supabase.channel).toHaveBeenCalledTimes(channels);
  expect(fixture.chat.messages.map(row => row.id)).toEqual([message(99).id]);
  expect(readReceipts).toHaveBeenCalled();
  await act(async () => { await callbacks.system({ status: 'ok', extension: 'postgres_changes' }); }); await flush();
  expect(readAnchor).toHaveBeenCalledTimes(1); expect(readMessages).toHaveBeenCalledTimes(2);
});
it('a retired exact-message read cannot replace Latest, and an old newest read cannot replace a target', async () => {
  const old = deferred<any>(); readAnchor.mockReturnValueOnce(old.promise);
  readMessages.mockResolvedValue(result(message(99)));
  const fixture = mount(undefined, message(2).id); await flush();
  fixture.anchor(null); await flush();
  await act(async () => old.resolve(anchorResult([message(2)]))); await flush();
  expect(fixture.chat.messages.map(row => row.id)).toEqual([message(99).id]);
  const latest = deferred<ReadResult>(); readMessages.mockReturnValueOnce(latest.promise);
  act(() => { void fixture.chat.refetch(); });
  readAnchor.mockResolvedValue(anchorResult([message(3)])); fixture.anchor(message(3).id); await flush();
  await act(async () => latest.resolve(result(message(100)))); await flush();
  expect(fixture.chat.messages.map(row => row.id)).toEqual([message(3).id]);
});
it('failed targets are retryable; unavailable targets clear cached content without a false load error', async () => {
  readAnchor.mockRejectedValueOnce(Error('offline')).mockResolvedValueOnce(anchorResult([message(2)]))
    .mockRejectedValueOnce(new MemberChatMessageUnavailableError());
  const fixture = mount(undefined, message(2).id); await flush();
  expect(fixture.chat.loadError).toBe(true); expect(fixture.chat.anchorUnavailable).toBe(false);
  await act(async () => { await fixture.chat.refetch(); }); await flush();
  expect(fixture.chat.messages).toHaveLength(1); expect(fixture.chat.loadError).toBe(false);
  await act(async () => { await fixture.chat.refetch(true); }); await flush();
  expect(fixture.chat.anchorUnavailable).toBe(true); expect(fixture.chat.loadError).toBe(false); expect(fixture.chat.messages).toEqual([]);
});
it('a deleted anchor retires an already-running refresh', async () => {
  readAnchor.mockResolvedValueOnce(anchorResult([message(2)]));
  const fixture = mount(undefined, message(2).id); await flush();
  const pending = deferred<any>(); readAnchor.mockReturnValueOnce(pending.promise);
  act(() => { void fixture.chat.refetch(); });
  await emit('DELETE', message(2));
  await act(async () => pending.resolve(anchorResult([message(2)]))); await flush();
  expect(fixture.chat.messages).toEqual([]); expect(fixture.chat.anchorUnavailable).toBe(true); expect(fixture.chat.loading).toBe(false);
});
it('retired older pages cannot append into Latest or unlock its active page request', async () => {
  readAnchor.mockResolvedValue(anchorResult([message(60)], message(65), message(50)));
  const fixture = mount(undefined, message(60).id); await flush();
  const old = deferred<ReadResult>(); readMessages.mockReturnValueOnce(old.promise);
  act(() => { void fixture.chat.loadOlder(); });
  const latestRows = Array.from({ length: 60 }, (_, i) => message(140 + i));
  readMessages.mockResolvedValueOnce(result(...latestRows)); fixture.anchor(null); await flush();
  const currentPage = deferred<ReadResult>(); readMessages.mockReturnValueOnce(currentPage.promise);
  act(() => { void fixture.chat.loadOlder(); });
  const reads = readMessages.mock.calls.length;
  await act(async () => old.resolve(result(message(1)))); await flush();
  act(() => { void fixture.chat.loadOlder(); });
  expect(readMessages).toHaveBeenCalledTimes(reads); expect(fixture.chat.messages.some(row => row.id === message(1).id)).toBe(false);
  await act(async () => currentPage.resolve(result(message(139)))); await flush();
  expect(fixture.chat.messages[0].id).toBe(message(139).id);
});
it('a send can finish across the change from anchored history to Latest', async () => {
  readAnchor.mockResolvedValue(anchorResult([message(2)], message(3))); readMessages.mockResolvedValue(result(message(99)));
  const fixture = mount(undefined, message(2).id); await flush();
  const receipt = deferred<any>(); writeMessage.mockReturnValueOnce(receipt.promise);
  let sent!: Promise<boolean>; act(() => { sent = fixture.chat.sendMessage('Still here', undefined, undefined, 'send-id'); }); await flush();
  fixture.anchor(null); await flush();
  await act(async () => receipt.resolve({ data: { ...message(2), id: 'send-id', user_id: 'viewer', content: 'Still here', created_at: '2026-09-21T12:00:00Z' }, error: null }));
  await act(async () => expect(await sent).toBe(true)); await flush();
  expect(fixture.chat.messages.some(row => row.id === 'send-id' && row.content === 'Still here')).toBe(true);
});
it('new arrivals remain contiguous when the target window already reaches the latest message', async () => {
  readAnchor.mockResolvedValue(anchorResult([message(2)]));
  const fixture = mount(undefined, message(2).id); await flush();
  await emit('INSERT', message(3)); await flush();
  expect(fixture.chat.messages.map(row => row.id)).toEqual([message(2).id, message(3).id]);
});

it('retries a failed older hydration from the same cursor and retains completed older pages on refresh', async () => {
  readAnchor.mockResolvedValue(anchorResult([message(60)], message(65), message(50)));
  const fixture = mount(undefined, message(60).id); await flush();
  readMessages.mockResolvedValueOnce(result(message(40))).mockResolvedValueOnce(result(message(40)));
  readProfiles.mockRejectedValueOnce(Error('profile read failed'));
  await act(async () => { await fixture.chat.loadOlder(); }); await flush();
  expect(fixture.chat.olderLoadError).toBe(true);
  await act(async () => { await fixture.chat.loadOlder(true); }); await flush();
  expect(fixture.chat.messages[0].id).toBe(message(40).id);
  const messageChains = jest.mocked(supabase.from).mock.results.filter((_result, index) => jest.mocked(supabase.from).mock.calls[index][0] === 'messages').map(result => result.value as any);
  expect(messageChains[0].or.mock.calls).toEqual(messageChains[1].or.mock.calls);
  await act(async () => { await fixture.chat.refetch(true); }); await flush();
  expect(fixture.chat.messages[0].id).toBe(message(40).id);
  const reads=readMessages.mock.calls.length;
  await act(async () => { await fixture.chat.loadOlder(); });
  expect(readMessages).toHaveBeenCalledTimes(reads); // completed history stays complete
});

it.each([null, 'message-002'])('keeps message-array identity stable while the composer rerenders (%s)', async anchor => {
  readAnchor.mockResolvedValue(anchorResult([message(2)], message(3))); readMessages.mockResolvedValue(result(message(2)));
  const fixture = mount(undefined, anchor); await flush();
  const first = fixture.chat.messages;
  fixture.navigate({kind:'event',id:'plan-a'}); await flush();
  expect(fixture.chat.messages).toBe(first);
});
