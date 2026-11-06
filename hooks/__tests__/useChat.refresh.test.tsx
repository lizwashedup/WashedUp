import React from 'react';
import { act, create } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useChat, ChatMessage, ConversationKey } from '../useChat';

let mockClosing=false;
jest.mock('../../lib/supabase', () => ({ supabase: {
  realtime: {isDisconnecting: () => mockClosing},
  from: jest.fn(), channel: jest.fn(), removeChannel: jest.fn(),
  auth: { getUser: jest.fn(), getSession: jest.fn(), onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })) },
} }));
jest.mock('../../lib/logger', () => ({ logError: jest.fn() }));
jest.mock('../../lib/contentFilter', () => ({ checkContent: () => ({ ok: true }) }));

type ReadResult = { data: ChatMessage[] | null; error: Error | null };
const readMessages = jest.fn<Promise<ReadResult>, []>();
const readProfiles = jest.fn();
const readBlocked = jest.fn();
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

function mount(key: ConversationKey = { kind: 'event', id: 'plan-a' }, canAcknowledge = () => true, rowVisible?: (id: string) => boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  let chat!: ReturnType<typeof useChat>;
  let renderer!: ReturnType<typeof create>;
  function Harness({ room }: { room: ConversationKey }) { chat = useChat(room, null, canAcknowledge, rowVisible); return null; }
  const tree = (room: ConversationKey) => <QueryClientProvider client={client}><Harness room={room} /></QueryClientProvider>;
  act(() => { renderer = create(tree(key)); });
  cleanup.push(() => { act(() => renderer.unmount()); client.clear(); });
  return {
    client,
    get chat() { return chat; },
    navigate: (room: ConversationKey) => act(() => renderer.update(tree(room))),
  };
}
async function flush() { await act(async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); }); }
async function emit(event: string, row: ChatMessage) {
  await act(async () => { await callbacks[event]({ [event === 'DELETE' ? 'old' : 'new']: row }); });
}

beforeEach(() => {
  mockClosing=false;
  jest.clearAllMocks();
  readMessages.mockReset();
  readProfiles.mockReset().mockResolvedValue({ data: [{ id: 'other', first_name_display: 'Alex', profile_photo_url: 'local-test-photo' }] });
  readReactions.mockReset().mockResolvedValue({ data: [], error: null });
  writeMessage.mockReset();
  blocked = [];
  readBlocked.mockReset().mockImplementation(async () => ({ data: { blocked_users: blocked }, error: null }));
  callbacks = {};
  jest.mocked(supabase.auth.getUser).mockResolvedValue({ data: { user: { id: 'viewer' } }, error: null } as any);
  jest.mocked(supabase.from).mockImplementation((table: string) => {
    let insert = false;
    const chain: any = {};
    for (const method of ['select', 'eq', 'lte', 'lt', 'gt', 'order', 'in', 'or', 'range']) chain[method] = jest.fn(() => chain);
    chain.insert = jest.fn(() => { insert = true; return chain; });
    chain.upsert = jest.fn((...args) => { readReceipts(...args); return chain; });
    chain.update = jest.fn((...args) => { if (table === 'app_notifications') clearNotifications(...args); return chain; });
    chain.limit = jest.fn(() => table === 'app_notifications' ? Promise.resolve({ data: [], error: null }) : readMessages());
    chain.single = jest.fn(() => insert ? writeMessage() : Promise.resolve({ data: null, error: null }));
    chain.maybeSingle = jest.fn(() => table === 'profiles' ? readBlocked() : Promise.resolve({ data: null, error: null }));
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

it.each(['event', 'circle'] as const)('retires every %s subscription across 40 visits and ignores callbacks from departed rooms', async kind => {
  readMessages.mockResolvedValue(result(message(1)));
  const fixture = mount({ kind, id: 'visit-0' }); await flush();
  const retired: Array<(payload: any) => void | Promise<void>> = [];
  for (let visit = 1; visit <= 40; visit++) {
    retired.push(callbacks.INSERT);
    fixture.navigate({ kind, id: `visit-${visit}` }); await flush();
    expect(supabase.removeChannel).toHaveBeenCalledTimes(visit);
    expect(fixture.chat.messages.map(row => row.id)).toEqual([message(1).id]);
    await act(async () => { await retired[visit - 1]({ new: message(visit + 10) }); });
    await flush();
    expect(fixture.chat.messages.map(row => row.id)).toEqual([message(1).id]);
  }
  cleanup.splice(0).forEach(close => close());
  expect(supabase.channel).toHaveBeenCalledTimes(41);
  expect(supabase.removeChannel).toHaveBeenCalledTimes(41);
  const readsBefore = readMessages.mock.calls.length;
  await act(async () => { for (const callback of retired) await callback({ new: message(99) }); });
  expect(readMessages).toHaveBeenCalledTimes(readsBefore);
});

it.each(['event', 'circle'] as const)('recovers a persisted %s message when PostgreSQL streaming becomes ready', async kind => {
  readMessages.mockResolvedValueOnce(result(message(1)));
  const fixture = mount({ kind, id: 'plan-a' });
  await flush();
  expect(fixture.chat.messages.map(row => row.id)).toEqual([message(1).id]);
  // No INSERT callback arrives for a message committed between channel join
  // acknowledgement and the later PostgreSQL subscription readiness signal.
  readMessages.mockResolvedValueOnce(result(message(1), message(2)));
  expect(callbacks.system).toBeDefined();
  await act(async () => { await callbacks.system({ status: 'ok', extension: 'postgres_changes', message: 'Subscribed to PostgreSQL' }); });
  await flush();
  expect(fixture.chat.loading).toBe(false);
  expect(fixture.chat.messages.map(row => row.id)).toEqual([message(1).id, message(2).id]);
});

it.each(['event', 'circle'] as const)('receives %s reaction additions, changes and removals without hiding messages', async kind => {
  readMessages.mockResolvedValue(result(message(1)));
  const fixture = mount({ kind, id: 'plan-a' }); await flush();
  for (const reaction of ['heart', '👍', null]) {
    readReactions.mockResolvedValue({ data: reaction ? [{ message_id: message(1).id, user_id: 'other', reaction }] : [], error: null });
    await act(async () => callbacks['*']({ eventType: reaction ? 'UPDATE' : 'DELETE', new: reaction ? { message_id: message(1).id } : {}, old: { id: 'reaction-id' } }));
    await flush();
    expect(fixture.chat.messages[0].reactions).toEqual(reaction ? [{ user_id: 'other', reaction }] : []);
    expect(fixture.chat.loading).toBe(false);
    expect(fixture.chat.messages[0].content).toBe('Message 1');
  }
});

it('coalesces reaction bursts, ignores other messages and retires departed-room reads', async () => {
  readMessages.mockResolvedValue(result(message(1)));
  const fixture = mount(); await flush();
  const oldReaction = callbacks['*'];
  const initialReads = readReactions.mock.calls.length;
  act(() => { void oldReaction({ eventType: 'INSERT', new: { message_id: 'another-room' } }); }); await flush();
  expect(readReactions).toHaveBeenCalledTimes(initialReads);
  const pending = deferred<any>(); readReactions.mockReturnValueOnce(pending.promise);
  act(() => { for (let i = 0; i < 20; i++) oldReaction({ eventType: 'INSERT', new: { message_id: message(1).id } }); }); await flush();
  expect(readReactions).toHaveBeenCalledTimes(initialReads + 1);
  fixture.navigate({ kind: 'circle', id: 'circle-b' }); await flush();
  const departedReads = readReactions.mock.calls.length;
  await act(async () => pending.resolve({ data: [{ message_id: message(1).id, user_id: 'other', reaction: 'heart' }], error: null })); await flush();
  act(() => { void oldReaction({ eventType: 'DELETE', old: { id: 'reaction-id' } }); }); await flush();
  expect(readReactions).toHaveBeenCalledTimes(departedReads);
  expect(fixture.chat.messages[0].reactions).toEqual([]);
});

it('subscribes to ID-only deletions without a parent filter', async () => {
  readMessages.mockResolvedValue(result(message(1)));
  const fixture = mount(); await flush();
  const registration = jest.mocked(supabase.channel).mock.results[0].value.on.mock.calls.find((args: any[]) => args[1].event === 'DELETE');
  expect(registration[1]).toEqual({ event: 'DELETE', schema: 'public', table: 'messages' });
  await act(async () => callbacks.DELETE({ old: { id: message(1).id } })); await flush();
  expect(fixture.chat.messages).toEqual([]);
});

it('drains a newer queued reaction after a partial long-history read fails', async () => {
  readMessages.mockResolvedValueOnce(result(...Array.from({ length: 60 }, (_, i) => message(i + 181))));
  const fixture = mount(); await flush();
  for (const first of [121, 61, 1]) {
    readMessages.mockResolvedValueOnce(result(...Array.from({ length: 60 }, (_, i) => message(i + first))));
    await act(async () => fixture.chat.loadOlder());
  }
  expect(fixture.chat.messages).toHaveLength(240);
  const failedPage = deferred<any>();
  const startReads = readReactions.mock.calls.length;
  const reaction = { message_id: message(1).id, user_id: 'other', reaction: 'heart' };
  readReactions.mockResolvedValueOnce({ data: [reaction], error: null })
    .mockReturnValueOnce(failedPage.promise)
    .mockResolvedValueOnce({ data: [reaction], error: null })
    .mockResolvedValueOnce({ data: [], error: null });
  act(() => { void callbacks['*']({ eventType: 'INSERT', new: { message_id: message(1).id } }); });
  await flush();
  expect(readReactions).toHaveBeenCalledTimes(startReads + 2);
  expect(fixture.chat.messages[0].reactions).toEqual([]);
  act(() => { void callbacks['*']({ eventType: 'UPDATE', new: { message_id: message(1).id } }); });
  await act(async () => failedPage.resolve({ data: null, error: Error('Temporary connection failure') }));
  await flush();
  expect(readReactions).toHaveBeenCalledTimes(startReads + 4);
  expect(fixture.chat.messages[0].reactions).toEqual([{ user_id: 'other', reaction: 'heart' }]);
});

it('removes an oldest message deleted while disconnected when the returned history is complete', async () => {
  readMessages.mockResolvedValueOnce(result(message(1), message(2)));
  const fixture = mount(); await flush();
  readMessages.mockResolvedValueOnce(result(message(2)));
  await act(async () => { await callbacks.system({ status: 'ok', extension: 'postgres_changes' }); }); await flush();
  expect(fixture.chat.messages.map(row => row.id)).toEqual([message(2).id]);
});

it('uses a later streaming-ready signal to recover a reconnect gap without discarding the chat', async () => {
  readMessages.mockResolvedValueOnce(result(message(1)));
  const fixture = mount(); await flush();
  readMessages.mockResolvedValueOnce(result(message(1), message(2)));
  expect(callbacks.system).toBeDefined();
  await act(async () => { await callbacks.system({ status: 'ok', extension: 'postgres_changes' }); });
  await flush();
  const pending = deferred<ReadResult>(); readMessages.mockReturnValueOnce(pending.promise);
  act(() => { void callbacks.system({ status: 'ok', extension: 'postgres_changes' }); });
  expect(fixture.chat.loading).toBe(false);
  expect(fixture.chat.messages.map(row => row.id)).toEqual([message(1).id, message(2).id]);
  await act(async () => { pending.resolve(result(message(1), message(2), message(3))); });
  await flush();
  expect(fixture.chat.messages.map(row => row.id)).toEqual([1, 2, 3].map(n => message(n).id));
});

it('ignores unrelated readiness payloads and late readiness from a departed room', async () => {
  readMessages.mockResolvedValue(result(message(1)));
  const fixture = mount(); await flush();
  const oldReady = callbacks.system;
  expect(oldReady).toBeDefined();
  const count = readMessages.mock.calls.length;
  for (const payload of [null, {}, { status: 'error', extension: 'postgres_changes' }, { status: 'ok', extension: 'broadcast' }]) {
    await act(async () => { await oldReady(payload); });
  }
  expect(readMessages).toHaveBeenCalledTimes(count);
  fixture.navigate({ kind: 'circle', id: 'circle-b' }); await flush();
  const afterNavigation = readMessages.mock.calls.length;
  await act(async () => { await oldReady({ status: 'ok', extension: 'postgres_changes' }); });
  expect(readMessages).toHaveBeenCalledTimes(afterNavigation);
});

it('adds messages missed while away without a loading flash or losing loaded older history', async () => {
  readMessages.mockResolvedValueOnce(result(...Array.from({ length: 60 }, (_, i) => message(i + 1))));
  const fixture = mount();
  await flush();
  readMessages.mockResolvedValueOnce(result(message(0)));
  await act(async () => { await fixture.chat.loadOlder(); });
  const pending = deferred<ReadResult>();
  readMessages.mockReturnValueOnce(pending.promise);
  let refresh!: Promise<void>;
  act(() => { refresh = fixture.chat.refetch(true); });
  expect(fixture.chat.loading).toBe(false);
  expect(fixture.chat.messages[0].id).toBe(message(0).id);
  await act(async () => { pending.resolve(result(...Array.from({ length: 60 }, (_, i) => message(i + 2)))); await refresh; });
  await flush();
  expect(fixture.chat.messages.map(row => row.id)).toEqual(Array.from({ length: 62 }, (_, i) => message(i).id));
  expect(fixture.chat.messages.at(-1)?.sender?.first_name).toBe('Alex');
  expect(readReceipts).toHaveBeenCalledTimes(2);
  expect(clearNotifications).toHaveBeenCalledTimes(2);
});

it('keeps late realtime inserts, edits and deletes when the return snapshot resolves', async () => {
  readMessages.mockResolvedValueOnce(result(message(1), message(2)));
  const fixture = mount();
  await flush();
  const pending = deferred<ReadResult>();
  readMessages.mockReturnValueOnce(pending.promise);
  let refresh!: Promise<void>;
  act(() => { refresh = fixture.chat.refetch(true); });
  await emit('INSERT', message(4));
  await emit('UPDATE', message(1, { content: 'Edited during refresh' }));
  await emit('DELETE', message(2));
  await act(async () => { pending.resolve(result(message(1), message(2), message(3))); await refresh; });
  await flush();
  expect(fixture.chat.messages.map(row => row.id)).toEqual([1, 3, 4].map(n => message(n).id));
  expect(fixture.chat.messages[0].content).toBe('Edited during refresh');
});

it('keeps sender presentation during return and does not let late hydration overwrite an edit', async () => {
  readMessages.mockResolvedValueOnce(result(message(1)));
  const fixture = mount();
  await flush();
  const profiles = deferred<any>();
  readProfiles.mockReturnValueOnce(profiles.promise);
  readMessages.mockResolvedValueOnce(result(message(1), message(2)));
  await act(async () => { await fixture.chat.refetch(true); });
  expect(fixture.chat.messages[0].sender?.first_name).toBe('Alex');
  expect(fixture.chat.messages.at(-1)?.id).toBe(message(2).id);
  await emit('UPDATE', message(2, { content: 'Edited after first paint' }));
  await act(async () => { profiles.resolve({ data: [] }); });
  await flush();
  expect(fixture.chat.messages.at(-1)?.content).toBe('Edited after first paint');
});

it('does not replace a newer refresh with an older response', async () => {
  readMessages.mockResolvedValueOnce(result(message(1)));
  const fixture = mount();
  await flush();
  const old = deferred<ReadResult>();
  readMessages.mockReturnValueOnce(old.promise).mockResolvedValueOnce(result(message(1), message(2), message(3)));
  let stale!: Promise<void>;
  act(() => { stale = fixture.chat.refetch(true); });
  await act(async () => { await fixture.chat.refetch(true); });
  await flush();
  await act(async () => { old.resolve(result(message(1), message(2))); await stale; });
  await flush();
  expect(fixture.chat.messages.map(row => row.id)).toEqual([1, 2, 3].map(n => message(n).id));
});

it('discards a late return read after navigating A → B → A', async () => {
  readMessages.mockResolvedValueOnce(result(message(1)));
  const fixture = mount();
  await flush();
  const old = deferred<ReadResult>();
  readMessages.mockReturnValueOnce(old.promise);
  let stale!: Promise<void>;
  act(() => { stale = fixture.chat.refetch(true); });
  readMessages.mockResolvedValueOnce(result(message(5, { event_id: null, circle_id: 'circle-b' })));
  fixture.navigate({ kind: 'circle', id: 'circle-b' });
  await flush();
  readMessages.mockResolvedValueOnce(result(message(1), message(3)));
  fixture.navigate({ kind: 'event', id: 'plan-a' });
  await flush();
  await act(async () => { old.resolve(result(message(1), message(2))); await stale; });
  await flush();
  expect(fixture.chat.messages.map(row => row.id)).toEqual([1, 3].map(n => message(n).id));
  expect(fixture.chat.messages.every(row => row.event_id === 'plan-a')).toBe(true);
});

it('removes a deletion missed while away only within the refreshed newest window', async () => {
  readMessages.mockResolvedValueOnce(result(...Array.from({ length: 60 }, (_, i) => message(i + 1))));
  const fixture = mount();
  await flush();
  readMessages.mockResolvedValueOnce(result(message(0)));
  await act(async () => { await fixture.chat.loadOlder(); });
  // A full 60-row page has an older window: message 60 was deleted and 61
  // arrived, while the previously loaded message 0 is outside this snapshot.
  readMessages.mockResolvedValueOnce(result(...Array.from({ length: 59 }, (_, i) => message(i + 1)), message(61)));
  await act(async () => { await fixture.chat.refetch(true); });
  await flush();
  expect(fixture.chat.messages.map(row => row.id)).toEqual([...Array.from({ length: 60 }, (_, i) => message(i).id), message(61).id]);
});

it('applies the current blocked list before showing refreshed or already loaded messages', async () => {
  readMessages.mockResolvedValueOnce(result(message(1), message(2, { user_id: 'allowed' })));
  const fixture = mount();
  await flush();
  blocked = ['other'];
  fixture.client.removeQueries({ queryKey: ['profile-blocked', 'viewer'] });
  readMessages.mockResolvedValueOnce(result(message(1), message(2, { user_id: 'allowed' }), message(3)));
  await act(async () => { await fixture.chat.refetch(true); });
  await flush();
  expect(fixture.chat.messages.map(row => row.id)).toEqual([message(2).id]);
});

it('retains readable history on a failed refresh and recovers on explicit retry', async () => {
  readMessages.mockResolvedValueOnce(result(message(1)));
  const fixture = mount();
  await flush();
  readMessages.mockResolvedValueOnce({ data: null, error: new Error('Offline') });
  await act(async () => { await fixture.chat.refetch(true); });
  expect(fixture.chat.loadError).toBe(true);
  expect(fixture.chat.messages.map(row => row.id)).toEqual([message(1).id]);
  readMessages.mockResolvedValueOnce(result(message(1), message(2)));
  await act(async () => { await fixture.chat.refetch(true); });
  await flush();
  expect(fixture.chat.loadError).toBe(false);
  expect(fixture.chat.messages.at(-1)?.id).toBe(message(2).id);
});

it('reconciles the exact optimistic UUID while retaining a different in-flight send', async () => {
  readMessages.mockResolvedValueOnce(result(message(1)));
  const fixture = mount();
  await flush();
  const first = deferred<any>();
  const second = deferred<any>();
  writeMessage.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  let sendFirst!: Promise<boolean>;
  let sendSecond!: Promise<boolean>;
  act(() => {
    sendFirst = fixture.chat.sendMessage('Same text', undefined, undefined, 'send-a');
    sendSecond = fixture.chat.sendMessage('Same text', undefined, undefined, 'send-b');
  });
  const confirmed = message(2, { id: 'send-a', user_id: 'viewer', content: 'Same text' });
  readMessages.mockResolvedValueOnce(result(message(1), confirmed));
  await act(async () => { await fixture.chat.refetch(true); });
  await flush();
  expect(fixture.chat.messages.map(row => row.id)).toEqual([message(1).id, 'send-a', 'optimistic-send-b']);
  await act(async () => {
    first.resolve({ data: confirmed, error: null });
    second.resolve({ data: message(3, { id: 'send-b', user_id: 'viewer', content: 'Same text' }), error: null });
    await Promise.all([sendFirst, sendSecond]);
  });
  expect(fixture.chat.messages.map(row => row.id)).toEqual([message(1).id, 'send-a', 'send-b']);
});

describe('room lifetime', () => {
  const circle = (n: number) => message(n, { id: `circle-message-${n}`, event_id: null, circle_id: 'circle-b' });
  const fullPage = (make: typeof message = message) => result(...Array.from({ length: 60 }, (_, i) => make(i + 1)));

  it.each([false, true])('ignores old INSERT hydration after navigation (return to A: %s)', async returnToA => {
    readMessages.mockResolvedValueOnce(result(message(1)));
    const fixture = mount();
    await flush();
    const oldProfiles = deferred<any>();
    readProfiles.mockReturnValueOnce(oldProfiles.promise);
    let insertion!: void | Promise<void>;
    act(() => { insertion = callbacks.INSERT({ new: message(2) }); });
    await flush();
    readMessages.mockResolvedValueOnce(result(circle(3)));
    fixture.navigate({ kind: 'circle', id: 'circle-b' });
    await flush();
    if (returnToA) {
      readMessages.mockResolvedValueOnce(result(message(1, { content: 'Current room lifetime' })));
      fixture.navigate({ kind: 'event', id: 'plan-a' });
      await flush();
    }
    await act(async () => { oldProfiles.resolve({ data: [] }); await insertion; });
    expect(fixture.chat.messages.map(row => row.id)).toEqual([returnToA ? message(1).id : circle(3).id]);
    expect(fixture.chat.messages.every(row => returnToA ? row.event_id === 'plan-a' : row.circle_id === 'circle-b')).toBe(true);
  });

  it.each(['INSERT', 'UPDATE', 'DELETE'])('ignores a retired %s subscription after returning to the same room', async event => {
    readMessages.mockResolvedValueOnce(result(message(1)));
    const fixture = mount();
    await flush();
    const retired = callbacks[event];
    readMessages.mockResolvedValueOnce(result(circle(3)));
    fixture.navigate({ kind: 'circle', id: 'circle-b' });
    await flush();
    readMessages.mockResolvedValueOnce(result(message(1, { content: 'Current room lifetime' })));
    fixture.navigate({ kind: 'event', id: 'plan-a' });
    await flush();
    const profileReads = readProfiles.mock.calls.length;
    await act(async () => {
      await retired({ [event === 'DELETE' ? 'old' : 'new']: message(event === 'INSERT' ? 2 : 1) });
    });
    expect(fixture.chat.messages.map(row => [row.id, row.content])).toEqual([[message(1).id, 'Current room lifetime']]);
    expect(readProfiles).toHaveBeenCalledTimes(profileReads);
  });

  it.each([
    ['message read', false], ['message read', true], ['sender hydration', false], ['sender hydration', true],
  ] as const)('ignores older history pending at %s (return to A: %s)', async (phase, returnToA) => {
    readMessages.mockResolvedValueOnce(fullPage());
    const fixture = mount();
    await flush();
    const oldRead = deferred<ReadResult>();
    const oldProfiles = deferred<any>();
    if (phase === 'message read') readMessages.mockReturnValueOnce(oldRead.promise);
    else {
      readMessages.mockResolvedValueOnce(result(message(0)));
      readProfiles.mockReturnValueOnce(oldProfiles.promise);
    }
    let older!: Promise<void>;
    act(() => { older = fixture.chat.loadOlder(); });
    await flush();
    readMessages.mockResolvedValueOnce(result(circle(61)));
    fixture.navigate({ kind: 'circle', id: 'circle-b' });
    await flush();
    if (returnToA) {
      readMessages.mockResolvedValueOnce(result(message(61)));
      fixture.navigate({ kind: 'event', id: 'plan-a' });
      await flush();
    }
    await act(async () => {
      oldRead.resolve(result(message(0)));
      oldProfiles.resolve({ data: [] });
      await older;
    });
    expect(fixture.chat.messages.map(row => row.id)).toEqual([returnToA ? message(61).id : circle(61).id]);
    expect(fixture.chat.messages.every(row => returnToA ? row.event_id === 'plan-a' : row.circle_id === 'circle-b')).toBe(true);
    expect(fixture.chat.olderLoadError).toBe(false);
  });

  it('lets the current room page while an old read is pending, without the old completion releasing its lock', async () => {
    readMessages.mockResolvedValueOnce(fullPage());
    const fixture = mount();
    await flush();
    const oldRead = deferred<ReadResult>();
    readMessages.mockReturnValueOnce(oldRead.promise);
    let oldOlder!: Promise<void>;
    act(() => { oldOlder = fixture.chat.loadOlder(); });
    readMessages.mockResolvedValueOnce(fullPage(circle));
    fixture.navigate({ kind: 'circle', id: 'circle-b' });
    await flush();
    const currentRead = deferred<ReadResult>();
    readMessages.mockReturnValueOnce(currentRead.promise);
    let currentOlder!: Promise<void>;
    act(() => { currentOlder = fixture.chat.loadOlder(); });
    expect(readMessages).toHaveBeenCalledTimes(4);
    await act(async () => { oldRead.resolve(result(message(0))); await oldOlder; });
    await act(async () => { await fixture.chat.loadOlder(); });
    expect(readMessages).toHaveBeenCalledTimes(4);
    await act(async () => { currentRead.resolve(result(circle(0))); await currentOlder; });
    expect(fixture.chat.messages.map(row => row.id)).toEqual(Array.from({ length: 61 }, (_, i) => circle(i).id));
    expect(fixture.chat.messages.every(row => row.circle_id === 'circle-b')).toBe(true);
  });

  it('does not show an old paging error or accept an old load callback after A → B → A', async () => {
    readMessages.mockResolvedValueOnce(fullPage());
    const fixture = mount();
    await flush();
    const retiredLoad = fixture.chat.loadOlder;
    const oldRead = deferred<ReadResult>();
    readMessages.mockReturnValueOnce(oldRead.promise);
    let oldOlder!: Promise<void>;
    act(() => { oldOlder = retiredLoad(); });
    readMessages.mockResolvedValueOnce(result(circle(61)));
    fixture.navigate({ kind: 'circle', id: 'circle-b' });
    await flush();
    readMessages.mockResolvedValueOnce(fullPage());
    fixture.navigate({ kind: 'event', id: 'plan-a' });
    await flush();
    await act(async () => { oldRead.resolve({ data: null, error: new Error('Old room offline') }); await oldOlder; });
    expect(fixture.chat.olderLoadError).toBe(false);
    await act(async () => { await retiredLoad(); });
    expect(readMessages).toHaveBeenCalledTimes(4);
  });
});

it('does not lose an arriving reaction when initial sender hydration finishes during its read', async () => {
  const profiles = deferred<any>(), reactions = deferred<any>();
  readMessages.mockResolvedValue(result(message(1)));
  readProfiles.mockReturnValueOnce(profiles.promise);
  const fixture = mount(); await flush();
  readReactions.mockReturnValueOnce(reactions.promise);
  act(() => { void callbacks['*']({ eventType: 'INSERT', new: { message_id: message(1).id } }); }); await flush();
  await act(async () => profiles.resolve({ data: [{ id: 'other', first_name_display: 'Jamie' }], error: null })); await flush();
  await act(async () => reactions.resolve({ data: [{ message_id: message(1).id, user_id: 'other', reaction: 'heart' }], error: null })); await flush();
  expect(fixture.chat.messages[0].reactions).toEqual([{ user_id: 'other', reaction: 'heart' }]);
  expect(fixture.chat.messages[0].sender?.first_name).toBe('Jamie');
});


it.each(['event', 'circle'] as const)('starts the %s privacy gate while history is in flight, but never paints before it resolves', async kind => {
  const history = deferred<ReadResult>();
  const privacy = deferred<any>();
  readMessages.mockReturnValueOnce(history.promise);
  readBlocked.mockReturnValueOnce(privacy.promise);
  const fixture = mount({ kind, id: 'plan-a' });
  await flush();
  expect(readMessages).toHaveBeenCalledTimes(1);
  expect(readBlocked).toHaveBeenCalledTimes(1);
  expect(fixture.chat.messages).toEqual([]);
  await act(async () => history.resolve(result(message(1), message(2, { user_id: 'allowed' }))));
  await flush();
  expect(fixture.chat.messages).toEqual([]);
  expect(fixture.chat.loading).toBe(true);
  await act(async () => privacy.resolve({ data: { blocked_users: ['other'] }, error: null }));
  await flush();
  expect(fixture.chat.messages.map(row => row.id)).toEqual([message(2).id]);
  expect(fixture.chat.loading).toBe(false);
});

it.each(['event', 'circle'] as const)('renders %s history after its required reads without waiting for five-second profile enrichment', async kind => {
  jest.useFakeTimers();
  try {
    readMessages.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve(result(message(1))), 200)));
    readBlocked.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve({ data: { blocked_users: [] }, error: null }), 100)));
    readProfiles.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve({ data: [{ id: 'other', first_name_display: 'Alex' }], error: null }), 5000)));
    const fixture = mount({ kind, id: 'plan-a' }); await flush();
    await act(async () => { await jest.advanceTimersByTimeAsync(199); }); await flush();
    expect(fixture.chat.loading).toBe(true);
    await act(async () => { await jest.advanceTimersByTimeAsync(1); }); await flush();
    expect(fixture.chat.loading).toBe(false);
    expect(fixture.chat.messages.map(row => row.content)).toEqual(['Message 1']);
    expect(fixture.chat.messages[0].sender).toBeFalsy();
    await act(async () => { await jest.advanceTimersByTimeAsync(5000); }); await flush();
    expect(fixture.chat.messages[0].sender?.first_name).toBe('Alex');
  } finally {
    cleanup.splice(0).forEach(close => close());
    jest.clearAllTimers(); jest.useRealTimers();
  }
});

it('shows a pending text bubble through a three-second acknowledgement and keeps one confirmed copy', async () => {
  jest.useFakeTimers();
  try {
    readMessages.mockResolvedValue(result(message(1)));
    const fixture = mount(); await flush();
    const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const receipt = { ...message(2), id, user_id: 'viewer', content: 'Slow delivery' };
    writeMessage.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve({ data: receipt, error: null }), 3000)));
    let sent!: Promise<boolean>;
    act(() => { sent = fixture.chat.sendMessage('Slow delivery', undefined, undefined, id); }); await flush();
    expect(fixture.chat.messages.filter(row => row.content === 'Slow delivery').map(row => row.id)).toEqual([`optimistic-${id}`]);
    await act(async () => { await jest.advanceTimersByTimeAsync(2999); }); await flush();
    expect(fixture.chat.messages.at(-1)?.id).toBe(`optimistic-${id}`);
    await act(async () => { await jest.advanceTimersByTimeAsync(1); await sent; }); await flush();
    expect(fixture.chat.messages.filter(row => row.content === 'Slow delivery').map(row => row.id)).toEqual([id]);
    await emit('INSERT', receipt); await flush();
    expect(fixture.chat.messages.filter(row => row.id === id)).toHaveLength(1);
  } finally {
    cleanup.splice(0).forEach(close => close());
    jest.clearAllTimers(); jest.useRealTimers();
  }
});


it.each(['event','circle'] as const)('joins only the current %s visit after a pending socket close', async kind => {
 jest.useFakeTimers();try {
  readMessages.mockResolvedValue(result(message(1)));mockClosing=true;
  const fixture=mount({kind,id:'room-a'});await flush();
  fixture.navigate({kind,id:'room-b'});await flush();fixture.navigate({kind,id:'room-a'});await flush();
  const channels=jest.mocked(supabase.channel).mock.results.map(result=>result.value);
  expect(channels).toHaveLength(3);
  expect(new Set(jest.mocked(supabase.channel).mock.calls.map(call=>call[0])).size).toBe(3);
  channels.forEach(channel=>expect(channel.subscribe).not.toHaveBeenCalled());
  mockClosing=false;await act(async()=>{jest.advanceTimersByTime(100);});await flush();
  expect(channels[0].subscribe).not.toHaveBeenCalled();expect(channels[1].subscribe).not.toHaveBeenCalled();
  expect(channels[2].subscribe).toHaveBeenCalledTimes(1);
 }finally{cleanup.splice(0).forEach(close=>close());jest.useRealTimers();}
});

it.each(['event', 'circle'] as const)('leaves %s unread when its history arrives under a different screen', async kind => {
  let visible = true;
  const firstRead = deferred<ReadResult>();
  const page = result(message(1, kind === 'circle' ? { event_id: null, circle_id: 'room' } : {}));
  readMessages.mockReturnValueOnce(firstRead.promise).mockResolvedValue(page);
  const fixture = mount({ kind, id: 'room' }, () => visible); await flush();
  expect(readMessages).toHaveBeenCalledTimes(1);
  visible = false; firstRead.resolve(page); await flush();
  expect(fixture.chat.messages[0].id).toBe(page.data![0].id);
  expect(readReceipts).not.toHaveBeenCalled();
  expect(clearNotifications).not.toHaveBeenCalled();
  visible = true;
  await act(async () => fixture.chat.refetch(true));
  expect(readReceipts).toHaveBeenCalledTimes(1);
  expect(clearNotifications).toHaveBeenCalledTimes(kind === 'event' ? 1 : 0);
});

it('acknowledges only eligible persisted history, preserving the server microseconds',async()=>{
  const confirmed = message(1,{created_at:'2026-11-06T09:00:00.123456Z'});
  const hidden = message(2,{created_at:'2026-11-06T09:01:00Z',user_id:'blocked-user'});
  blocked=['blocked-user'];readMessages.mockResolvedValueOnce(result(hidden,confirmed)).mockResolvedValueOnce(result());
  const fixture=mount();await flush();
  expect(readReceipts).toHaveBeenCalledWith(expect.objectContaining({last_read_at:confirmed.created_at}),expect.objectContaining({ignoreDuplicates:true}));
  await act(async()=>fixture.chat.refetch(true));expect(readReceipts).toHaveBeenCalledTimes(1);
});

it('does not manufacture a receipt from an optimistic-only list',async()=>{
  readMessages.mockResolvedValue(result());const delivery=deferred<any>();writeMessage.mockReturnValueOnce(delivery.promise);
  const fixture=mount();await flush();
  let sending!: Promise<unknown>;act(()=>{sending=fixture.chat.sendMessage('not confirmed');});await flush();
  expect(fixture.chat.messages.some(row=>row.id.startsWith('optimistic-'))).toBe(true);
  await act(async()=>fixture.chat.refetch(true));expect(readReceipts).not.toHaveBeenCalled();expect(clearNotifications).not.toHaveBeenCalled();
  await act(async()=>{delivery.resolve({data:message(1),error:null});await sending;});
});

it('keeps history and offers retry when a refresh has no page; a confirmed empty page still clears it',async()=>{
  readMessages.mockResolvedValueOnce(result(message(1))).mockResolvedValueOnce({data:null,error:null}).mockResolvedValueOnce(result());
  const fixture=mount();await flush();await act(async()=>fixture.chat.refetch(true));
  expect(fixture.chat.messages.map(row=>row.id)).toEqual([message(1).id]);expect(fixture.chat.loadError).toBe(true);
  await act(async()=>fixture.chat.refetch(true));expect(fixture.chat.messages).toEqual([]);expect(fixture.chat.loadError).toBe(false);
});
it('retains the earlier-history cursor on a missing page and recovers on explicit retry',async()=>{
  readMessages.mockResolvedValueOnce(result(...Array.from({length:60},(_,i)=>message(i+1)))).mockResolvedValueOnce({data:null,error:null}).mockResolvedValueOnce(result(message(0)));
  const fixture=mount();await flush();await act(async()=>fixture.chat.loadOlder());
  expect(fixture.chat.olderLoadError).toBe(true);expect(fixture.chat.messages).toHaveLength(60);
  await act(async()=>fixture.chat.loadOlder(true));expect(fixture.chat.olderLoadError).toBe(false);expect(fixture.chat.messages[0].id).toBe(message(0).id);
});

it('removes a confirmed blocked author and quoted text immediately, even when the next history read fails',async()=>{
  const {removeBlockedPrivateChatPreviews}=require('../../lib/chatListCache');
  const original=message(1),reply=message(2,{user_id:'allowed',reply_to_message_id:original.id});
  readMessages.mockResolvedValueOnce(result(original,reply));const fixture=mount();await flush();
  expect(fixture.chat.messages[1].reply_to?.content).toBe(original.content);
  act(()=>removeBlockedPrivateChatPreviews('someone-else','other'));await flush();
  expect(fixture.chat.messages).toHaveLength(2);
  act(()=>removeBlockedPrivateChatPreviews('viewer','other'));await flush();
  expect(fixture.chat.messages.map(r=>r.id)).toEqual([reply.id]);expect(fixture.chat.messages[0].reply_to).toBeFalsy();
  readMessages.mockResolvedValueOnce({data:null,error:new Error('offline')});await act(async()=>fixture.chat.refetch(true));
  expect(fixture.chat.messages.map(r=>r.id)).toEqual([reply.id]);expect(fixture.chat.loadError).toBe(true);
});
it('applies confirmed privacy preferences even if the concurrent history query failed',async()=>{
  const original=message(1),allowed=message(2,{user_id:'allowed'});
  readMessages.mockResolvedValueOnce(result(original,allowed));const fixture=mount();await flush();
  fixture.client.removeQueries({queryKey:['profile-blocked','viewer']});blocked=['other'];
  readMessages.mockRejectedValueOnce(new Error('offline'));
  await act(async()=>fixture.chat.refetch(true));await flush();
  expect(fixture.chat.messages.map(r=>r.id)).toEqual([allowed.id]);expect(fixture.chat.loadError).toBe(true);
});

it('prevents an older history page in flight from restoring a newly blocked author',async()=>{
  const {removeBlockedPrivateChatPreviews}=require('../../lib/chatListCache');
  readMessages.mockResolvedValueOnce(result(...Array.from({length:60},(_,i)=>message(i+1,{user_id:'allowed'}))));
  const fixture=mount();await flush();
  const page=deferred<ReadResult>();readMessages.mockReturnValueOnce(page.promise);
  let pending!:Promise<void>;act(()=>{pending=fixture.chat.loadOlder();});await flush();
  act(()=>removeBlockedPrivateChatPreviews('viewer','other'));
  await act(async()=>{page.resolve(result(message(0)));await pending;});
  expect(fixture.chat.messages).toHaveLength(60);expect(fixture.chat.messages.every(row=>row.user_id==='allowed')).toBe(true);
});

it.each([null, {}, {blocked_users:'invalid'}, {blocked_users:[null]}])('does not show first-load messages with an unconfirmed block list: %j',async profile=>{
  readBlocked.mockResolvedValueOnce({data:profile,error:null}).mockResolvedValue({data:{blocked_users:['other']},error:null});
  readMessages.mockResolvedValue(result(message(1),message(2,{user_id:'allowed'})));
  const fixture=mount();await flush();
  expect(fixture.chat.loadError).toBe(true);expect(fixture.chat.messages).toEqual([]);expect(readReceipts).not.toHaveBeenCalled();
  await act(async()=>fixture.chat.refetch());expect(fixture.chat.messages.map(row=>row.id)).toEqual([message(2).id]);
});
it.each([null,[]])('accepts a confirmed profile with an empty or legacy null block list: %j',async list=>{
  readBlocked.mockResolvedValueOnce({data:{blocked_users:list},error:null});readMessages.mockResolvedValue(result(message(1)));
  const fixture=mount();await flush();expect(fixture.chat.loadError).toBe(false);expect(fixture.chat.messages).toHaveLength(1);
});

it.each(['event','circle'] as const)('waits for the actual newest row of the %s page to enter the viewport', async kind => {
  const latest = message(2), older = message(1);
  readMessages.mockResolvedValue(result(latest, older));
  let seenId = older.id;
  const fixture = mount({kind,id:'room'}, () => true, id => id === seenId);
  await flush();
  fixture.chat.checkVisiblePage(); await flush();
  expect(readReceipts).not.toHaveBeenCalled();
  expect(clearNotifications).not.toHaveBeenCalled();
  seenId = latest.id;
  fixture.chat.checkVisiblePage(); fixture.chat.checkVisiblePage(); await flush();
  expect(readReceipts).toHaveBeenCalledTimes(1);
  expect(readReceipts.mock.calls[0][0]).toMatchObject({last_read_at: latest.created_at});
  expect(clearNotifications).toHaveBeenCalledTimes(kind === 'event' ? 1 : 0);
  expect(readMessages).toHaveBeenCalledTimes(1);
});
it('cannot acknowledge an old room page when the viewport changes after leaving', async () => {
  const old = message(2);
  readMessages.mockResolvedValueOnce(result(old)).mockResolvedValue(result());
  let visible = false;
  const fixture = mount({kind:'event',id:'room-a'}, () => true, () => visible);
  await flush(); const retained = fixture.chat.checkVisiblePage;
  fixture.navigate({kind:'event',id:'room-b'}); await flush();
  visible = true; retained(); await flush();
  expect(readReceipts).not.toHaveBeenCalled(); expect(clearNotifications).not.toHaveBeenCalled();
});

it.each(['event', 'circle'] as const)('acknowledges exposed live %s messages once, even across a delayed refresh', async kind => {
  jest.useFakeTimers();
  try {
    const key = { kind, id: 'room' };
    const parent = kind === 'event' ? { event_id: key.id } : { circle_id: key.id, event_id: null };
    const live = message(5, { ...parent, created_at: '2026-11-06T12:00:00.123457Z' });
    const earlier = message(4, { ...parent, created_at: '2026-11-06T12:00:00.123456Z' });
    const held = deferred<ReadResult>();
    blocked = ['blocked-person'];
    readMessages.mockResolvedValueOnce(result()).mockReturnValueOnce(held.promise);
    let exposed = false;
    const fixture = mount(key, () => true, () => exposed);
    await flush();
    let refresh!: Promise<void>;
    act(() => { refresh = fixture.chat.refetch(true); });
    await flush();
    await emit('INSERT', live);
    await emit('INSERT', earlier);
    await emit('INSERT', live);
    await act(async () => { await jest.advanceTimersByTimeAsync(250); });
    expect(readReceipts).not.toHaveBeenCalled();
    expect(fixture.chat.messages.map(row => row.id)).toContain(live.id);
    exposed = true;
    fixture.chat.checkVisiblePage();
    await emit('INSERT', message(6, { ...parent, user_id: 'viewer' }));
    await emit('INSERT', message(7, { ...parent, user_id: 'blocked-person' }));
    await emit('INSERT', message(8, {event_id: 'other-room', circle_id: 'other-room'}));
    await act(async () => { await jest.advanceTimersByTimeAsync(250); });
    expect(readReceipts).toHaveBeenCalledTimes(1);
    expect(readReceipts.mock.calls[0][0]).toMatchObject({[kind === 'event' ? 'event_id' : 'circle_id']: 'room', user_id: 'viewer', last_read_at: live.created_at});
    held.resolve(result(earlier));
    await act(async () => { await refresh; });
    await emit('INSERT', live);
    fixture.chat.checkVisiblePage();
    await act(async () => { await jest.advanceTimersByTimeAsync(250); });
    expect(readReceipts).toHaveBeenCalledTimes(1);
    expect(clearNotifications).toHaveBeenCalledTimes(kind === 'event' ? 1 : 0);
    expect(readMessages).toHaveBeenCalledTimes(2);
  } finally {
    cleanup.splice(0).forEach(close => close());
    jest.useRealTimers();
  }
});
