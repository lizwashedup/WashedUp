import React from 'react';
import { AppState } from 'react-native';
import { act, create } from 'react-test-renderer';
import { useActiveChatPresence, type ActiveChatPresenceScope } from '../useActiveChatPresence';
import { logError } from '../../lib/logger';

let mockFocused = true;
const mockAuth = jest.fn(), mockWrite = jest.fn(), mockListeners = new Set<(state: string) => void>();
const extraTrees: Array<ReturnType<typeof create>> = [];
jest.mock('expo-router', () => ({ useFocusEffect: (callback: () => any) => require('react').useEffect(() => mockFocused ? callback() : undefined, [callback, mockFocused]) }));
jest.mock('../../lib/logger', () => ({ logError: jest.fn() }));
jest.mock('../../lib/supabase', () => ({ supabase: {
  auth: { getUser: () => mockAuth() },
  from: () => ({ update: (payload: unknown) => {
    const filters: Record<string, unknown> = {};
    const chain: any = { eq: (key: string, value: unknown) => { filters[key] = value; return chain; }, then: (yes: any, no: any) => Promise.resolve(mockWrite(payload, filters)).then(yes, no) };
    return chain;
  } }),
} }));
const identity = (id: string | null) => ({ data: { user: id ? { id } : null }, error: null });
function deferred<T = any>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
let currentScope: ActiveChatPresenceScope | null;
function scope(userId = 'alice'): ActiveChatPresenceScope { const next = { userId, isCurrent: () => currentScope === next }; return next; }
type Scene = { id?: string; scope: ActiveChatPresenceScope | null; enabled?: boolean };
let tree: ReturnType<typeof create> | null, currentScene: Scene;
function Harness({ scene }: { scene: Scene }) { useActiveChatPresence(scene.id, scene.scope, scene.enabled); return null; }
function mount(scene?: Scene) { currentScope = scene ? scene.scope : scope(); currentScene = scene ?? { id: 'plan-a', scope: currentScope }; act(() => { tree = create(<Harness scene={currentScene} />); }); }
function update(scene: Scene) { currentScope = scene.scope; currentScene = scene; act(() => tree!.update(<Harness scene={scene} />)); }
function focus(value: boolean) { mockFocused = value; act(() => tree!.update(<Harness scene={currentScene} />)); }
function appState(value: string) { (AppState as any).currentState = value; act(() => mockListeners.forEach(callback => callback(value))); }
async function flush() { await act(async () => { for (let i = 0; i < 70; i++) await Promise.resolve(); }); }
beforeEach(() => {
  jest.useFakeTimers();
  mockFocused = true; currentScope = null; tree = null; mockListeners.clear();
  mockAuth.mockReset().mockResolvedValue(identity('alice')); mockWrite.mockReset().mockResolvedValue({ error: null });
  (AppState as any).currentState = 'active';
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_kind, callback: any) => {
    mockListeners.add(callback); return { remove: () => mockListeners.delete(callback) };
  });
});
afterEach(async () => {
  act(() => { tree?.unmount(); extraTrees.splice(0).forEach(extra => extra.unmount()); });
  tree = null; await flush(); await jest.runAllTimersAsync(); await flush();
  jest.restoreAllMocks(); jest.useRealTimers();
});

it('clears a set that completes after focus was lost instead of stranding push suppression', async () => {
  const pending = deferred(); mockWrite.mockReturnValueOnce(pending.promise); mount(); await flush(); focus(false);
  await act(async () => { pending.resolve({ error: null }); }); await flush();
  expect(mockWrite).toHaveBeenLastCalledWith({ active_chat_event_id: null }, { id: 'alice', active_chat_event_id: 'plan-a' });
});

it('serializes old-room set/clear before the next room activation', async () => {
  const pending = deferred(); mockWrite.mockReturnValueOnce(pending.promise); mount(); await flush();
  update({ id: 'plan-b', scope: scope() }); await flush();
  expect(mockWrite).toHaveBeenCalledTimes(1);
  await act(async () => { pending.resolve({ error: null }); }); await flush();
  expect(mockWrite.mock.calls).toEqual([
    [{ active_chat_event_id: 'plan-a' }, { id: 'alice' }],
    [{ active_chat_event_id: null }, { id: 'alice', active_chat_event_id: 'plan-a' }],
    [{ active_chat_event_id: 'plan-b' }, { id: 'alice' }],
  ]);
});

it('does not adopt a different account returned by an internal auth read', async () => {
  mockAuth.mockResolvedValue(identity('bob')); mount(); await flush(); expect(mockWrite).not.toHaveBeenCalled();
});

it('does not activate when the app backgrounded during authentication', async () => {
  const auth = deferred(); mockAuth.mockReturnValueOnce(auth.promise); mount(); await flush(); appState('background');
  await act(async () => { auth.resolve(identity('alice')); }); await flush(); expect(mockWrite).not.toHaveBeenCalled();
});

it('captures the cleanup user and never clears the next account’s profile', async () => {
  mount(); await flush(); mockAuth.mockResolvedValue(identity('bob'));
  update({ id: 'plan-b', scope: scope('bob') }); await flush();
  expect(mockWrite.mock.calls.filter(([payload]) => payload.active_chat_event_id === null)).toEqual([]);
  expect(mockWrite).toHaveBeenLastCalledWith({ active_chat_event_id: 'plan-b' }, { id: 'bob' });
});

it('an unknown activation result remains eligible for a conditional cleanup', async () => {
  mockWrite.mockResolvedValueOnce({ error: new Error('Lost update response') }); mount(); await flush(); focus(false); await flush();
  expect(mockWrite).toHaveBeenLastCalledWith({ active_chat_event_id: null }, { id: 'alice', active_chat_event_id: 'plan-a' });
});

it.each([{ enabled: false }, { scope: null }, { id: undefined }])('does not start disabled or unknown presence: %j', missing => {
  mount({ id: 'plan-a', scope: scope(), ...missing }); expect(mockAuth).not.toHaveBeenCalled(); expect(mockWrite).not.toHaveBeenCalled();
});

it('preserves foreground activation and background conditional cleanup for an enabled plan', async () => {
  (AppState as any).currentState = 'background'; mount(); await flush(); expect(mockWrite).not.toHaveBeenCalled();
  appState('active'); await flush(); expect(mockWrite).toHaveBeenLastCalledWith({ active_chat_event_id: 'plan-a' }, { id: 'alice' });
  appState('background'); await flush(); expect(mockWrite).toHaveBeenLastCalledWith({ active_chat_event_id: null }, { id: 'alice', active_chat_event_id: 'plan-a' });
});

it('old ABA cleanup cannot clear a newer active visit to the same plan', async () => {
  const pending = deferred(); mockWrite.mockReturnValueOnce(pending.promise); mount(); await flush();
  update({ id: 'plan-b', scope: scope() }); update({ id: 'plan-a', scope: scope() });
  await act(async () => { pending.resolve({ error: null }); }); await flush();
  expect(mockWrite.mock.calls).toEqual([
    [{ active_chat_event_id: 'plan-a' }, { id: 'alice' }],
    [{ active_chat_event_id: 'plan-a' }, { id: 'alice' }],
  ]);
});

it('coordinates different mounted screen instances and preserves a newer same-plan owner', async () => {
  const readableScope = { userId: 'alice', isCurrent: () => true };
  mount({ id: 'plan-a', scope: readableScope }); await flush();
  act(() => { extraTrees.push(create(<Harness scene={{ id: 'plan-a', scope: readableScope }} />)); }); await flush();
  act(() => tree!.unmount()); tree = null; await flush();
  expect(mockWrite.mock.calls.filter(([payload]) => payload.active_chat_event_id === null)).toEqual([]);
});

it('transfers cleanup responsibility when a same-plan replacement cannot confirm its own activation', async () => {
  mount(); await flush();
  mockAuth.mockResolvedValueOnce(identity('alice')).mockResolvedValueOnce({ data: { user: null }, error: new Error('New activation unavailable') });
  update({ id: 'plan-a', scope: scope() }); await flush();
  expect(mockWrite).toHaveBeenCalledTimes(1);
  focus(false); await flush();
  expect(mockWrite).toHaveBeenLastCalledWith({ active_chat_event_id: null }, { id: 'alice', active_chat_event_id: 'plan-a' });
});

it('retired activation auth cannot continue a write across account ABA', async () => {
  const auth = deferred(); mockAuth.mockReturnValueOnce(auth.promise); mount(); await flush();
  mockAuth.mockResolvedValue(identity('bob')); update({ id: 'plan-b', scope: scope('bob') }); await flush();
  mockAuth.mockResolvedValue(identity('alice')); update({ id: 'plan-c', scope: scope('alice') }); await flush();
  await act(async () => { auth.resolve(identity('alice')); }); await flush();
  expect(mockWrite.mock.calls).toEqual([
    [{ active_chat_event_id: 'plan-b' }, { id: 'bob' }],
    [{ active_chat_event_id: 'plan-c' }, { id: 'alice' }],
  ]);
});

it('a pending background clear is skipped if the same owner foregrounds during auth', async () => {
  mount(); await flush(); const auth = deferred(); mockAuth.mockReturnValueOnce(auth.promise);
  appState('background'); await flush(); appState('active');
  await act(async () => { auth.resolve(identity('alice')); }); await flush();
  expect(mockWrite.mock.calls.every(([payload]) => payload.active_chat_event_id === 'plan-a')).toBe(true);
});

it('a failed cleanup remains retryable on the next lifecycle event', async () => {
  mount(); await flush(); mockWrite.mockResolvedValueOnce({ error: new Error('Offline') });
  appState('background'); await flush(); appState('background'); await flush();
  expect(mockWrite.mock.calls.filter(([payload]) => payload.active_chat_event_id === null)).toHaveLength(2);
});

it('unmounted listeners and authentication completions cannot restart presence', async () => {
  const auth = deferred(); mockAuth.mockReturnValueOnce(auth.promise); mount(); await flush();
  const oldListener = Array.from(mockListeners)[0]; act(() => tree!.unmount()); tree = null;
  act(() => oldListener('active')); await act(async () => { auth.resolve(identity('alice')); }); await flush();
  expect(mockWrite).not.toHaveBeenCalled(); expect(mockListeners.size).toBe(0);
});

it('handles rejected auth reads without an unhandled promise or wrong profile write', async () => {
  mockAuth.mockRejectedValueOnce(new Error('Auth unavailable')); mount(); await flush();
  expect(mockWrite).not.toHaveBeenCalled();
  appState('active'); await flush(); expect(mockWrite).toHaveBeenLastCalledWith({ active_chat_event_id: 'plan-a' }, { id: 'alice' });
});

const networkFailure = () => Object.assign(new Error('Network request failed'), { name: 'AuthRetryableFetchError' });
async function advance(milliseconds: number) {
  await act(async () => { await jest.advanceTimersByTimeAsync(milliseconds); });
  await flush();
}

it('recovers a transient identity failure while the same chat remains open', async () => {
  mockAuth.mockResolvedValueOnce({ data: { user: null }, error: networkFailure() });
  mount(); await flush(); expect(mockWrite).not.toHaveBeenCalled();
  await advance(600);
  expect(mockWrite).toHaveBeenCalledTimes(1);
  expect(mockWrite).toHaveBeenCalledWith({ active_chat_event_id: 'plan-a' }, { id: 'alice' });
  expect(logError).toHaveBeenCalledWith(expect.objectContaining({ name: 'AuthRetryableFetchError' }), 'useActiveChatPresence');
});

it('recovers a temporary getUser server error but does not retry a rejected identity', async () => {
  mockAuth.mockResolvedValueOnce({ data: { user: null }, error: { status: 500, message: 'context canceled' } })
    .mockResolvedValueOnce({ data: { user: null }, error: { status: 403, message: 'token is expired' } });
  mount(); await flush(); await advance(600); await advance(30000);
  expect(mockAuth).toHaveBeenCalledTimes(2);
  expect(mockWrite).not.toHaveBeenCalled();
});

it('stops a retry after the chat loses focus without writing stale presence', async () => {
  mockAuth.mockRejectedValueOnce(networkFailure()); mount(); await flush();
  focus(false); await advance(600);
  expect(mockAuth).toHaveBeenCalledTimes(1);
  expect(mockWrite).not.toHaveBeenCalled();
});

it('does not adopt a switched account when the retry resumes', async () => {
  mockAuth.mockRejectedValueOnce(networkFailure()); mount(); await flush();
  mockAuth.mockResolvedValue(identity('bob'));
  update({ id: 'plan-b', scope: scope('bob') }); await flush(); await advance(600);
  expect(mockWrite.mock.calls).toEqual([[{ active_chat_event_id: 'plan-b' }, { id: 'bob' }]]);
});

it('bounds persistent network failures instead of retrying forever', async () => {
  mockAuth.mockRejectedValue(networkFailure()); mount(); await flush();
  await advance(600); await advance(1800); await advance(60000);
  expect(mockAuth).toHaveBeenCalledTimes(3);
  expect(mockWrite).not.toHaveBeenCalled();
});

it('retries a lost cleanup response with the original account and room condition', async () => {
  mount(); await flush(); mockWrite.mockResolvedValueOnce({ error: networkFailure() });
  focus(false); await flush(); await advance(600);
  expect(mockWrite.mock.calls.slice(1)).toEqual([
    [{ active_chat_event_id: null }, { id: 'alice', active_chat_event_id: 'plan-a' }],
    [{ active_chat_event_id: null }, { id: 'alice', active_chat_event_id: 'plan-a' }],
  ]);
});

it('preserves a same-plan replacement when a retired cleanup retries', async () => {
  mount(); await flush(); mockAuth.mockRejectedValueOnce(networkFailure());
  focus(false); await flush();
  focus(true); await flush(); await advance(600);
  expect(mockWrite.mock.calls.every(([payload]) => payload.active_chat_event_id === 'plan-a')).toBe(true);
});

it('a stalled identity check cannot hold the presence queue forever or write after its deadline', async () => {
  const pending = deferred(); mockAuth.mockReturnValueOnce(pending.promise);
  mount(); await flush(); update({ id: 'plan-b', scope: scope() }); await flush();
  await advance(8000);
  expect(mockWrite.mock.calls).toEqual([[{ active_chat_event_id: 'plan-b' }, { id: 'alice' }]]);
  await act(async () => pending.resolve(identity('alice'))); await flush();
  expect(mockWrite).toHaveBeenCalledTimes(1);
});

const postgrestAbort = {code:'', details:'Error: Aborted', hint:'Request was aborted (timeout or manual cancellation)', message:'AbortError: Aborted'};
it('recovers the actual PostgREST abort shape when background presence cleanup times out', async () => {
  mount(); await flush(); mockWrite.mockResolvedValueOnce({error:postgrestAbort});
  appState('background'); await flush(); await advance(600);
  expect(mockWrite.mock.calls.slice(1)).toEqual([
    [{active_chat_event_id:null},{id:'alice',active_chat_event_id:'plan-a'}],
    [{active_chat_event_id:null},{id:'alice',active_chat_event_id:'plan-a'}],
  ]);
});
it('bounds repeated aborted writes and retains cleanup on the next focus change', async () => {
  mockWrite.mockResolvedValue({error:postgrestAbort}); mount(); await flush();
  await advance(600); await advance(1800); await advance(60000);
  expect(mockWrite).toHaveBeenCalledTimes(3);
  mockWrite.mockResolvedValue({error:null}); focus(false); await flush();
  expect(mockWrite).toHaveBeenLastCalledWith({active_chat_event_id:null},{id:'alice',active_chat_event_id:'plan-a'});
});
it('does not retry a permission refusal even when it includes an abort-shaped message', async () => {
  mockWrite.mockResolvedValue({error:{...postgrestAbort,status:403}}); mount(); await flush(); await advance(60000);
  expect(mockWrite).toHaveBeenCalledTimes(1);
});
it('an aborted activation rechecks the current account before retrying', async () => {
  mockWrite.mockResolvedValueOnce({error:postgrestAbort}); mount(); await flush();
  mockAuth.mockResolvedValue(identity('bob')); update({id:'plan-b',scope:scope('bob')}); await flush(); await advance(600);
  expect(mockWrite.mock.calls.filter(([,filters])=>filters.id==='alice')).toHaveLength(1);
  expect(mockWrite).toHaveBeenLastCalledWith({active_chat_event_id:'plan-b'},{id:'bob'});
});
