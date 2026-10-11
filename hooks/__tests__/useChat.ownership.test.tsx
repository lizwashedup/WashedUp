import React from 'react';
import { Alert, AppState, type AppStateStatus } from 'react-native';
import { logError } from '../../lib/logger';
import { act, create } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useChat, isObsoleteChatOperation, isUnconfirmedChatReaction, type ChatMessage, type ConversationKey } from '../useChat';

const mockRealtimeReactions = jest.fn();
jest.mock('../../lib/chatReactionReader', () => ({readLoadedChatReactions: (...args: any[]) => mockRealtimeReactions(...args)}));
const mockReplyBlocks = jest.fn();
jest.mock('../../lib/blocking', () => ({ getBlockedWith: (...args: any[]) => mockReplyBlocks(...args) }));
const mockAuth = jest.fn(), mockSession = jest.fn(), mockRead = jest.fn(), mockWrite = jest.fn();
const mockReceipt = jest.fn(), mockMutation = jest.fn(), mockReactionRead = jest.fn();
const mockBlocks = jest.fn(), mockProfiles = jest.fn(), mockReadMarker = jest.fn(), mockNotificationRead = jest.fn();
const mockListeners = new Set<(event: string, session: any) => void>();
const mockChannels: any[] = [];
jest.mock('../../lib/logger', () => ({ logError: jest.fn() }));
jest.mock('../../lib/contentFilter', () => ({ checkContent: () => ({ ok: true }) }));
jest.mock('../../lib/supabase', () => ({ supabase: {
  auth: {
    getUser: () => mockAuth(), getSession: () => mockSession(),
    onAuthStateChange: (callback: any) => {
      mockListeners.add(callback);
      return { data: { subscription: { unsubscribe: () => mockListeners.delete(callback) } } };
    },
  },
  rpc: (_name: string, p: any) => ({ setHeader: () => Promise.resolve(mockMutation('messages','update',{content:p.p_content},{id:p.p_message_id,user_id:'alice',[p.p_kind==='event'?'event_id':'circle_id']:p.p_conversation_id})).then((r:any)=>({data:r.data?{status:'saved',...r.data}:null,error:r.error})) }),
  from: (table: string) => {
    let operation = 'select', payload: unknown;
    const filters: Record<string, unknown> = {};
    const finish = (ending?: string) => {
      if (table === 'messages' && operation === 'select') return ending === 'maybeSingle' ? mockReceipt(filters) : mockRead(filters);
      if (table === 'messages' && operation === 'insert') return mockWrite(payload, filters);
      if (table === 'message_reactions' && operation === 'select') return ending === 'limit' ? mockReactionRead(filters) : Promise.resolve({ data: [], error: null });
      if (table === 'profiles') return mockBlocks(filters);
      if (table === 'profiles_public') return mockProfiles(filters);
      if (table === 'chat_reads') return mockReadMarker(payload);
      if (table === 'app_notifications') return mockNotificationRead(filters);
      return mockMutation(table, operation, payload, filters);
    };
    const chain: any = {
      select: () => chain, order: () => chain,
      eq: (key: string, value: unknown) => { filters[key] = value; return chain; },
      in: (key: string, value: unknown) => { filters[key] = value; return chain; },
      or: (value: unknown) => { filters.older = value; return chain; },
      insert: (value: unknown) => { operation = 'insert'; payload = value; return chain; },
      upsert: (value: unknown) => { operation = 'upsert'; payload = value; return chain; },
      update: (value: unknown) => { operation = 'update'; payload = value; return chain; },
      delete: () => { operation = 'delete'; return chain; },
      single: () => finish('single'), maybeSingle: () => finish('maybeSingle'), limit: () => finish('limit'),
      then: (yes: any, no: any) => Promise.resolve(finish()).then(yes, no),
    };
    return chain;
  },
  channel: () => {
    const callbacks: Record<string, any> = {};
    const channel: any = { callbacks, on: (_kind: string, filter: any, callback: any) => { callbacks[filter.event] = callback; return channel; }, subscribe: () => channel };
    mockChannels.push(channel); return channel;
  },
  removeChannel: jest.fn(),
} }));

function deferred<T = any>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
const identity = (id: string | null) => ({ data: { user: id ? { id } : null }, error: null });
const result = (rows: ChatMessage[]) => ({ data: rows, error: null });
const success = { data: null, error: null };
function message(id = 'old', extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id, event_id: 'plan-a', user_id: 'alice', content: id, message_type: 'user', created_at: '2026-09-13T10:00:00Z', reactions: [], ...extra };
}
async function flush() { await act(async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); }); }
function emitIdentity(id: string | null) {
  mockAuth.mockResolvedValue(identity(id));
  act(() => { mockListeners.forEach(callback => callback('SIGNED_IN', id ? { user: { id } } : null)); });
}
function start(work: () => Promise<unknown>) {
  let pending!: Promise<unknown>;
  act(() => { pending = work().catch(error => error); });
  return pending;
}
const cleanup: Array<() => void> = [];
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  let chat!: ReturnType<typeof useChat>, tree!: ReturnType<typeof create>, mounted = true;
  function Harness({ room }: { room: ConversationKey }) { chat = useChat(room); return null; }
  const render = (room: ConversationKey) => <QueryClientProvider client={client}><Harness room={room} /></QueryClientProvider>;
  act(() => { tree = create(render({ kind: 'event', id: 'plan-a' })); });
  const unmount = () => { if (mounted) { act(() => tree.unmount()); mounted = false; } };
  cleanup.push(() => { unmount(); client.clear(); });
  return { get chat() { return chat; }, navigate: (room: ConversationKey) => act(() => tree.update(render(room))), unmount };
}
beforeEach(() => {
  jest.clearAllMocks(); mockRealtimeReactions.mockReset().mockResolvedValue([]); mockReplyBlocks.mockReset().mockResolvedValue(new Set()); mockListeners.clear(); mockChannels.splice(0);
  mockAuth.mockReset().mockResolvedValue(identity('alice'));
  mockSession.mockReset().mockResolvedValue({ data: { session: { user: { id: 'alice' }, access_token: 'test-token' } } });
  mockRead.mockReset().mockResolvedValue(result([message()]));
  mockWrite.mockReset().mockImplementation(payload => Promise.resolve({ data: { ...payload, id: payload.id, created_at: '2026-09-13T11:00:00Z' }, error: null }));
  mockReceipt.mockReset().mockResolvedValue(success);
  mockMutation.mockReset().mockImplementation((_table,operation,payload,filters)=>Promise.resolve(operation==='update'?{data:{id:filters.id,content:payload.content},error:null}:success));
  mockReactionRead.mockReset().mockResolvedValue({ data: [], error: null });
  mockBlocks.mockReset().mockResolvedValue({ data: { blocked_users: [] }, error: null });
  mockProfiles.mockReset().mockResolvedValue({ data: [], error: null });
  mockReadMarker.mockReset().mockResolvedValue(success); mockNotificationRead.mockReset().mockResolvedValue(success);
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => { cleanup.splice(0).forEach(close => close()); jest.restoreAllMocks(); });

it.each(['room ABA', 'account ABA', 'signout', 'unmount'] as const)('retained send cannot start after %s', async change => {
  const fixture = mount(); await flush(); const old = fixture.chat.sendMessage;
  if (change === 'room ABA') { fixture.navigate({ kind: 'circle', id: 'circle-b' }); await flush(); fixture.navigate({ kind: 'event', id: 'plan-a' }); }
  else if (change === 'account ABA') { emitIdentity('bob'); await flush(); emitIdentity('alice'); }
  else if (change === 'signout') emitIdentity(null);
  else fixture.unmount();
  await flush();
  const outcome = await start(() => old('Retired draft'));
  expect(mockWrite).not.toHaveBeenCalled();
  expect(outcome).toMatchObject({ name: 'ObsoleteChatOperationError' });
});

it.each(['text', 'location', 'audio'] as const)('retired %s insert does not look up a receipt or alert in the new visit', async kind => {
  const fixture = mount(); await flush(); const insert = deferred(); mockWrite.mockReturnValueOnce(insert.promise);
  const pending = start(() => kind === 'text' ? fixture.chat.sendMessage('Private draft', 'photo.jpg', undefined, 'stable-id') : kind === 'location' ? fixture.chat.sendLocation(1, 2, 'Private place') : fixture.chat.sendAudio('voice.m4a', 3));
  await flush(); fixture.navigate({ kind: 'circle', id: 'circle-b' }); await flush();
  let outcome: unknown;
  await act(async () => { insert.resolve({ data: null, error: new Error('Lost response') }); outcome = await pending; });
  expect(mockReceipt).not.toHaveBeenCalled();
  expect(outcome).toMatchObject({ name: 'ObsoleteChatOperationError' });
  expect(Alert.alert).not.toHaveBeenCalled();
  expect(fixture.chat.messages.some(row => row.content === 'Private draft')).toBe(false);
});

it('a reaction lookup cannot continue its write after the account changes', async () => {
  const fixture = mount(); await flush(); const read = deferred(); mockReactionRead.mockReturnValueOnce(read.promise);
  const pending = start(() => fixture.chat.toggleReaction('old', '🔥')); await flush(); emitIdentity('bob'); await flush();
  await act(async () => { read.resolve({ data: [], error: null }); await pending; });
  expect(mockMutation).not.toHaveBeenCalled();
});

it('failed delete restores only that row and preserves later incoming messages', async () => {
  const fixture = mount(); await flush(); const deletion = deferred(); mockMutation.mockReturnValueOnce(deletion.promise);
  const pending = start(() => fixture.chat.deleteMessage('old')); await flush();
  await act(async () => { await mockChannels.at(-1).callbacks.INSERT({ new: message('new', { user_id: 'bob', created_at: '2026-09-13T11:00:00Z' }) }); });
  await act(async () => { deletion.resolve({ error: new Error('Rejected') }); await pending; });
  expect(fixture.chat.messages.map(row => row.id)).toEqual(['old', 'new']);
});

it('the auth event closes an old send synchronously, before React commits the next account', async () => {
  const fixture = mount(); await flush(); const old = fixture.chat.sendMessage;
  let pending!: Promise<unknown>;
  act(() => {
    mockListeners.forEach(callback => callback('SIGNED_IN', { user: { id: 'bob' } }));
    pending = old('Old account').catch(error => error);
  });
  expect(isObsoleteChatOperation(await pending)).toBe(true);
  expect(mockWrite).not.toHaveBeenCalled();
  await flush();
});

it('keeps scope stable for the same account and retires it permanently across account ABA', async () => {
  const fixture = mount(); await flush(); const scope = fixture.chat.operationScope;
  expect(scope?.isCurrent()).toBe(true);
  emitIdentity('alice'); await flush(); expect(fixture.chat.operationScope).toBe(scope);
  emitIdentity('bob'); await flush(); expect(scope?.isCurrent()).toBe(false);
  emitIdentity('alice'); await flush(); expect(fixture.chat.operationScope).not.toBe(scope);
  expect(scope?.isCurrent()).toBe(false);
});

it('initial identity failure is honest and retryable without fetching an unowned conversation', async () => {
  mockAuth.mockResolvedValueOnce({ data: { user: null }, error: new Error('Offline') });
  const fixture = mount(); await flush();
  expect(fixture.chat.operationScope).toBeNull(); expect(fixture.chat.loadError).toBe(true); expect(fixture.chat.loading).toBe(false);
  expect(mockRead).not.toHaveBeenCalled(); expect(mockReadMarker).not.toHaveBeenCalled();
  await act(async () => { await fixture.chat.refetch(); }); await flush();
  expect(fixture.chat.currentUserId).toBe('alice'); expect(fixture.chat.loadError).toBe(false);
  expect(fixture.chat.messages.map(row => row.id)).toEqual(['old']);
});

it('signed-out identity starts no account reads, realtime subscription or send', async () => {
  mockAuth.mockResolvedValue(identity(null)); const fixture = mount(); await flush();
  expect(fixture.chat.messages).toEqual([]); expect(fixture.chat.operationScope).toBeNull(); expect(fixture.chat.loading).toBe(false);
  expect(mockRead).not.toHaveBeenCalled(); expect(mockChannels).toHaveLength(0);
  let outcome: unknown; await act(async () => { outcome = await fixture.chat.sendAudio('voice', 2); });
  expect(outcome).toBe(false); expect(mockWrite).not.toHaveBeenCalled();
});

it('an empty room cannot gain a send scope from a known account', async () => {
  const fixture = mount(); await flush(); fixture.navigate({ kind: 'event', id: '' }); await flush();
  expect(fixture.chat.operationScope).toBeNull(); expect(fixture.chat.messages).toEqual([]);
  const reads = mockRead.mock.calls.length;
  let outcome: unknown; await act(async () => { outcome = await fixture.chat.sendMessage('No room'); });
  expect(outcome).toBe(false); expect(mockWrite).not.toHaveBeenCalled(); expect(mockRead).toHaveBeenCalledTimes(reads);
});

it('a delayed internal auth result cannot adopt a different user for read markers or private preferences', async () => {
  const auth = deferred(); mockAuth.mockResolvedValueOnce(identity('alice')).mockReturnValueOnce(auth.promise);
  const fixture = mount(); await flush();
  await act(async () => { auth.resolve(identity('bob')); }); await flush();
  expect(fixture.chat.currentUserId).toBe('alice'); expect(fixture.chat.loadError).toBe(true);
  expect(fixture.chat.messages).toEqual([]); expect(mockBlocks).not.toHaveBeenCalled(); expect(mockReadMarker).not.toHaveBeenCalled();
});

it('auth-lock fallback accepts only the original account and preserves block filtering', async () => {
  mockAuth.mockResolvedValueOnce(identity('alice')).mockRejectedValueOnce(new Error('Auth lock'));
  mockBlocks.mockResolvedValueOnce({ data: { blocked_users: ['blocked'] }, error: null });
  mockRead.mockResolvedValueOnce(result([message('private', { user_id: 'blocked' }), message()]));
  const fixture = mount(); await flush();
  expect(mockSession).toHaveBeenCalledTimes(1); expect(fixture.chat.messages.map(row => row.id)).toEqual(['old']);
  expect(mockReadMarker).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'alice', event_id: 'plan-a' }));
});

it('an old auth failure cannot begin a fallback read after the account changed', async () => {
  const auth = deferred(); mockAuth.mockResolvedValueOnce(identity('alice')).mockReturnValueOnce(auth.promise);
  const fixture = mount(); await flush(); emitIdentity('bob'); await flush();
  await act(async () => { auth.resolve({ data: { user: null }, error: new Error('Old auth failure') }); }); await flush();
  expect(mockSession).not.toHaveBeenCalled(); expect(fixture.chat.currentUserId).toBe('bob');
});

it('account retirement during a privacy read cannot start old read markers or publish old message text', async () => {
  const blocks = deferred(); mockBlocks.mockReturnValueOnce(blocks.promise);
  mockRead.mockResolvedValueOnce(result([message('alice-private')]));
  const fixture = mount(); await flush();
  mockRead.mockResolvedValue(result([message('bob-current', { user_id: 'bob' })])); emitIdentity('bob'); await flush();
  await act(async () => { blocks.resolve({ data: { blocked_users: [] }, error: null }); }); await flush();
  expect(fixture.chat.messages.map(row => row.id)).toEqual(['bob-current']);
  expect(mockReadMarker.mock.calls.every(([payload]) => payload.user_id === 'bob')).toBe(true);
  expect(mockNotificationRead.mock.calls.every(([filters]) => filters.user_id === 'bob')).toBe(true);
});

it('a new room recovers once when its shared privacy read belonged to a retired room', async () => {
  const oldBlocks = deferred(); mockBlocks.mockReturnValueOnce(oldBlocks.promise);
  const fixture = mount(); await flush();
  mockRead.mockResolvedValue(result([message('current-circle', { event_id: null, circle_id: 'circle-b' })]));
  fixture.navigate({ kind: 'circle', id: 'circle-b' }); await flush();
  expect(mockBlocks).toHaveBeenCalledTimes(1);
  await act(async () => { oldBlocks.resolve({ data: { blocked_users: ['private'] }, error: null }); }); await flush();
  expect(mockBlocks).toHaveBeenCalledTimes(2); expect(fixture.chat.loadError).toBe(false);
  expect(fixture.chat.messages.map(row => row.id)).toEqual(['current-circle']);
});

it('an unknown privacy read does not publish a potentially blocked sender', async () => {
  mockBlocks.mockResolvedValueOnce({ data: null, error: new Error('Could not read preferences') });
  const fixture = mount(); await flush();
  expect(fixture.chat.messages).toEqual([]); expect(fixture.chat.loadError).toBe(true); expect(mockReadMarker).not.toHaveBeenCalled();
});

it('holds realtime during initial privacy loading, then keeps allowed activity and filters blocked activity', async () => {
  const blocks = deferred(); mockBlocks.mockReturnValueOnce(blocks.promise);
  const fixture = mount(); await flush();
  await act(async () => {
    await mockChannels.at(-1).callbacks.INSERT({ new: message('private-realtime', { user_id: 'blocked' }) });
    await mockChannels.at(-1).callbacks.INSERT({ new: message('allowed-realtime', { user_id: 'friend' }) });
  });
  expect(fixture.chat.messages).toEqual([]);
  await act(async () => { blocks.resolve({ data: { blocked_users: ['blocked'] }, error: null }); }); await flush();
  expect(fixture.chat.messages.map(row => row.id).sort()).toEqual(['allowed-realtime', 'old']);
});

it('a late newest response cannot overwrite the returning account or mark its old snapshot read', async () => {
  const fixture = mount(); await flush(); const old = deferred(); mockRead.mockReturnValueOnce(old.promise);
  const pending = start(() => fixture.chat.refetch(true)); await flush();
  emitIdentity('bob'); await flush(); mockRead.mockResolvedValue(result([message('new-alice')])); emitIdentity('alice'); await flush();
  const count = mockReadMarker.mock.calls.length;
  await act(async () => { old.resolve(result([message('old-alice-private')])); await pending; }); await flush();
  expect(fixture.chat.messages.map(row => row.id)).toEqual(['new-alice']); expect(mockReadMarker).toHaveBeenCalledTimes(count);
});

it.each(['older', 'realtime'] as const)('old %s sender enrichment cannot cross an account transition', async kind => {
  mockRead.mockResolvedValueOnce(result(Array.from({ length: 60 }, (_, index) => message(`row-${index}`))));
  const fixture = mount(); await flush(); const profiles = deferred(); mockProfiles.mockReturnValueOnce(profiles.promise);
  if (kind === 'older') mockRead.mockResolvedValueOnce(result([message('old-private')]));
  const pending = start(() => kind === 'older' ? fixture.chat.loadOlder() : mockChannels.at(-1).callbacks.INSERT({ new: message('old-private') })); await flush();
  mockRead.mockResolvedValue(result([message('current-bob', { user_id: 'bob' })])); emitIdentity('bob'); await flush();
  await act(async () => { profiles.resolve({ data: [], error: null }); await pending; });
  expect(fixture.chat.messages.map(row => row.id)).toEqual(['current-bob']);
});

it('a stricter entry scope can close after insert without allowing a receipt lookup', async () => {
  const fixture = mount(); await flush(); let allowed = true;
  const entry = { userId: 'alice', isCurrent: () => allowed };
  const insert = deferred(); mockWrite.mockReturnValueOnce(insert.promise);
  const pending = start(() => fixture.chat.sendMessage('Entry draft', undefined, undefined, 'entry-id', entry)); await flush();
  allowed = false; let outcome: unknown;
  await act(async () => { insert.resolve({ data: null, error: new Error('Unknown result') }); outcome = await pending; });
  expect(isObsoleteChatOperation(outcome)).toBe(true); expect(mockReceipt).not.toHaveBeenCalled(); expect(Alert.alert).not.toHaveBeenCalled();
  expect(fixture.chat.messages.some(row => row.id === 'optimistic-entry-id')).toBe(false);
});

it('obsolete entry cleanup preserves a newer attempt that reused the same UUID', async () => {
  const fixture = mount(); await flush(); let allowed = true;
  const oldInsert = deferred(), newInsert = deferred(); mockWrite.mockReturnValueOnce(oldInsert.promise).mockReturnValueOnce(newInsert.promise);
  const pending = start(() => fixture.chat.sendMessage('Old entry draft', undefined, undefined, 'entry-id', { userId: 'alice', isCurrent: () => allowed })); await flush();
  allowed = false;
  const next = start(() => fixture.chat.sendMessage('New entry draft', undefined, undefined, 'entry-id', { userId: 'alice', isCurrent: () => true })); await flush();
  await act(async () => { oldInsert.resolve({ data: null, error: new Error('Unknown old result') }); await pending; });
  expect(fixture.chat.messages.filter(row => row.id === 'optimistic-entry-id').map(row => row.content)).toEqual(['New entry draft']);
  await act(async () => { newInsert.resolve({ data: message('entry-id', { content: 'New entry draft', created_at: '2026-09-13T12:00:00Z' }), error: null }); await next; });
  expect(fixture.chat.messages.find(row => row.id === 'entry-id')?.content).toBe('New entry draft');
});

it('a supplied scope for another account cannot start a write', async () => {
  const fixture = mount(); await flush();
  const outcome = await start(() => fixture.chat.sendLocation(1, 2, 'Place', { userId: 'bob', isCurrent: () => true }));
  expect(isObsoleteChatOperation(outcome)).toBe(true); expect(mockWrite).not.toHaveBeenCalled();
});

it.each(['event', 'circle'] as const)('voice retry uses the same UUID and exact %s/account receipt filters', async kind => {
  const fixture = mount(); await flush(); if (kind === 'circle') { fixture.navigate({ kind, id: 'circle-b' }); await flush(); }
  mockWrite.mockResolvedValue({ data: null, error: new Error('Lost response') });
  mockReceipt.mockResolvedValueOnce(success).mockResolvedValueOnce({ data: { id: 'voice-id', created_at: '2026-09-13T12:00:00Z', message_type: 'audio', audio_url: 'cached-voice.m4a', duration_seconds: 7 }, error: null });
  let first: unknown, second: unknown;
  await act(async () => { first = await fixture.chat.sendAudio('cached-voice.m4a', 7, fixture.chat.operationScope!, 'voice-id'); });
  await act(async () => { second = await fixture.chat.sendAudio('cached-voice.m4a', 7, fixture.chat.operationScope!, 'voice-id'); });
  expect(first).toBe(false); expect(second).toBe(true);
  const parent = kind === 'event' ? { event_id: 'plan-a' } : { circle_id: 'circle-b' };
  expect(mockWrite.mock.calls.map(([payload]) => payload)).toEqual([expect.objectContaining({ id: 'voice-id', user_id: 'alice', audio_url: 'cached-voice.m4a', ...parent }), expect.objectContaining({ id: 'voice-id', ...parent })]);
  expect(mockReceipt).toHaveBeenLastCalledWith({ id: 'voice-id', user_id: 'alice', ...parent });
  expect(fixture.chat.messages.filter(row => row.id === 'voice-id')).toHaveLength(1);
});

it.each(['edit', 'delete'] as const)('late %s failure cannot restore or alert across account ABA', async kind => {
  const fixture = mount(); await flush(); const mutation = deferred(); mockMutation.mockReturnValueOnce(mutation.promise);
  const pending = start(() => kind === 'edit' ? fixture.chat.editMessage('old', 'Edited') : fixture.chat.deleteMessage('old')); await flush();
  emitIdentity('bob'); await flush(); mockRead.mockResolvedValue(result([message('new-alice')])); emitIdentity('alice'); await flush();
  let outcome: unknown; await act(async () => { mutation.resolve({ error: new Error('Old failure') }); outcome = await pending; });
  expect(isObsoleteChatOperation(outcome)).toBe(true); expect(fixture.chat.messages.map(row => row.id)).toEqual(['new-alice']); expect(Alert.alert).not.toHaveBeenCalled();
});

it('an older failed edit cannot undo the newer confirmed edit or an incoming row', async () => {
  const fixture = mount(); await flush(); const first = deferred(); mockMutation.mockReturnValueOnce(first.promise);
  const pending = start(() => fixture.chat.editMessage('old', 'First')); await flush();
  await act(async () => { await fixture.chat.editMessage('old', 'Second'); await mockChannels.at(-1).callbacks.INSERT({ new: message('new') }); });
  await act(async () => { first.resolve({ error: new Error('First failed') }); await pending; });
  expect(fixture.chat.messages.find(row => row.id === 'old')?.content).toBe('Second'); expect(fixture.chat.messages.some(row => row.id === 'new')).toBe(true);
});

it('an old reaction finalizer cannot release a newer visit’s lock', async () => {
  const fixture = mount(); await flush(); const old = deferred(), current = deferred();
  mockReactionRead.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
  const pending = start(() => fixture.chat.toggleReaction('old', '🔥')); await flush();
  emitIdentity('bob'); await flush(); emitIdentity('alice'); await flush();
  const next = start(() => fixture.chat.toggleReaction('old', '👍')); await flush();
  await act(async () => { old.resolve({ data: [], error: null }); await pending; });
  await act(async () => { await fixture.chat.toggleReaction('old', '❤️'); });
  expect(mockReactionRead).toHaveBeenCalledTimes(2);
  await act(async () => { current.resolve({ data: [], error: null }); await next; });
  expect(fixture.chat.messages[0].reactions).toEqual([{ user_id: 'alice', reaction: '👍' }]);
});

it('keeps a restored reply to an older exact-room message outside the loaded history', async () => {
  const fixture = mount(); await flush();
  mockReceipt.mockResolvedValue({ data: { id: 'older-reply', user_id: 'cedar', content: 'Older original' }, error: null });
  await act(async () => { expect(await fixture.chat.sendMessage('A retained reply', undefined, 'older-reply', 'stable-reply')).toBe(true); });
  expect(mockReceipt).toHaveBeenCalledWith({ event_id: 'plan-a', id: 'older-reply' });
  expect(mockWrite.mock.calls[0][0]).toMatchObject({ id: 'stable-reply', event_id: 'plan-a', reply_to_message_id: 'older-reply' });
});
it('does not silently turn an unavailable or blocked restored reply into an ordinary message', async () => {
  const fixture = mount(); await flush();
  await act(async () => { await expect(fixture.chat.sendMessage('Retained', undefined, 'missing')).rejects.toThrow('no longer available'); });
  expect(mockWrite).not.toHaveBeenCalled();
  mockReceipt.mockResolvedValue({ data: { id: 'blocked-reply', user_id: 'cedar', content: 'Unavailable' }, error: null });
  mockReplyBlocks.mockResolvedValue(new Set(['cedar']));
  await act(async () => { await expect(fixture.chat.sendMessage('Retained', undefined, 'blocked-reply')).rejects.toThrow('unavailable'); });
  expect(mockWrite).not.toHaveBeenCalled();
});

it('does not claim an edit saved without an exact RPC receipt, and restores the saved bubble', async () => {
  const fixture = mount(); await flush(); mockMutation.mockResolvedValueOnce({ data: null, error: null });
  await act(async () => { expect(await fixture.chat.editMessage('old', 'Not applied')).toBe(false); });
  expect(fixture.chat.messages.find(row => row.id === 'old')?.content).toBe('old');
  expect(mockMutation).toHaveBeenCalledWith('messages', 'update', { content: 'Not applied' }, { id: 'old', user_id: 'alice', event_id: 'plan-a' });
});

it.each(['event','circle'] as const)('releases a stalled %s history read into a retryable error',async kind=>{
 jest.useFakeTimers();const fixture=mount();try{
  await flush();if(kind==='circle'){fixture.navigate({kind,id:'circle-b'});await flush();}
  const before=fixture.chat.messages;mockRead.mockReturnValueOnce(new Promise(()=>{}));start(()=>fixture.chat.refetch());await flush();expect(fixture.chat.loading).toBe(true);
  await act(async()=>{await jest.advanceTimersByTimeAsync(12_000);});expect(fixture.chat.loading).toBe(false);expect(fixture.chat.loadError).toBe(true);expect(fixture.chat.messages).toEqual(before);
  await act(async()=>fixture.chat.refetch());await flush();expect(fixture.chat.loadError).toBe(false);
 }finally{fixture.unmount();jest.useRealTimers();}
});
it('hydrates sender identity even if a read-marker write never returns',async()=>{
 const marker=deferred();mockReadMarker.mockReturnValue(marker.promise);mockProfiles.mockResolvedValue({data:[{id:'alice',first_name_display:'Alice',profile_photo_url:'alice-photo'}],error:null});
 const fixture=mount();await flush();expect(fixture.chat.loading).toBe(false);expect(fixture.chat.messages[0].sender?.first_name).toBe('Alice');
 marker.resolve(success);await flush();
});
const identityMention={version:1 as const,text:'@Alex',references:[{userId:'11111111-1111-4111-8111-111111111111',label:'Alex',start:0,end:5}]};
it('sends the selected identity and keeps it on the optimistic and confirmed message',async()=>{
 const pending=deferred();mockWrite.mockReturnValueOnce(pending.promise);const f=mount();await flush();
 const send=start(()=>f.chat.sendMessage('@Alex',undefined,undefined,'mention-send',undefined,identityMention));await flush();
 expect(mockWrite.mock.calls[0][0]).toMatchObject({content:'@Alex',mention_data:identityMention});
 expect(f.chat.messages.find(m=>m.id==='optimistic-mention-send')?.mention_data).toEqual(identityMention);
 await act(async()=>{pending.resolve({data:{event_id:'plan-a',user_id:'alice',message_type:'user',id:'mention-send',created_at:'2026-09-13T11:00:00Z',content:'@Alex',mention_data:identityMention},error:null});await send;});await flush();
 expect(f.chat.messages.find(m=>m.id==='mention-send')?.mention_data).toEqual(identityMention);
});
it('does not confirm an identity-bearing send from a text-only or wrong-person receipt',async()=>{
 mockWrite.mockResolvedValue({data:{event_id:'plan-a',user_id:'alice',message_type:'user',id:'mention-send',created_at:'2026-09-13T11:00:00Z',content:'@Alex'},error:null});
 mockReceipt.mockResolvedValue({data:{event_id:'plan-a',user_id:'alice',message_type:'user',id:'mention-send',created_at:'2026-09-13T11:00:00Z',content:'@Alex',mention_data:{...identityMention,references:[{...identityMention.references[0],userId:'22222222-2222-4222-8222-222222222222'}]}},error:null});
 const f=mount();await flush();let result:boolean|undefined;await act(async()=>{result=await f.chat.sendMessage('@Alex',undefined,undefined,'mention-send',undefined,identityMention);});await flush();
 expect(result).toBe(false);expect(f.chat.messages.some(m=>m.id==='mention-send')).toBe(false);
});
it('hydrates identity changes from realtime without guessing from the visible name',async()=>{
 mockRead.mockResolvedValue(result([message('mention-row',{content:'@Alex',mention_data:identityMention})]));
 const f=mount();await flush();const next={...identityMention,references:[{...identityMention.references[0],userId:'22222222-2222-4222-8222-222222222222'}]};
 act(()=>mockChannels[0].callbacks.UPDATE({new:{id:'mention-row',content:'@Alex',mention_data:next}}));await flush();
 expect(f.chat.messages.find(m=>m.id==='mention-row')?.mention_data).toEqual(next);
 act(()=>mockChannels[0].callbacks.UPDATE({new:{id:'mention-row',content:'Other text',mention_data:null}}));await flush();
 expect(f.chat.messages.find(m=>m.id==='mention-row')?.mention_data).toBeNull();
});

it.each(['content', 'image_url', 'id'] as const)('refuses a photo receipt with a different %s', async field => {
  const f = mount(); await flush();
  const row = { id: 'stable-photo', created_at: '2026-09-20T12:00:00Z', content: 'Caption', image_url: 'photo.jpg', [field]: 'different' };
  mockWrite.mockResolvedValueOnce({ data: row, error: null });
  mockReceipt.mockResolvedValueOnce({ data: row, error: null });
  await act(async () => { expect(await f.chat.sendMessage('Caption', 'photo.jpg', undefined, 'stable-photo')).toBe(false); });
  expect(f.chat.messages.some(row => row.id === 'stable-photo')).toBe(false);
});

it.each([true, false])('leaves media recovery to its scoped caller=%s without losing unscoped failure feedback', async scoped => {
  const f = mount(); await flush();
  mockWrite.mockResolvedValueOnce({ data: null, error: Error('Response lost') });
  mockReceipt.mockResolvedValueOnce({ data: null, error: Error('Receipt unavailable') });
  await act(async () => {
    expect(await f.chat.sendMessage('', 'gif.jpg', undefined, 'gif-send', scoped ? { userId: 'alice', isCurrent: () => true } : undefined)).toBe(false);
  });
  expect(f.chat.messages.some(row => row.id === 'optimistic-gif-send')).toBe(false);
  expect(Alert.alert).toHaveBeenCalledTimes(scoped ? 0 : 1);
});

it('recovers a timed-out photo insert using its exact receipt without another write', async () => {
  const f = mount(); await flush(); jest.useFakeTimers();
  try {
    const pending = deferred(); mockWrite.mockReturnValueOnce(pending.promise);
    mockReceipt.mockResolvedValueOnce({ data: { id: 'stable-photo', content: 'Caption', image_url: 'photo.jpg', created_at: '2026-09-20T12:00:00Z' }, error: null });
    let outcome: unknown; const work = start(async () => { outcome = await f.chat.sendMessage('Caption', 'photo.jpg', undefined, 'stable-photo'); }); await flush();
    await act(async () => jest.advanceTimersByTime(12000)); await flush(); await work;
    expect(outcome).toBe(true); expect(mockWrite).toHaveBeenCalledTimes(1);
    expect(mockReceipt).toHaveBeenCalledWith({id:'stable-photo',event_id:'plan-a',user_id:'alice'});
    await act(async () => pending.resolve({data:null,error:Error('Late response')}));
    expect(f.chat.messages.filter(row => row.id === 'stable-photo')).toHaveLength(1);
  } finally { jest.useRealTimers(); }
});


it.each(['id','message_type','audio_url','duration_seconds'] as const)('refuses a voice receipt with a different %s',async field=>{
 const f=mount();await flush();const row={id:'voice-id',created_at:'2026-09-21T00:00:00Z',message_type:'audio',audio_url:'voice.m4a',duration_seconds:7,[field]:field==='duration_seconds'?9:'different'};
 mockWrite.mockResolvedValueOnce({data:row,error:null});mockReceipt.mockResolvedValueOnce({data:row,error:null});
 await act(async()=>{expect(await f.chat.sendAudio('voice.m4a',7,undefined,'voice-id')).toBe(false);});
 expect(f.chat.messages.some(m=>m.id==='voice-id')).toBe(false);expect(Alert.alert).not.toHaveBeenCalled();
});
it.each([true,false])('bounds voice insert/receipt waits with receipt found=%s',async found=>{
 const f=mount();await flush();jest.useFakeTimers();try{
  const pending=deferred();mockWrite.mockReturnValueOnce(pending.promise);
  if(found)mockReceipt.mockResolvedValueOnce({data:{id:'voice-id',created_at:'2026-09-21T00:00:00Z',message_type:'audio',audio_url:'voice.m4a',duration_seconds:7},error:null});else mockReceipt.mockReturnValueOnce(new Promise(()=>{}));
  let outcome:unknown;const work=start(async()=>{outcome=await f.chat.sendAudio('voice.m4a',7,undefined,'voice-id');});await flush();
  await act(async()=>jest.advanceTimersByTime(12000));await flush();
  if(!found){await act(async()=>jest.advanceTimersByTime(8000));await flush();}await work;
  expect(outcome).toBe(found);expect(mockWrite).toHaveBeenCalledTimes(1);expect(mockReceipt).toHaveBeenCalledWith({id:'voice-id',event_id:'plan-a',user_id:'alice'});
  await act(async()=>pending.resolve({data:null,error:Error('Late response')}));await flush();
  expect(f.chat.messages.filter(m=>m.id==='voice-id')).toHaveLength(found?1:0);
 }finally{f.unmount();jest.useRealTimers();}
});

it.each(['id','message_type','content'] as const)('refuses a location receipt with different %s',async field=>{
 const f=mount();await flush();const row={id:'pin-id',created_at:'2026-09-21T00:00:00Z',message_type:'location',content:JSON.stringify({lat:1,lng:2,address:'Place'}),[field]:'different'};
 mockWrite.mockResolvedValueOnce({data:row,error:null});mockReceipt.mockResolvedValueOnce({data:row,error:null});
 await act(async()=>{expect(await f.chat.sendLocation(1,2,'Place',undefined,'pin-id')).toBe(false);});
 expect(f.chat.messages.some(m=>m.id==='pin-id')).toBe(false);expect(Alert.alert).not.toHaveBeenCalled();
});
it.each([true,false])('bounds location insert and receipt waits with receipt found=%s',async found=>{
 const f=mount();await flush();jest.useFakeTimers();try{
  const pending=deferred();mockWrite.mockReturnValueOnce(pending.promise);
  if(found)mockReceipt.mockResolvedValueOnce({data:{id:'pin-id',created_at:'2026-09-21T00:00:00Z',message_type:'location',content:JSON.stringify({lat:1,lng:2,address:'Place'})},error:null});else mockReceipt.mockReturnValueOnce(new Promise(()=>{}));
  let outcome:unknown;const work=start(async()=>{outcome=await f.chat.sendLocation(1,2,'Place',undefined,'pin-id');});await flush();
  await act(async()=>jest.advanceTimersByTime(12000));await flush();if(!found){await act(async()=>jest.advanceTimersByTime(8000));await flush();}await work;
  expect(outcome).toBe(found);expect(mockWrite).toHaveBeenCalledTimes(1);expect(mockReceipt).toHaveBeenCalledWith({id:'pin-id',event_id:'plan-a',user_id:'alice'});
  await act(async()=>pending.resolve({data:null,error:Error('Late response')}));await flush();expect(f.chat.messages.filter(m=>m.id==='pin-id')).toHaveLength(found?1:0);
 }finally{f.unmount();jest.useRealTimers();}
});

it.each(['photo','location','audio'] as const)('does not duplicate a late confirmed %s bubble during an explicit same-ID retry',async kind=>{
 const payload=kind==='photo'?{message_type:'user' as const,content:'Caption',image_url:'photo.jpg'}:kind==='location'?{message_type:'location' as const,content:JSON.stringify({lat:1,lng:2,address:'Place'})}:{message_type:'audio' as const,content:'',audio_url:'voice.m4a',duration_seconds:7};
 mockRead.mockResolvedValue(result([message('confirmed-id',payload)]));const f=mount();await flush();
 const pending=deferred();mockWrite.mockReturnValueOnce(pending.promise);mockReceipt.mockResolvedValueOnce({data:message('confirmed-id',payload),error:null});
 const work=start(()=>kind==='photo'?f.chat.sendMessage('Caption','photo.jpg',undefined,'confirmed-id'):kind==='location'?f.chat.sendLocation(1,2,'Place',undefined,'confirmed-id'):f.chat.sendAudio('voice.m4a',7,undefined,'confirmed-id'));await flush();
 expect(f.chat.messages.filter(m=>m.id==='confirmed-id'||m.id==='optimistic-confirmed-id')).toHaveLength(1);
 await act(async()=>{pending.resolve({data:null,error:Error('Already saved')});await work;});await flush();
 expect(f.chat.messages.filter(m=>m.id==='confirmed-id'||m.id==='optimistic-confirmed-id')).toHaveLength(1);
});


it.each(['event', 'circle'] as const)('bounds plain-text %s insert and receipt reads and retries the same original UUID', async kind => {
  const f = mount(); await flush();
  if (kind === 'circle') { f.navigate({ kind, id: 'circle-a' }); await flush(); }
  jest.useFakeTimers();
  try {
    const insert = deferred(), receipt = deferred();
    mockWrite.mockReturnValueOnce(insert.promise); mockReceipt.mockReturnValueOnce(receipt.promise);
    let outcome: unknown = 'pending';
    const owner = { userId: 'alice', isCurrent: () => true };
    const work = start(async () => { outcome = await f.chat.sendMessage('Original words', undefined, undefined, 'stable-text', owner); });
    await flush();
    await act(async () => jest.advanceTimersByTime(12000)); await flush();
    expect(mockReceipt).toHaveBeenCalledWith({ id: 'stable-text', [kind === 'circle' ? 'circle_id' : 'event_id']: kind === 'circle' ? 'circle-a' : 'plan-a', user_id: 'alice' });
    await act(async () => jest.advanceTimersByTime(8000)); await flush();
    expect(outcome).toBe(false); await work;
    expect(mockWrite).toHaveBeenCalledTimes(1); expect(Alert.alert).not.toHaveBeenCalled();
    // Explicit retry preserves the original identity. No automatic reinsert.
    await act(async () => { expect(await f.chat.sendMessage('Original words', undefined, undefined, 'stable-text', owner)).toBe(true); });
    expect(mockWrite.mock.calls.map(call => call[0])).toEqual([
      expect.objectContaining({ id: 'stable-text', content: 'Original words', user_id: 'alice' }),
      expect.objectContaining({ id: 'stable-text', content: 'Original words', user_id: 'alice' }),
    ]);
    await act(async () => { insert.resolve({ data: null, error: Error('Late old insert') }); receipt.resolve(success); });
    expect(f.chat.messages.filter(row => row.id === 'stable-text')).toHaveLength(1);
  } finally { f.unmount(); jest.useRealTimers(); }
});

it.each(['reply', 'mention'] as const)('recovers a stalled %s send from its original receipt without another insert', async mode => {
  const f = mount(); await flush(); jest.useFakeTimers();
  try {
    const insert = deferred(); mockWrite.mockReturnValueOnce(insert.promise);
    const content = mode === 'mention' ? '@Alex' : 'Reply words';
    mockReceipt.mockResolvedValueOnce({ data: { event_id: 'plan-a', user_id: 'alice', message_type: 'user', reply_to_message_id: mode === 'reply' ? 'old' : null, id: 'stable-context', created_at: '2026-09-27T12:00:00Z', content, ...(mode === 'mention' ? { mention_data: identityMention } : {}) }, error: null });
    let outcome: unknown = 'pending';
    const work = start(async () => { outcome = await f.chat.sendMessage(content, undefined, mode === 'reply' ? 'old' : undefined, 'stable-context', undefined, mode === 'mention' ? identityMention : undefined); });
    await flush(); await act(async () => jest.advanceTimersByTime(12000)); await flush();
    expect(outcome).toBe(true); await work; expect(mockWrite).toHaveBeenCalledTimes(1);
    expect(mockWrite.mock.calls[0][0]).toMatchObject(mode === 'reply' ? { reply_to_message_id: 'old' } : { mention_data: identityMention });
    await act(async () => insert.resolve({ data: null, error: Error('Late transport') }));
    expect(f.chat.messages.filter(row => row.id === 'stable-context')).toHaveLength(1);
  } finally { f.unmount(); jest.useRealTimers(); }
});

it.each(['original', 'privacy'] as const)('ends a stalled restored-reply %s check before dispatching a new message', async phase => {
  const f = mount(); await flush(); jest.useFakeTimers();
  try {
    if (phase === 'original') mockReceipt.mockReturnValueOnce(new Promise(() => {}));
    else { mockReceipt.mockResolvedValueOnce({ data: { id: 'older-reply', user_id: 'cedar', content: 'Original' }, error: null }); mockReplyBlocks.mockReturnValueOnce(new Promise(() => {})); }
    let outcome: unknown = 'pending';
    const work = start(async () => { try { await f.chat.sendMessage('Retained reply', undefined, 'older-reply', 'stable-reply'); } catch (error) { outcome = error; } });
    await flush(); await act(async () => jest.advanceTimersByTime(12000)); await flush();
    expect(outcome).toMatchObject({ name: 'RequestDeadlineError' }); await work;
    expect(mockWrite).not.toHaveBeenCalled(); expect(f.chat.messages.some(row => row.id === 'optimistic-stable-reply')).toBe(false);
  } finally { f.unmount(); jest.useRealTimers(); }
});

it('does not recover or alert a timed-out plain-text send after the account changes', async () => {
  const f = mount(); await flush(); jest.useFakeTimers();
  try {
    mockWrite.mockReturnValueOnce(new Promise(() => {}));
    const work = start(() => f.chat.sendMessage('Private original', undefined, undefined, 'old-account-send'));
    await flush(); emitIdentity('bob'); await flush();
    await act(async () => jest.advanceTimersByTime(12000)); await flush();
    expect(await work).toMatchObject({ name: 'ObsoleteChatOperationError' });
    expect(mockReceipt).not.toHaveBeenCalled(); expect(Alert.alert).not.toHaveBeenCalled();
    expect(f.chat.messages.some(row => row.id.includes('old-account-send'))).toBe(false);
  } finally { f.unmount(); jest.useRealTimers(); }
});


const reactionWrites = () => mockMutation.mock.calls.filter(call => call[0] === 'message_reactions');
it.each(['event', 'circle'] as const)('confirms committed %s reaction writes after response loss without another mutation', async kind => {
  for (const operation of ['insert', 'update', 'delete'] as const) {
    const fixture = mount(); await flush();
    if (kind === 'circle') { fixture.navigate({ kind, id: 'circle-b' }); await flush(); }
    mockMutation.mockClear(); mockReactionRead.mockClear();
    const before = operation === 'insert' ? [] : [{ id: 'reaction-id', reaction: operation === 'delete' ? '❤️' : '🔥' }];
    const after = operation === 'delete' ? [] : [{ id: 'reaction-id', reaction: '❤️' }];
    mockReactionRead.mockResolvedValueOnce({ data: before, error: null }).mockResolvedValueOnce({ data: after, error: null });
    mockMutation.mockResolvedValueOnce({ data: null, error: Error('Response lost after commit') });
    await act(async () => { await fixture.chat.toggleReaction('old', '❤️'); });
    expect(reactionWrites().map(call => call[1])).toEqual([operation]);
    expect(mockReactionRead).toHaveBeenCalledTimes(2);
    expect(mockReactionRead.mock.calls[1][0]).toEqual({ message_id: 'old', user_id: 'alice' });
    expect(fixture.chat.messages[0].reactions).toEqual(operation === 'delete' ? [] : [{ user_id: 'alice', reaction: '❤️' }]);
    fixture.unmount();
  }
});

it.each(['insert', 'delete'] as const)('keeps the original uncertain %s intent so explicit retry cannot invert a committed result', async operation => {
  const fixture = mount(); await flush(); mockMutation.mockClear();
  mockReactionRead.mockResolvedValueOnce({ data: operation === 'insert' ? [] : [{ id: 'reaction-id', reaction: '❤️' }], error: null })
    .mockResolvedValueOnce({ data: null, error: Error('Receipt offline') });
  mockMutation.mockResolvedValueOnce({ data: null, error: Error('Write response lost') });
  let failure: unknown; await act(async () => { failure = await fixture.chat.toggleReaction('old', '❤️').catch(error => error); });
  if (!isUnconfirmedChatReaction(failure)) throw Error('Expected uncertainty'); const retry = failure.retry;
  mockReactionRead.mockResolvedValueOnce({ data: operation === 'insert' ? [{ id: 'reaction-id', reaction: '❤️' }] : [], error: null });
  await act(async () => { await retry(); });
  expect(reactionWrites().map(call => call[1])).toEqual([operation]);
  expect(fixture.chat.messages[0].reactions).toEqual(operation === 'delete' ? [] : [{ user_id: 'alice', reaction: '❤️' }]);
});

it('a different failed selection retires an old alert retry', async () => {
  const fixture = mount(); await flush(); mockMutation.mockClear();
  mockReactionRead.mockResolvedValueOnce({ data: [], error: null }).mockResolvedValueOnce({ data: [], error: null });
  mockMutation.mockResolvedValueOnce({ data: null, error: Error('Unknown write') });
  let failure: unknown; await act(async () => { failure = await fixture.chat.toggleReaction('old', '❤️').catch(error => error); });
  if (!isUnconfirmedChatReaction(failure)) throw Error('Expected uncertainty'); const oldRetry = failure.retry;
  mockReactionRead.mockResolvedValueOnce({ data: null, error: Error('Read failed') });
  await act(async () => { await expect(fixture.chat.toggleReaction('old', '🔥')).rejects.toThrow('Read failed'); });
  const reads = mockReactionRead.mock.calls.length;
  await act(async () => { await expect(oldRetry()).rejects.toMatchObject({ name: 'ObsoleteChatOperationError' }); });
  expect(mockReactionRead).toHaveBeenCalledTimes(reads); expect(reactionWrites()).toHaveLength(1);
});

it('resumes a same-emoji gesture against a confirmed desired state without another write', async () => {
  const fixture = mount(); await flush(); mockMutation.mockClear();
  mockReactionRead.mockResolvedValueOnce({ data: [], error: null }).mockResolvedValueOnce({ data: null, error: Error('Receipt offline') });
  mockMutation.mockResolvedValueOnce({ data: null, error: Error('Write response lost') });
  await act(async () => { await fixture.chat.toggleReaction('old', '❤️').catch(() => {}); });
  mockReactionRead.mockResolvedValueOnce({ data: [{ id: 'reaction-id', reaction: '❤️' }], error: null });
  await act(async () => { await fixture.chat.toggleReaction('old', '❤️'); });
  expect(reactionWrites()).toHaveLength(1); expect(fixture.chat.messages[0].reactions).toEqual([{ user_id: 'alice', reaction: '❤️' }]);
});

it.each(['room ABA', 'account ABA', 'entry', 'unmount'] as const)('a retained uncertain reaction retry cannot dispatch after %s retirement', async change => {
  const fixture = mount(); await flush(); let entryCurrent = true;
  const scope = { userId: 'alice', isCurrent: () => entryCurrent };
  mockReactionRead.mockResolvedValueOnce({ data: [], error: null }).mockResolvedValueOnce({ data: null, error: Error('Receipt offline') });
  mockMutation.mockResolvedValueOnce({ data: null, error: Error('Response lost') });
  let failure: unknown; await act(async () => { failure = await fixture.chat.toggleReaction('old', '❤️', scope).catch(error => error); });
  if (!isUnconfirmedChatReaction(failure)) throw Error('Expected uncertainty'); const retry = failure.retry;
  if (change === 'room ABA') { fixture.navigate({ kind: 'circle', id: 'circle-b' }); await flush(); fixture.navigate({ kind: 'event', id: 'plan-a' }); }
  else if (change === 'account ABA') { emitIdentity('bob'); await flush(); emitIdentity('alice'); }
  else if (change === 'entry') entryCurrent = false;
  else fixture.unmount();
  await flush(); const reads = mockReactionRead.mock.calls.length, writes = reactionWrites().length;
  await act(async () => { await expect(retry()).rejects.toMatchObject({ name: 'ObsoleteChatOperationError' }); });
  expect(mockReactionRead).toHaveBeenCalledTimes(reads); expect(reactionWrites()).toHaveLength(writes);
});

it('bounds a stalled write at12s and ignores its late acknowledgement after a newer selection', async () => {
  jest.useFakeTimers();
  try {
    const fixture = mount(); await flush(); mockMutation.mockClear();
    const write = deferred(); mockMutation.mockReturnValueOnce(write.promise);
    mockReactionRead.mockResolvedValueOnce({ data: [], error: null }).mockResolvedValueOnce({ data: [{ id: 'reaction-id', reaction: '❤️' }], error: null });
    const first = start(() => fixture.chat.toggleReaction('old', '❤️')); await flush();
    await act(async () => { await jest.advanceTimersByTimeAsync(11_999); }); expect(mockReactionRead).toHaveBeenCalledTimes(1);
    await act(async () => { await jest.advanceTimersByTimeAsync(1); await first; }); expect(mockReactionRead).toHaveBeenCalledTimes(2);
    mockReactionRead.mockResolvedValueOnce({ data: [{ id: 'reaction-id', reaction: '❤️' }], error: null });
    await act(async () => { await fixture.chat.toggleReaction('old', '🔥'); });
    const count = reactionWrites().length;
    await act(async () => { write.resolve(success); });
    expect(reactionWrites()).toHaveLength(count); expect(fixture.chat.messages[0].reactions).toEqual([{ user_id: 'alice', reaction: '🔥' }]);
  } finally { jest.useRealTimers(); }
});

it('bounds a stalled receipt at8s and its late result cannot undo or unlock a newer reaction', async () => {
  jest.useFakeTimers();
  try {
    const fixture = mount(); await flush(); mockMutation.mockClear();
    const oldRead = deferred(), newRead = deferred();
    mockReactionRead.mockResolvedValueOnce({ data: [], error: null }).mockReturnValueOnce(oldRead.promise);
    mockMutation.mockResolvedValueOnce({ data: null, error: Error('Response lost') });
    const first = start(() => fixture.chat.toggleReaction('old', '❤️')); await flush();
    await act(async () => { await jest.advanceTimersByTimeAsync(8_000); }); expect(isUnconfirmedChatReaction(await first)).toBe(true);
    mockReactionRead.mockReturnValueOnce(newRead.promise); const second = start(() => fixture.chat.toggleReaction('old', '🔥')); await flush();
    await act(async () => { oldRead.resolve({ data: [{ id: 'reaction-id', reaction: '❤️' }], error: null }); await fixture.chat.toggleReaction('old', '👍'); });
    expect(mockReactionRead).toHaveBeenCalledTimes(3);
    await act(async () => { newRead.resolve({ data: [{ id: 'reaction-id', reaction: '❤️' }], error: null }); await second; });
    expect(fixture.chat.messages[0].reactions).toEqual([{ user_id: 'alice', reaction: '🔥' }]);
  } finally { jest.useRealTimers(); }
});


it('bounds a shared reaction preflight and a late read cannot write after explicit retry', async () => {
  jest.useFakeTimers();
  try {
    const fixture = mount(); await flush(); mockMutation.mockClear(); const late = deferred();
    mockReactionRead.mockReturnValueOnce(late.promise);
    const first = start(() => fixture.chat.toggleReaction('old', '❤️')); await flush();
    await act(async () => { await jest.advanceTimersByTimeAsync(12_000); });
    expect(await first).toMatchObject({ name: 'RequestDeadlineError' }); expect(reactionWrites()).toHaveLength(0);
    await act(async () => { await fixture.chat.toggleReaction('old', '🔥'); });
    const count = reactionWrites().length;
    await act(async () => { late.resolve({ data: [{ id: 'late-row', reaction: '❤️' }], error: null }); });
    expect(reactionWrites()).toHaveLength(count); expect(fixture.chat.messages[0].reactions).toEqual([{ user_id: 'alice', reaction: '🔥' }]);
  } finally { jest.useRealTimers(); }
});


it.each(['hook', 'caller'] as const)('edit failure uses the explicitly selected %s error presenter and restores the original', async errorPresentation => {
  const fixture = mount(); await flush();
  mockMutation.mockResolvedValueOnce({ data: null, error: new Error('Response lost') });
  await act(async () => {
    expect(await fixture.chat.editMessage('old', 'My revision', undefined, undefined, undefined, undefined, { errorPresentation })).toBe(false);
  });
  expect(fixture.chat.messages.find(row => row.id === 'old')?.content).toBe('old');
  if (errorPresentation === 'hook') expect(Alert.alert).toHaveBeenCalledWith('Could not edit', 'Something went wrong. Please try again.');
  else expect(Alert.alert).not.toHaveBeenCalled();
});

it.each(['hook', 'caller'] as const)('authoritative edit refusal remains thrown for the %s presenter', async errorPresentation => {
  const fixture = mount(); await flush();
  mockMutation.mockResolvedValueOnce({ data: { status: 'changed' }, error: null });
  await act(async () => {
    await expect(fixture.chat.editMessage('old', 'My revision', undefined, undefined, undefined, undefined, { errorPresentation })).rejects.toMatchObject({ name: 'ChatEditRefusedError' });
  });
  expect(fixture.chat.messages.find(row => row.id === 'old')?.content).toBe('old');
  expect(Alert.alert).not.toHaveBeenCalled();
});

it('caller-owned edit presentation cannot restore or report an old failure after account ABA', async () => {
  const fixture = mount(); await flush(); const mutation = deferred(); mockMutation.mockReturnValueOnce(mutation.promise);
  const pending = start(() => fixture.chat.editMessage('old', 'Edited', undefined, undefined, undefined, undefined, { errorPresentation: 'caller' })); await flush();
  emitIdentity('bob'); await flush(); mockRead.mockResolvedValue(result([message('new-alice')])); emitIdentity('alice'); await flush();
  let outcome: unknown; await act(async () => { mutation.resolve({ error: new Error('Old failure') }); outcome = await pending; });
  expect(isObsoleteChatOperation(outcome)).toBe(true);
  expect(fixture.chat.messages.map(row => row.id)).toEqual(['new-alice']);
  expect(Alert.alert).not.toHaveBeenCalled();
});


it.each([
  ['id', 'wrong-id'], ['event_id', 'wrong-room'], ['user_id', 'bob'],
  ['content', 'Different words'], ['message_type', 'system'],
  ['image_url', 'unexpected-photo.jpg'], ['reply_to_message_id', 'old'],
  ['mention_data', { invalid: true }],
])('does not confirm a text receipt with different %s on either insert or recovery', async (field, value) => {
  const row = message('stable-text', { content: 'Original words', [field as string]: value });
  mockWrite.mockResolvedValueOnce({ data: row, error: null });
  mockReceipt.mockResolvedValueOnce({ data: row, error: null });
  const f = mount(); await flush();
  await act(async () => { expect(await f.chat.sendMessage('Original words', undefined, undefined, 'stable-text')).toBe(false); });
  expect(mockWrite).toHaveBeenCalledTimes(1);
  expect(mockReceipt).toHaveBeenCalledWith({ id: 'stable-text', event_id: 'plan-a', user_id: 'alice' });
  expect(f.chat.messages.some(row => row.id === 'stable-text' || row.id === 'optimistic-stable-text')).toBe(false);
});

it.each(['event', 'circle'] as const)('confirms an exact %s text receipt immediately, without a recovery read', async kind => {
  const f = mount(); await flush();
  f.navigate({ kind, id: 'room-one' }); await flush();
  await act(async () => { expect(await f.chat.sendMessage('Original words', undefined, undefined, 'stable-text')).toBe(true); });
  expect(mockReceipt).not.toHaveBeenCalled();
  expect(mockWrite).toHaveBeenCalledTimes(1);
  expect(mockWrite.mock.calls[0][0]).toMatchObject({ [kind === 'event' ? 'event_id' : 'circle_id']: 'room-one' });
});

it('recovers an uncertain text insert from an exact receipt without sending twice', async () => {
  mockWrite.mockResolvedValueOnce({ data: null, error: Error('Lost acknowledgement') });
  mockReceipt.mockResolvedValueOnce({ data: message('stable-text', { content: 'Original words' }), error: null });
  const f = mount(); await flush();
  await act(async () => { expect(await f.chat.sendMessage('Original words', undefined, undefined, 'stable-text')).toBe(true); });
  expect(mockWrite).toHaveBeenCalledTimes(1);
  expect(mockReceipt).toHaveBeenCalledTimes(1);
  expect(f.chat.messages.filter(row => row.id === 'stable-text')).toHaveLength(1);
});

it.each([false, true])('bounds a stalled delete and respects account retirement (%s)', async retire => {
  jest.useFakeTimers();
  const deletion = deferred();
  let pending: Promise<unknown> | undefined;
  try {
    const fixture = mount(); await flush();
    mockMutation.mockReturnValueOnce(deletion.promise);
    let settled = false;
    pending = start(() => fixture.chat.deleteMessage('old')).then(value => {settled=true;return value;});
    await flush();
    if (retire) {emitIdentity('bob');await flush();}
    await act(async () => jest.advanceTimersByTime(12000)); await flush();
    expect(settled).toBe(true);
    const outcome = await pending;
    if (retire) {
      expect(outcome).toMatchObject({name:'ObsoleteChatOperationError'});
      expect(Alert.alert).not.toHaveBeenCalled();
    } else {
      expect(fixture.chat.messages.some(row => row.id === 'old')).toBe(true);
      expect(Alert.alert).toHaveBeenCalledWith('Removal not confirmed', expect.any(String));
    }
    expect(mockMutation).toHaveBeenCalledTimes(1);
    const before = fixture.chat.messages;
    await act(async () => deletion.resolve(success)); await flush();
    expect(fixture.chat.messages).toEqual(before);
  } finally {
    deletion.resolve(success); await flush(); await pending;
    jest.useRealTimers();
  }
});


describe('history reads across app suspension', () => {
  let appStateListeners: Set<(state: AppStateStatus) => void>;
  const changeState = (state: AppStateStatus) => {
    Object.defineProperty(AppState, 'currentState', { configurable: true, value: state });
    act(() => { appStateListeners.forEach(listener => listener(state)); });
  };
  beforeEach(() => {
    appStateListeners = new Set();
    Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
      appStateListeners.add(listener);
      return { remove: () => { appStateListeners.delete(listener); } };
    });
  });
  afterEach(() => {
    Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
    jest.useRealTimers();
  });

  it('retires an auth deadline on background without starting fallback work, then recovers on refresh', async () => {
    jest.useFakeTimers();
    const pending = deferred();
    mockAuth.mockResolvedValueOnce(identity('alice')).mockReturnValueOnce(pending.promise);
    const fixture = mount(); await flush();
    changeState('background');
    await act(async () => { await jest.advanceTimersByTimeAsync(12_000); });
    expect(mockSession).not.toHaveBeenCalled();
    expect(mockBlocks).not.toHaveBeenCalled();
    expect(logError).not.toHaveBeenCalled();
    expect(fixture.chat.loadError).toBe(false);
    changeState('active');
    await act(async () => { await fixture.chat.refetch(true); }); await flush();
    expect(fixture.chat.messages.map(row => row.id)).toEqual(['old']);
    expect(fixture.chat.loading).toBe(false);
  });

  it('does not dispatch background history or fallback reads, even on a realtime readiness callback', async () => {
    const fixture = mount(); await flush();
    changeState('background');
    mockAuth.mockClear(); mockRead.mockClear(); mockBlocks.mockClear(); mockSession.mockClear();
    await act(async () => { await fixture.chat.refetch(true); });
    await act(async () => { await mockChannels[mockChannels.length - 1].callbacks['undefined']?.({ status: 'ok', extension: 'postgres_changes' }); });
    expect(mockAuth).not.toHaveBeenCalled(); expect(mockRead).not.toHaveBeenCalled();
    expect(mockBlocks).not.toHaveBeenCalled(); expect(mockSession).not.toHaveBeenCalled();
    expect(fixture.chat.messages.map(row => row.id)).toEqual(['old']);
  });

  it('cannot apply a pre-suspension result after returning to active', async () => {
    const fixture = mount(); await flush();
    const pending = deferred(); mockRead.mockReturnValueOnce(pending.promise);
    let work!: Promise<void>;
    act(() => { work = fixture.chat.refetch(true); }); await flush();
    changeState('inactive'); changeState('background'); changeState('active');
    await act(async () => { pending.resolve(result([message('stale')])); await work; }); await flush();
    expect(fixture.chat.messages.map(row => row.id)).toEqual(['old']);
    expect(logError).not.toHaveBeenCalled();
  });

  it('retains a confirmed send that finishes while history is suspended', async () => {
    const fixture = mount(); await flush();
    const pending = deferred(); mockWrite.mockReturnValueOnce(pending.promise);
    const sending = start(() => fixture.chat.sendMessage('Keep this send', undefined, undefined, 'stable-send'));
    await flush(); changeState('background');
    await act(async () => { pending.resolve({ data: message('stable-send', { content: 'Keep this send' }), error: null }); });
    expect(await sending).toBe(true);
    expect(mockWrite).toHaveBeenCalledTimes(1);
    expect(fixture.chat.messages.some(row => row.id === 'stable-send')).toBe(true);
  });

  it('does not publish a hydration timeout after suspension and keeps loaded history', async () => {
    jest.useFakeTimers(); mockProfiles.mockReturnValueOnce(deferred().promise);
    const fixture = mount(); await flush();
    expect(fixture.chat.messages.map(row => row.id)).toEqual(['old']);
    changeState('background');
    await act(async () => { await jest.advanceTimersByTimeAsync(12_000); });
    expect(logError).not.toHaveBeenCalled(); expect(fixture.chat.loadError).toBe(false);
    expect(fixture.chat.messages.map(row => row.id)).toEqual(['old']);
  });

  it('defers an initial background history load until the existing foreground refresh', async () => {
    changeState('background');
    const fixture = mount(); await flush();
    expect(mockRead).not.toHaveBeenCalled(); expect(mockBlocks).not.toHaveBeenCalled();
    changeState('active');
    await act(async () => { await fixture.chat.refetch(true); }); await flush();
    expect(fixture.chat.messages.map(row => row.id)).toEqual(['old']);
    expect(fixture.chat.loading).toBe(false);
  });

  it('still reports a foreground identity timeout and preserves same-account fallback', async () => {
    jest.useFakeTimers();
    mockAuth.mockResolvedValueOnce(identity('alice')).mockReturnValueOnce(deferred().promise);
    const fixture = mount(); await flush();
    await act(async () => { await jest.advanceTimersByTimeAsync(8_000); }); await flush();
    expect(logError).toHaveBeenCalledWith(expect.objectContaining({ name: 'RequestDeadlineError' }), 'useChat.fetchMessages.getUser');
    expect(mockSession).toHaveBeenCalledTimes(1);
    expect(fixture.chat.messages.map(row => row.id)).toEqual(['old']);
  });
  it('does not hydrate realtime messages or reactions while backgrounded', async () => {
    const fixture=mount(); await flush(); changeState('background'); mockProfiles.mockClear();
    await act(async()=>{
      await mockChannels.at(-1).callbacks.INSERT({new:message('new')});
      await mockChannels.at(-1).callbacks['*']({eventType:'INSERT',new:{message_id:'old'}});
    }); await flush();
    expect(mockProfiles).not.toHaveBeenCalled(); expect(mockRealtimeReactions).not.toHaveBeenCalled();
    expect(fixture.chat.messages.map(row=>row.id)).toEqual(['old']);
    changeState('active'); mockRead.mockResolvedValue(result([message('old'),message('new')]));
    await act(async()=>{await fixture.chat.refetch(true);}); await flush();
    expect(fixture.chat.messages.map(row=>row.id)).toEqual(['new','old']);
  });
  it('a realtime sender result from before suspension cannot reappear after foreground refresh', async () => {
    const fixture=mount(); await flush(); const pending=deferred(); mockProfiles.mockReturnValueOnce(pending.promise);
    const work=start(()=>mockChannels.at(-1).callbacks.INSERT({new:message('stale')})); await flush();
    changeState('background'); changeState('active');
    await act(async()=>{await fixture.chat.refetch(true);}); await flush();
    await act(async()=>{pending.resolve({data:[],error:null});await work;});
    expect(fixture.chat.messages.map(row=>row.id)).toEqual(['old']); expect(logError).not.toHaveBeenCalled();
  });
  it('retains history and offers retry when foreground realtime sender hydration fails', async () => {
    const fixture=mount(); await flush(); mockProfiles.mockResolvedValueOnce({data:null,error:{message:'AbortError: Aborted'}});
    await act(async()=>{await mockChannels.at(-1).callbacks.INSERT({new:message('new')});});
    expect(fixture.chat.messages.map(row=>row.id)).toEqual(['old']); expect(fixture.chat.loadError).toBe(true);
    expect(logError).toHaveBeenCalledWith(expect.objectContaining({message:'AbortError: Aborted'}),'useChat.realtimeSender');
    mockRead.mockResolvedValue(result([message('new')])); await act(async()=>{await fixture.chat.refetch(true);}); await flush();
    expect(fixture.chat.messages.map(row=>row.id)).toEqual(['new']); expect(fixture.chat.loadError).toBe(false);
  });
  it('retires a realtime sender timeout after suspension without publishing a false load failure', async () => {
    jest.useFakeTimers(); const fixture=mount(); await flush(); mockProfiles.mockReturnValueOnce(deferred().promise);
    const work=start(()=>mockChannels.at(-1).callbacks.INSERT({new:message('new')})); await flush();
    changeState('background'); changeState('active');
    await act(async()=>{await jest.advanceTimersByTimeAsync(12000);}); await work;
    expect(fixture.chat.loadError).toBe(false); expect(logError).not.toHaveBeenCalled();
  });
  it('retires realtime reaction snapshots across a background/foreground cycle', async () => {
    const fixture=mount(); await flush(); const pending=deferred(); mockRealtimeReactions.mockReturnValueOnce(pending.promise);
    act(()=>mockChannels.at(-1).callbacks['*']({eventType:'INSERT',new:{message_id:'old'}})); await flush();
    const [,isCurrent]=mockRealtimeReactions.mock.calls[0]; changeState('background'); changeState('active');
    expect(isCurrent()).toBe(false);
    await act(async()=>pending.resolve([{message_id:'old',user_id:'friend',reaction:'❤️'}])); await flush();
    expect(fixture.chat.messages[0].reactions).toEqual([]);
    mockRealtimeReactions.mockResolvedValue([{message_id:'old',user_id:'friend',reaction:'👍'}]);
    act(()=>mockChannels.at(-1).callbacks['*']({eventType:'INSERT',new:{message_id:'old'}})); await flush();
    expect(fixture.chat.messages[0].reactions).toEqual([{user_id:'friend',reaction:'👍'}]);
  });
  it('still exposes a foreground realtime reaction failure for explicit history recovery', async () => {
    const fixture=mount(); await flush(); mockRealtimeReactions.mockRejectedValueOnce(new Error('network request failed'));
    act(()=>mockChannels.at(-1).callbacks['*']({eventType:'INSERT',new:{message_id:'old'}})); await flush();
    expect(fixture.chat.loadError).toBe(true); expect(fixture.chat.messages.map(row=>row.id)).toEqual(['old']);
    expect(logError).toHaveBeenCalledWith(expect.any(Error),'useChat.realtimeReactions');
  });
  it('an older-page response cannot publish after suspension or block a new foreground page', async () => {
    const page=Array.from({length:60},(_,i)=>message('m'+i,{created_at:new Date(Date.UTC(2026,8,13,10,i)).toISOString()}));
    mockRead.mockResolvedValue(result(page)); const fixture=mount(); await flush();
    const pending=deferred(); mockRead.mockReturnValueOnce(pending.promise);
    const old=start(()=>fixture.chat.loadOlder()); await flush(); changeState('background');
    const reads=mockRead.mock.calls.length; await act(async()=>{await fixture.chat.loadOlder();}); expect(mockRead).toHaveBeenCalledTimes(reads);
    changeState('active'); mockRead.mockResolvedValueOnce(result([message('older',{created_at:'2026-09-12T00:00:00Z'})]));
    await act(async()=>{await fixture.chat.loadOlder();}); await flush();
    await act(async()=>{pending.resolve(result([message('stale')]));await old;});
    expect(fixture.chat.messages.some(row=>row.id==='older')).toBe(true); expect(fixture.chat.messages.some(row=>row.id==='stale')).toBe(false);
    expect(fixture.chat.olderLoadError).toBe(false);
  });

});
