import React from 'react';
import { act, create } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';
import { getMyTopicMute, setMyTopicMute, type TopicNotificationScope } from '../../lib/topicNotificationPreference';
import { useObservedUser } from '../useObservedUser';
import { useCommunityTopicMute } from '../useCommunityTopicMute';

jest.mock('../../lib/supabase', () => ({ supabase: { auth: { getUser: jest.fn(), onAuthStateChange: jest.fn() } } }));
jest.mock('../../lib/topicNotificationPreference', () => ({ getMyTopicMute: jest.fn(), setMyTopicMute: jest.fn() }));
const getUser = jest.mocked(supabase.auth.getUser);
const read = jest.mocked(getMyTopicMute);
const write = jest.mocked(setMyTopicMute);
type Mute = ReturnType<typeof useCommunityTopicMute>;
type Viewer = ReturnType<typeof useObservedUser>;
type UserResult = Awaited<ReturnType<typeof supabase.auth.getUser>>;
const user = (id: string | null) => ({ data: { user: id ? { id } : null }, error: null }) as UserResult;
let emitAuth!: (event: AuthChangeEvent, session: Session | null) => void;
let unsubscribe: jest.Mock;
let saved: Map<string, boolean>;
const key = (scope: TopicNotificationScope) => `${scope.userId}:${scope.topicId}`;
const cleanup: Array<() => void> = [];
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0, gcTime: Infinity } } });
  let mute!: Mute, viewer!: Viewer, tree!: ReturnType<typeof create>;
  let unmounted = false;
  function Harness({ id }: { id: string }) { viewer = useObservedUser(); mute = useCommunityTopicMute(id, viewer); return null; }
  const element = (id: string) => <QueryClientProvider client={client}><Harness id={id} /></QueryClientProvider>;
  act(() => { tree = create(element('persistent-a')); });
  const unmount = () => { if (!unmounted) act(() => tree.unmount()); unmounted = true; };
  cleanup.push(() => { unmount(); client.clear(); });
  return { client, get mute() { return mute; }, get viewer() { return viewer; }, navigate: (id: string) => act(() => tree.update(element(id))), unmount };
}
async function flush() {
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}
async function auth(id: string | null) {
  act(() => emitAuth(id ? 'SIGNED_IN' : 'SIGNED_OUT', id ? { user: { id } } as Session : null));
  await flush();
}
beforeEach(() => {
  jest.resetAllMocks(); saved = new Map(); unsubscribe = jest.fn();
  jest.mocked(supabase.auth.onAuthStateChange).mockImplementation(callback => {
    emitAuth = callback;
    return { data: { subscription: { id: 'topic-mute', callback, unsubscribe } } };
  });
  getUser.mockResolvedValue(user('alice'));
  read.mockImplementation(async scope => saved.get(key(scope)) ?? false);
  write.mockImplementation(async (scope, desired) => { saved.set(key(scope), desired); });
});
afterEach(async () => { cleanup.splice(0).forEach(close => close()); await flush(); });

it('retries a failed identity read without writing a preference', async () => {
  getUser.mockRejectedValueOnce(new Error('Offline'));
  const fixture = mount(); await flush();
  expect(fixture.mute.ready).toBe(false);
  expect(fixture.mute.isChecking).toBe(false);
  expect(read).not.toHaveBeenCalled();
  await act(async () => { await fixture.mute.toggle(); }); await flush();
  expect(fixture.mute.ready).toBe(true);
  expect(write).not.toHaveBeenCalled();
});

it('does not query or write for a signed-out viewer', async () => {
  getUser.mockResolvedValue(user(null));
  const fixture = mount(); await flush();
  expect(fixture.mute.isChecking).toBe(false);
  expect(fixture.mute.muted).toBeUndefined();
  await act(async () => { await fixture.mute.toggle(); });
  expect(read).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
});

it('requires a read-only retry after an uncertain write/readback', async () => {
  const fixture = mount(); await flush();
  read.mockRejectedValueOnce(new Error('Readback unavailable'));
  await act(async () => { expect(await fixture.mute.toggle()).toEqual({ value: null, matched: false }); });
  await flush();
  expect(fixture.mute.muted).toBeUndefined();
  await act(async () => { await fixture.mute.toggle(); }); await flush();
  expect(fixture.mute.muted).toBe(true);
  expect(write).toHaveBeenCalledTimes(1);
});

it('confirms a saved value after a lost write response without writing again', async () => {
  const fixture = mount(); await flush();
  write.mockImplementationOnce(async (scope, desired) => { saved.set(key(scope), desired); throw new Error('Response lost'); });
  await act(async () => { expect(await fixture.mute.toggle()).toEqual({ value: true, matched: true }); });
  await flush(); expect(fixture.mute.muted).toBe(true); expect(write).toHaveBeenCalledTimes(1);
});

it('shows the authoritative mismatch instead of claiming the requested change saved', async () => {
  const fixture = mount(); await flush();
  write.mockResolvedValueOnce(undefined);
  await act(async () => { expect(await fixture.mute.toggle()).toEqual({ value: false, matched: false }); });
  await flush(); expect(fixture.mute.muted).toBe(false);
});

it.each(['room', 'account'])('ignores a pending write after %s A → B → A and permits a new attempt', async transition => {
  const fixture = mount(); await flush();
  const pending = deferred<void>(); write.mockReturnValueOnce(pending.promise);
  let operation!: ReturnType<Mute['toggle']>;
  act(() => { operation = fixture.mute.toggle(); }); await flush();
  if (transition === 'room') {
    fixture.navigate('event-b'); await flush(); fixture.navigate('persistent-a'); await flush();
  } else { await auth('bob'); await auth('alice'); }
  expect(fixture.mute.isChecking).toBe(false);
  await act(async () => { pending.resolve(); expect(await operation).toBeUndefined(); });
  await act(async () => { expect(await fixture.mute.toggle()).toEqual({ value: true, matched: true }); });
});

it('ignores an initial preference result after signout', async () => {
  const pending = deferred<boolean>(); read.mockReturnValueOnce(pending.promise);
  const fixture = mount(); await flush(); await auth(null);
  pending.resolve(true); await flush();
  expect(fixture.mute.muted).toBeUndefined(); expect(fixture.mute.isChecking).toBe(false);
});

it('cannot overwrite a confirmed change with a background query started before its tap', async () => {
  const fixture = mount(); await flush();
  const pending = deferred<boolean>(); read.mockReturnValueOnce(pending.promise);
  let refresh!: Promise<void>, operation!: ReturnType<Mute['toggle']>;
  act(() => {
    refresh = fixture.client.refetchQueries({ queryKey: ['topic-mute'] });
    operation = fixture.mute.toggle();
  });
  await act(async () => { expect(await operation).toEqual({ value: true, matched: true }); });
  await act(async () => { pending.resolve(false); await refresh; }); await flush();
  expect(fixture.mute.muted).toBe(true);
});

it('keeps event and persistent topic preferences independent for the same account', async () => {
  const fixture = mount(); await flush();
  await act(async () => { await fixture.mute.toggle(); });
  fixture.navigate('event-b'); await flush();
  expect(fixture.mute.muted).toBe(false);
  await act(async () => { await fixture.mute.toggle(); });
  fixture.navigate('persistent-a'); await flush();
  expect(fixture.mute.muted).toBe(true);
  expect(saved).toEqual(new Map([['alice:persistent-a', true], ['alice:event-b', true]]));
});

it('discards a pending outcome after unmount and cleans up the identity listener', async () => {
  const fixture = mount(); await flush();
  const pending = deferred<void>(); write.mockReturnValueOnce(pending.promise);
  let operation!: ReturnType<Mute['toggle']>;
  act(() => { operation = fixture.mute.toggle(); }); await flush(); fixture.unmount();
  pending.resolve(); expect(await operation).toBeUndefined(); expect(unsubscribe).toHaveBeenCalledTimes(1);
});
