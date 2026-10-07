import React from 'react';
import { act, create } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';
import { getCommunityChatRows, type CommunityChatRowData } from '../../lib/communityChat';
import { getCommunityInboxNotificationState } from '../../lib/communityChatNotificationState';
import { getCommunityRoomInboxRows } from '../../lib/communityRoomInbox';
import { useCommunityChatRows } from '../useCommunityChatRows';

jest.mock('../../lib/supabase', () => ({
  supabase: { auth: { getSession: jest.fn(), onAuthStateChange: jest.fn() } },
}));
jest.mock('../../lib/communityChat', () => ({ getCommunityChatRows: jest.fn() }));

jest.mock('../../lib/communityRoomInbox', () => ({ getCommunityRoomInboxRows: jest.fn() }));
jest.mock('../../lib/communityChatNotificationState', () => ({ getCommunityInboxNotificationState: jest.fn(async rows => rows) }));
const getNotificationRows = jest.mocked(getCommunityInboxNotificationState);
const getMappedRows = jest.mocked(getCommunityRoomInboxRows);
const getSession = jest.mocked(supabase.auth.getSession);
const onAuthStateChange = jest.mocked(supabase.auth.onAuthStateChange);
const getRows = jest.mocked(getCommunityChatRows);
type SessionResult = Awaited<ReturnType<typeof supabase.auth.getSession>>;
type Result = ReturnType<typeof useCommunityChatRows>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const session = (id: string | null) => id ? { user: { id } } as Session : null;
const sessionResult = (id: string | null): SessionResult => {
  const value = session(id);
  return value ? { data: { session: value }, error: null } : { data: { session: null }, error: null };
};
const rows = (id: string): CommunityChatRowData[] => [{
  key: `community:${id}`, kind: 'community', targetId: id, communityId: id,
  title: id, secondary: null, preview: `Private to ${id}`, lastAt: null,
  unread: 1, accent: null, image: null,
}];

let emitAuth!: (event: AuthChangeEvent, value: Session | null) => void;
let unsubscribe: jest.Mock;
type Fixture = {
  client: QueryClient;
  readonly result: Result;
  setEnabled: (active: boolean) => void;
  unmount: () => void;
};
const fixtures: Fixture[] = [];

function mount(enabled = true, mapped = false): Fixture {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  let result!: Result;
  let renderer!: ReturnType<typeof create>;
  function Harness({ active }: { active: boolean }) {
    result = useCommunityChatRows(active, mapped);
    return null;
  }
  const tree = (active: boolean) => <QueryClientProvider client={client}><Harness active={active} /></QueryClientProvider>;
  act(() => { renderer = create(tree(enabled)); });
  const fixture = {
    client,
    get result() { return result; },
    setEnabled: (active: boolean) => act(() => renderer.update(tree(active))),
    unmount: () => act(() => renderer.unmount()),
  };
  fixtures.push(fixture);
  return fixture;
}

async function flush() {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}
async function emit(id: string | null, event: AuthChangeEvent = id ? 'SIGNED_IN' : 'SIGNED_OUT') {
  act(() => emitAuth(event, session(id)));
  await flush();
}
function keys(fixture: ReturnType<typeof mount>) {
  return fixture.client.getQueryCache().findAll({ queryKey: ['community-chat-rows'] }).map(query => query.queryKey);
}

beforeEach(() => {
  jest.clearAllMocks();
  unsubscribe = jest.fn();
  onAuthStateChange.mockImplementation(callback => {
    emitAuth = callback;
    return { data: { subscription: { id: 'test-auth-listener', callback, unsubscribe } } };
  });
  getSession.mockResolvedValue(sessionResult(null));
  getRows.mockResolvedValue([]);
  getMappedRows.mockImplementation(async input => [...input]);
});

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    fixture.unmount();
    fixture.client.clear();
  }
  await flush();
});

it('does not fetch without a session, including manual refetch', async () => {
  const fixture = mount();
  expect(fixture.result.viewerId).toBeUndefined();
  expect(fixture.result.isLoading).toBe(true);
  await flush();
  expect(fixture.result.viewerId).toBeNull();
  expect(fixture.result.isLoading).toBe(false);
  await fixture.result.refetch();
  expect(getRows).not.toHaveBeenCalled();
  expect(fixture.result.data).toBeUndefined();
});

it('tracks the session while disabled but fetches only after enabling', async () => {
  getSession.mockResolvedValue(sessionResult('a'));
  getRows.mockResolvedValue(rows('a'));
  const fixture = mount(false);
  await flush();
  expect(fixture.result.viewerId).toBe('a');
  expect(fixture.result.isLoading).toBe(false);
  await fixture.result.refetch();
  expect(getRows).not.toHaveBeenCalled();
  fixture.setEnabled(true);
  await flush();
  expect(getRows).toHaveBeenCalledTimes(1);
  expect(fixture.result.data).toEqual(rows('a'));
});

it('ignores a stale initial session read after a newer account event', async () => {
  const initial = deferred<SessionResult>();
  getSession.mockReturnValue(initial.promise);
  getRows.mockResolvedValue(rows('b'));
  const fixture = mount();
  await emit('b');
  expect(fixture.result.viewerId).toBe('b');
  initial.resolve(sessionResult('a'));
  await flush();
  expect(fixture.result.viewerId).toBe('b');
  expect(fixture.result.data).toEqual(rows('b'));
  expect(getRows).toHaveBeenCalledTimes(1);
  expect(keys(fixture)).not.toContainEqual(['community-chat-rows', 'a', 1]);
});

it('does not rotate the account epoch or fetch again on same-account token refresh', async () => {
  getSession.mockResolvedValue(sessionResult('a'));
  getRows.mockResolvedValue(rows('a'));
  const fixture = mount();
  await flush();
  const before = keys(fixture);
  await emit('a', 'TOKEN_REFRESHED');
  expect(keys(fixture)).toEqual(before);
  expect(getRows).toHaveBeenCalledTimes(1);
  expect(getSession).toHaveBeenCalledTimes(1);
});

it('hides previous data immediately on sign-out and rejects its late response', async () => {
  getSession.mockResolvedValue(sessionResult('a'));
  const pending = deferred<CommunityChatRowData[]>();
  getRows.mockReturnValue(pending.promise);
  const fixture = mount();
  await flush();
  const oldRefetch = fixture.result.refetch;
  await emit(null);
  pending.resolve(rows('a'));
  await flush();
  await oldRefetch();
  expect(fixture.result.viewerId).toBeNull();
  expect(fixture.result.data).toBeUndefined();
  expect(fixture.result.error).toBeNull();
  expect(getRows).toHaveBeenCalledTimes(1);
  expect(fixture.client.getQueryData(['community-chat-rows', 'a', 1])).toBeUndefined();
});

it('keeps A → B → A results distinct even when the abandoned requests finish last', async () => {
  getSession.mockResolvedValue(sessionResult('a'));
  const firstA = deferred<CommunityChatRowData[]>();
  const firstB = deferred<CommunityChatRowData[]>();
  const secondA = deferred<CommunityChatRowData[]>();
  getRows.mockReturnValueOnce(firstA.promise).mockReturnValueOnce(firstB.promise).mockReturnValueOnce(secondA.promise);
  const fixture = mount();
  await flush();
  await emit('b');
  expect(fixture.result.data).toBeUndefined();
  await emit('a');
  secondA.resolve(rows('a-current'));
  await flush();
  firstB.resolve(rows('b-stale'));
  firstA.resolve(rows('a-stale'));
  await flush();
  expect(fixture.result.data).toEqual(rows('a-current'));
  expect(fixture.client.getQueryData(['community-chat-rows', 'a', 1])).toBeUndefined();
  expect(fixture.client.getQueryData(['community-chat-rows', 'b', 2])).toBeUndefined();
  expect(fixture.client.getQueryData(['community-chat-rows', 'a', 3])).toEqual(rows('a-current'));
  expect(getRows).toHaveBeenCalledTimes(3);
});

it('does not expose cached previous-account rows after switching and retains prefix invalidation', async () => {
  getSession.mockResolvedValue(sessionResult('a'));
  getRows.mockResolvedValueOnce(rows('a')).mockResolvedValue(rows('b'));
  const fixture = mount();
  await flush();
  expect(fixture.result.data).toEqual(rows('a'));
  await emit('b');
  expect(fixture.result.data).toEqual(rows('b'));
  await act(async () => { await fixture.client.invalidateQueries({ queryKey: ['community-chat-rows'] }); });
  await flush();
  expect(getRows).toHaveBeenCalledTimes(3);
  expect(fixture.result.data).toEqual(rows('b'));
});

it('reports an initial session failure and retries identity before fetching rows', async () => {
  const failure = new Error('Session storage is unavailable');
  getSession.mockRejectedValueOnce(failure).mockResolvedValue(sessionResult('a'));
  getRows.mockResolvedValue(rows('a'));
  const fixture = mount();
  await flush();
  expect(fixture.result.viewerId).toBeUndefined();
  expect(fixture.result.error).toBe(failure);
  expect(fixture.result.isLoading).toBe(false);
  expect(getRows).not.toHaveBeenCalled();
  await act(async () => { await fixture.result.refetch(); });
  await flush();
  expect(fixture.result.viewerId).toBe('a');
  expect(fixture.result.error).toBeNull();
  expect(fixture.result.data).toEqual(rows('a'));
});

it('ignores stale session failures after sign-out and unsubscribes on cleanup', async () => {
  const initial = deferred<SessionResult>();
  getSession.mockReturnValue(initial.promise);
  const fixture = mount();
  await emit(null);
  initial.reject(new Error('Old storage failure'));
  await flush();
  expect(fixture.result.error).toBeNull();
  fixture.unmount();
  expect(unsubscribe).toHaveBeenCalledTimes(1);
  await emit('b');
  expect(getRows).not.toHaveBeenCalled();
});

it('abandons an initial read and an in-flight row read when their hook unmounts', async () => {
  const initial = deferred<SessionResult>();
  getSession.mockReturnValueOnce(initial.promise);
  const first = mount();
  first.unmount();
  initial.resolve(sessionResult('a'));
  await flush();
  expect(getRows).not.toHaveBeenCalled();

  getSession.mockResolvedValue(sessionResult('b'));
  const pending = deferred<CommunityChatRowData[]>();
  getRows.mockReturnValue(pending.promise);
  const second = mount();
  await flush();
  second.unmount();
  pending.resolve(rows('b'));
  await flush();
  expect(unsubscribe).toHaveBeenCalledTimes(2);
  expect(second.client.getQueryData(['community-chat-rows', 'b', 1])).toBeUndefined();
});

it('uses a separate mapped cache and refreshes exact room counts through existing prefix invalidation', async () => {
  getSession.mockResolvedValue(sessionResult('a')); getRows.mockResolvedValue(rows('a'));
  getMappedRows.mockResolvedValueOnce([{ ...rows('a')[0], unread: 5 }]).mockResolvedValue([{ ...rows('a')[0], unread: 1 }]);
  const fixture = mount(true, true); await flush();
  expect(fixture.result.data?.[0].unread).toBe(5);
  expect(keys(fixture)).toContainEqual(['community-chat-rows', 'a', 1, 'mapped']);
  expect(fixture.client.getQueryData(['community-chat-rows', 'a', 1])).toBeUndefined();
  await act(async () => { await fixture.client.invalidateQueries({ queryKey: ['community-chat-rows'] }); }); await flush();
  expect(fixture.result.data?.[0].unread).toBe(1);
  expect(getMappedRows).toHaveBeenCalledTimes(2);
});
it('abandons mapped results and their operation scope on account change', async () => {
  getSession.mockResolvedValue(sessionResult('a')); getRows.mockResolvedValue(rows('a'));
  const pending = deferred<CommunityChatRowData[]>(); getMappedRows.mockReturnValueOnce(pending.promise).mockResolvedValue(rows('b'));
  const fixture = mount(true, true); await flush();
  const oldScope = getMappedRows.mock.calls[0][1];
  expect(oldScope.isCurrent()).toBe(true);
  await emit('b'); expect(oldScope.isCurrent()).toBe(false);
  pending.resolve(rows('stale-a')); await flush();
  expect(fixture.result.data).toEqual(rows('b'));
  expect(fixture.client.getQueryData(['community-chat-rows', 'a', 1, 'mapped'])).toBeUndefined();
});
it('keeps the original reader as the default without invoking mapped summaries', async () => {
  getSession.mockResolvedValue(sessionResult('a')); getRows.mockResolvedValue(rows('a'));
  const fixture = mount(); await flush();
  expect(fixture.result.data).toEqual(rows('a')); expect(getMappedRows).not.toHaveBeenCalled();
});

it('includes current notification state without replacing independent unread data', async () => {
  getSession.mockResolvedValue(sessionResult('a'));getRows.mockResolvedValue(rows('a'));getMappedRows.mockResolvedValue(rows('a'));
  getNotificationRows.mockResolvedValueOnce([{...rows('a')[0],communityMuted:true}]);const fixture=mount(true,true);await flush();
  expect(fixture.result.data?.[0]).toEqual({...rows('a')[0],communityMuted:true});expect(getNotificationRows.mock.calls.at(-1)?.[1].userId).toBe('a');
});

it('ends a stalled session read with a recoverable error', async () => {
  jest.useFakeTimers();
  try {
    getSession.mockImplementationOnce(() => new Promise(() => {}));
    const fixture = mount();
    await act(async () => { jest.advanceTimersByTime(12_000); });
    expect(fixture.result.isLoading).toBe(false);
    expect(fixture.result.error?.name).toBe('RequestDeadlineError');
    expect(getRows).not.toHaveBeenCalled();
    getSession.mockResolvedValue(sessionResult('recovered'));
    await act(async () => { await fixture.result.refetch(); });
    expect(fixture.result.viewerId).toBe('recovered');
  } finally { jest.useRealTimers(); }
});

it('ends a stalled room read without automatically repeating a timed-out request', async () => {
  jest.useFakeTimers();
  try {
    getSession.mockResolvedValue(sessionResult('slow-rooms'));
    getRows.mockImplementationOnce(() => new Promise(() => {}));
    const fixture = mount();
    await act(async () => {});
    await act(async () => { jest.advanceTimersByTime(12_000); });
    await act(async () => { jest.advanceTimersByTime(1); });
    expect(fixture.result.isLoading).toBe(false);
    expect(fixture.result.error?.name).toBe('RequestDeadlineError');
    expect(getRows).toHaveBeenCalledTimes(1);
  } finally { jest.useRealTimers(); }
});
