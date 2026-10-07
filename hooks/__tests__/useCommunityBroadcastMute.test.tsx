import React from 'react';
import { act, create } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';
import { getMyBroadcastMute, setBroadcastMute } from '../../lib/communityChat';
import { useObservedUser } from '../useObservedUser';
import { useCommunityBroadcastMute } from '../useCommunityBroadcastMute';

jest.mock('../../lib/supabase', () => ({
  supabase: { auth: { getUser: jest.fn(), onAuthStateChange: jest.fn() } },
}));
jest.mock('../../lib/communityChat', () => ({ getMyBroadcastMute: jest.fn(), setBroadcastMute: jest.fn() }));

const getUser = jest.mocked(supabase.auth.getUser);
const readMute = jest.mocked(getMyBroadcastMute);
const writeMute = jest.mocked(setBroadcastMute);
type UserResult = Awaited<ReturnType<typeof supabase.auth.getUser>>;
type Mute = ReturnType<typeof useCommunityBroadcastMute>;
type Viewer = ReturnType<typeof useObservedUser>;
let emitAuth!: (event: AuthChangeEvent, session: Session | null) => void;
let unsubscribe: jest.Mock;
let saved: boolean;
const user = (id: string | null) => ({ data: { user: id ? { id } : null }, error: null }) as UserResult;
const session = (id: string | null) => id ? { user: { id } } as Session : null;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}

const cleanup: Array<() => void> = [];
function mount(communityId = 'room-a') {
  const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0, gcTime: Infinity } } });
  let mute!: Mute;
  let viewer!: Viewer;
  let renderer!: ReturnType<typeof create>;
  let unmounted = false;
  function Harness({ id }: { id: string }) {
    viewer = useObservedUser();
    mute = useCommunityBroadcastMute(id, viewer);
    return null;
  }
  const tree = (id: string) => <QueryClientProvider client={client}><Harness id={id} /></QueryClientProvider>;
  act(() => { renderer = create(tree(communityId)); });
  const unmount = () => {
    if (!unmounted) act(() => renderer.unmount());
    unmounted = true;
  };
  cleanup.push(() => { unmount(); client.clear(); });
  return {
    client,
    get mute() { return mute; },
    get viewer() { return viewer; },
    navigate: (id: string) => act(() => renderer.update(tree(id))),
    unmount,
  };
}

async function flush() {
  for (let i = 0; i < 4; i++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  }
}
async function auth(id: string | null, event: AuthChangeEvent = id ? 'SIGNED_IN' : 'SIGNED_OUT') {
  act(() => emitAuth(event, session(id)));
  await flush();
}

beforeEach(() => {
  jest.resetAllMocks();
  saved = false;
  unsubscribe = jest.fn();
  jest.mocked(supabase.auth.onAuthStateChange).mockImplementation(callback => {
    emitAuth = callback;
    return { data: { subscription: { id: 'mute-test', callback, unsubscribe } } };
  });
  getUser.mockResolvedValue(user('alice'));
  readMute.mockImplementation(async () => saved);
  writeMute.mockImplementation(async (_id, desired) => { saved = desired; });
});
afterEach(async () => {
  cleanup.splice(0).forEach(close => close());
  await flush();
});

it('recovers an initial identity failure without leaving the retry control disabled', async () => {
  getUser.mockRejectedValueOnce(new Error('Temporary network failure'));
  const fixture = mount();
  await flush();
  expect(fixture.viewer.error).toBeTruthy();
  expect(fixture.mute.isChecking).toBe(false);
  expect(fixture.mute.muted).toBeUndefined();
  expect(readMute).not.toHaveBeenCalled();
  await act(async () => { await fixture.mute.toggle(); });
  await flush();
  expect(getUser).toHaveBeenCalledTimes(2);
  expect(fixture.mute.ready).toBe(true);
  expect(writeMute).not.toHaveBeenCalled();
  await act(async () => { expect(await fixture.mute.toggle()).toEqual({ matched: true, value: true }); });
  await flush();
  expect(fixture.mute.muted).toBe(true);
});

it('does not mistake a disabled signed-out query for an in-progress settings read', async () => {
  getUser.mockResolvedValue(user(null));
  const fixture = mount();
  await flush();
  expect(fixture.mute.isChecking).toBe(false);
  expect(fixture.mute.ready).toBe(false);
  await act(async () => { await fixture.mute.toggle(); });
  expect(getUser).toHaveBeenCalledTimes(2);
  expect(writeMute).not.toHaveBeenCalled();
});

it('ignores a late initial identity read after an auth event and keeps same-account refresh stable', async () => {
  const initial = deferred<UserResult>();
  getUser.mockReturnValue(initial.promise);
  const fixture = mount();
  await auth('bob');
  const epoch = fixture.viewer.epoch;
  const readCount = readMute.mock.calls.length;
  initial.resolve(user('alice'));
  await flush();
  expect(fixture.viewer.viewerId).toBe('bob');
  await auth('bob', 'TOKEN_REFRESHED');
  expect(fixture.viewer.epoch).toBe(epoch);
  expect(readMute).toHaveBeenCalledTimes(readCount);
  expect(readMute).toHaveBeenLastCalledWith('room-a', 'bob');
});

it('never resurrects a pending attempt after room A → B → A navigation', async () => {
  const fixture = mount();
  await flush();
  const pending = deferred<void>();
  writeMute.mockReturnValueOnce(pending.promise);
  let operation!: ReturnType<Mute['toggle']>;
  act(() => { operation = fixture.mute.toggle(); });
  await flush();
  expect(fixture.mute.isChecking).toBe(true);
  fixture.navigate('room-b');
  await flush();
  fixture.navigate('room-a');
  await flush();
  expect(fixture.mute.isChecking).toBe(false);
  expect(fixture.mute.muted).toBe(false);
  await act(async () => { pending.resolve(); expect(await operation).toBeUndefined(); });
  await flush();
  expect(fixture.mute.isChecking).toBe(false);
  await act(async () => { expect(await fixture.mute.toggle()).toEqual({ matched: true, value: true }); });
});

it('prevents a pending preflight from writing after account A → B → A', async () => {
  const fixture = mount();
  await flush();
  const pending = deferred<boolean>();
  readMute.mockReturnValueOnce(pending.promise);
  let operation!: ReturnType<Mute['toggle']>;
  act(() => { operation = fixture.mute.toggle(); });
  await auth('bob');
  await auth('alice');
  expect(fixture.mute.isChecking).toBe(false);
  await act(async () => { pending.resolve(false); expect(await operation).toBeUndefined(); });
  expect(writeMute).not.toHaveBeenCalled();
});

it('serializes rapid taps before React has rendered the busy state', async () => {
  const fixture = mount();
  await flush();
  let first!: ReturnType<Mute['toggle']>;
  let second!: ReturnType<Mute['toggle']>;
  act(() => { first = fixture.mute.toggle(); second = fixture.mute.toggle(); });
  await act(async () => { expect(await first).toEqual({ matched: true, value: true }); expect(await second).toBeUndefined(); });
  expect(writeMute).toHaveBeenCalledTimes(1);
});

it('shows the actual saved value after a write mismatch rather than confirming the requested value', async () => {
  writeMute.mockResolvedValue(undefined);
  const fixture = mount();
  await flush();
  await act(async () => { expect(await fixture.mute.toggle()).toEqual({ matched: false, value: false }); });
  await flush();
  expect(fixture.mute.muted).toBe(false);
  expect(fixture.mute.ready).toBe(true);
});

it('requires a read-only retry after uncertain readback and never toggles from an unknown value', async () => {
  const fixture = mount();
  await flush();
  readMute.mockResolvedValueOnce(false).mockRejectedValueOnce(new Error('Readback unavailable'));
  await act(async () => { expect(await fixture.mute.toggle()).toEqual({ matched: false, value: null }); });
  await flush();
  expect(fixture.mute.muted).toBeUndefined();
  expect(fixture.mute.isChecking).toBe(false);
  await act(async () => { await fixture.mute.toggle(); });
  await flush();
  expect(fixture.mute.muted).toBe(true);
  expect(writeMute).toHaveBeenCalledTimes(1);
});

it('keeps an initial preference failure retryable', async () => {
  readMute.mockRejectedValue(new Error('Settings unavailable'));
  const fixture = mount();
  await flush();
  expect(fixture.mute.isChecking).toBe(false);
  expect(fixture.mute.ready).toBe(false);
  readMute.mockResolvedValue(true);
  await act(async () => { await fixture.mute.toggle(); });
  await flush();
  expect(fixture.mute.muted).toBe(true);
  expect(writeMute).not.toHaveBeenCalled();
});

it('prevents a delayed background read from replacing the confirmed saved preference', async () => {
  const fixture = mount();
  await flush();
  const background = deferred<boolean>();
  readMute.mockReturnValueOnce(background.promise);
  let refresh!: Promise<void>;
  let operation!: ReturnType<Mute['toggle']>;
  // Start the refresh and tap before its fetching state has rendered.
  act(() => {
    refresh = fixture.client.refetchQueries({ queryKey: ['community-mute'] });
    operation = fixture.mute.toggle();
  });
  await act(async () => { expect(await operation).toEqual({ matched: true, value: true }); });
  await act(async () => { background.resolve(false); await refresh; });
  await flush();
  expect(fixture.mute.muted).toBe(true);
  expect(fixture.mute.isChecking).toBe(false);
});

it('does not expose a delayed settings result after signing out', async () => {
  const pending = deferred<boolean>();
  readMute.mockReturnValue(pending.promise);
  const fixture = mount();
  await flush();
  await auth(null);
  pending.resolve(true);
  await flush();
  expect(fixture.mute.muted).toBeUndefined();
  expect(fixture.mute.isChecking).toBe(false);
});

it('ignores a pending write result after unmount and unsubscribes its identity listener', async () => {
  const fixture = mount();
  await flush();
  const pending = deferred<void>();
  writeMute.mockReturnValueOnce(pending.promise);
  let operation!: ReturnType<Mute['toggle']>;
  act(() => { operation = fixture.mute.toggle(); });
  await flush();
  fixture.unmount();
  pending.resolve();
  expect(await operation).toBeUndefined();
  expect(unsubscribe).toHaveBeenCalledTimes(1);
});
