import React from 'react';
import { act, create } from 'react-test-renderer';
import { useTopicChat } from '../useTopicChat';
import type { TopicMessage, TopicMessagePage } from '../../lib/communityChat';

const mockAnchorWindow = jest.fn();
jest.mock('../../lib/communityMessageAnchor', () => ({ ...jest.requireActual('../../lib/communityMessageAnchor'), getCommunityMessageAnchorWindow: (...args: unknown[]) => mockAnchorWindow(...args) }));
import { CommunityMessageUnavailableError } from '../../lib/communityMessageAnchor';
const mockRead = jest.fn(), mockBlocked = jest.fn(), mockInsert = jest.fn();
const mockReadLoadedReactions = jest.fn(), mockLoadedEdits = jest.fn(), mockUpdate = jest.fn();
jest.mock('../../lib/topicLoadedHistory', () => ({ readLoadedTopicEdits: (...args: any[]) => mockLoadedEdits(...args) }));
jest.mock('../../lib/chatReactionReader', () => ({ readLoadedTopicReactions: (...args: any[]) => mockReadLoadedReactions(...args) }));
const mockInvalidate = jest.fn();
const mockClient = { invalidateQueries: mockInvalidate };
const mockRemoveChannel = jest.fn(), mockSubscribe = jest.fn();
let mockClosing = false;
const mockChannels: Array<{ name: string; callbacks: Record<string, (payload?: any) => void> }> = [];
jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => mockClient }));
jest.mock('../../lib/communityChat', () => ({ getTopicMessages: (...args: any[]) => mockRead(...args) }));
jest.mock('../../lib/blocking', () => ({ getBlockedWith: (...args: any[]) => mockBlocked(...args) }));
jest.mock('../../lib/logger', () => ({ logError: jest.fn() }));
jest.mock('../../lib/contentFilter', () => ({ checkContent: () => ({ ok: true }) }));
jest.mock('../../lib/supabase', () => ({ supabase: {
  realtime: {isDisconnecting: () => mockClosing},
  auth: {
    getUser: async () => ({ data: { user: { id: 'viewer' } }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: jest.fn() } } }),
  },
  from: (table: string) => {
    let inserting = false;
    const chain: any = {};
    for (const method of ['select', 'eq']) chain[method] = () => chain;
    chain.insert = () => { inserting = true; return chain; };
    chain.update = () => chain;
    chain.delete = () => chain;
    chain.then = (yes: any, no: any) => Promise.resolve(mockUpdate()).then(yes, no);
    chain.single = () => inserting ? mockInsert() : Promise.resolve({ data: null, error: null });
    chain.maybeSingle = async () => ({ data: table === 'profiles_public' ? { first_name_display: 'Alice', profile_photo_url: null } : null, error: null });
    return chain;
  },
  channel: (name: string) => {
    const callbacks: Record<string, (payload?: any) => void> = {};
    mockChannels.push({ name, callbacks });
    const channel: any = { on: (kind: string, filter: any, callback: any) => { callbacks[kind === 'system' ? 'system' : filter.table + (filter.event === 'DELETE' ? '_delete' : '')] = callback; return channel; }, subscribe: () => {mockSubscribe(name);return channel;} };
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
function mount(initial: string | undefined = 'topic-a', initialAnchor: any = null) {
  let chat!: ReturnType<typeof useTopicChat>;
  let renderer!: ReturnType<typeof create>;
  let mounted = true;
  function Harness({ id, anchor = initialAnchor }: { id: string | undefined; anchor?: any }) { chat = useTopicChat(id, undefined, anchor); return null; }
  act(() => { renderer = create(<Harness id={initial} />); });
  const unmount = () => { if (mounted) { act(() => renderer.unmount()); mounted = false; } };
  close.push(unmount);
  return { get chat() { return chat; }, anchor: (anchor: any) => act(() => renderer.update(<Harness id={initial} anchor={anchor} />)), navigate: (id: string | undefined) => act(() => renderer.update(<Harness id={id} />)), unmount };
}
async function flush() { await act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); }); }
beforeEach(() => {
  mockClosing=false;
  jest.clearAllMocks();
  mockRead.mockReset().mockResolvedValue(page([message(10)], true));
  mockBlocked.mockReset().mockResolvedValue(new Set());
  mockInsert.mockReset(); mockChannels.splice(0);
  mockReadLoadedReactions.mockReset().mockResolvedValue([]);
  mockLoadedEdits.mockReset().mockResolvedValue([]);
  mockUpdate.mockReset().mockResolvedValue({ data: null, error: null });
  mockAnchorWindow.mockReset().mockResolvedValue({ messages: [message(2), message(3)].map(message => ({ key: `topic:${message.id}`, source: 'topic', message })), hasMore: true, olderCursor: { id: 'message-2', created_at: message(2).created_at } });
});
afterEach(() => close.splice(0).forEach(fn => fn()));

it('updates an edited older message without replacing loaded history with the newest page', async () => {
  const fixture = mount(); await flush();
  mockRead.mockResolvedValueOnce(page([message(1)], false));
  await act(async () => fixture.chat.loadOlder());
  mockLoadedEdits.mockResolvedValueOnce([{ id: 'message-1', body: 'Revised older message', edited_at: '2026-09-25T08:00:00Z', mention_data: null }]);
  act(() => mockChannels[0].callbacks.community_topic_messages({ eventType: 'UPDATE', new: {
    id: 'message-1', body: 'Revised older message', edited_at: '2026-09-25T08:00:00Z', mention_data: null,
  } }));
  await flush();
  expect(fixture.chat.messages.map(row => row.id)).toEqual(['message-1', 'message-10']);
  expect(fixture.chat.messages[0].body).toBe('Revised older message');
  expect(fixture.chat.messages[0].edited_at).toBe('2026-09-25T08:00:00Z');
});

it('refreshes older loaded reactions after an addition and ID-only removal', async () => {
  const fixture = mount(); await flush();
  mockRead.mockResolvedValueOnce(page([message(1)], false));
  await act(async () => fixture.chat.loadOlder());
  mockReadLoadedReactions.mockResolvedValueOnce([{ message_id: 'message-1', user_id: 'other', reaction: '❤️' }]);
  act(() => mockChannels[0].callbacks.community_topic_message_reactions({ eventType: 'INSERT', new: { message_id: 'message-1' } }));
  await flush();
  expect(fixture.chat.messages[0].reactions).toEqual([{ user_id: 'other', reaction: '❤️' }]);
  act(() => mockChannels[0].callbacks.community_topic_message_reactions({ eventType: 'DELETE', old: { id: 'reaction-only-id' } }));
  await flush();
  expect(fixture.chat.messages[0].reactions).toEqual([]);
  expect(mockReadLoadedReactions.mock.calls[0][0]).toContain('message-1');
});

it('catches up at PostgreSQL readiness and after reconnect without a loading flash', async () => {
  const fixture = mount(); await flush();
  for (const newest of [11, 12]) {
    mockRead.mockResolvedValueOnce(page([message(10), message(newest)]));
    act(() => mockChannels[0].callbacks.system({ status: 'ok', extension: 'postgres_changes' })); await flush();
    expect(fixture.chat.messages.at(-1)?.id).toBe(`message-${newest}`);
    expect(fixture.chat.loading).toBe(false);
  }
});

it('ignores unrelated and retired-room readiness signals', async () => {
  const fixture = mount(); await flush(); const old = mockChannels[0].callbacks.system;
  const count = mockRead.mock.calls.length;
  for (const payload of [null, {}, { status: 'error', extension: 'postgres_changes' }, { status: 'ok', extension: 'broadcast' }]) act(() => old(payload));
  await flush(); expect(mockRead).toHaveBeenCalledTimes(count);
  fixture.navigate('topic-b'); await flush(); const nextCount = mockRead.mock.calls.length;
  act(() => old({ status: 'ok', extension: 'postgres_changes' })); await flush();
  expect(mockRead).toHaveBeenCalledTimes(nextCount);
});

it('reconciles a known ID-only deletion but ignores another room’s deletion', async () => {
  const fixture = mount(); await flush(); const deleted = mockChannels[0].callbacks.community_topic_messages_delete;
  const count = mockRead.mock.calls.length;
  act(() => deleted({ old: { id: 'other-room' } })); await flush(); expect(mockRead).toHaveBeenCalledTimes(count);
  mockRead.mockResolvedValueOnce(page([]));
  act(() => deleted({ old: { id: 'message-10' } })); await flush(); expect(fixture.chat.messages).toEqual([]);
});

it('removes a deleted oldest message on reconnect when the server returned complete history', async () => {
  mockRead.mockResolvedValueOnce(page([message(10), message(11)]));
  const fixture = mount(); await flush();
  mockRead.mockResolvedValueOnce(page([message(11)]));
  act(() => mockChannels[0].callbacks.system({ status: 'ok', extension: 'postgres_changes' })); await flush();
  expect(fixture.chat.messages.map(row => row.id)).toEqual(['message-11']);
});

it('rejects an older newest response after a newer refresh has completed', async () => {
  const fixture = mount(); await flush();
  const stale = deferred<TopicMessagePage>();
  mockRead.mockReturnValueOnce(stale.promise).mockResolvedValueOnce(page([message(10, 'Current'), message(11)]));
  let old!: Promise<void>;
  act(() => { old = fixture.chat.refresh(true); });
  await act(async () => { await fixture.chat.refresh(true); });
  await act(async () => { stale.resolve(page([message(10, 'Stale')])); await old; });
  expect(fixture.chat.messages.map(row => row.body)).toEqual(['Current', 'Message 11']);
});

it('does not show an old refresh error after a newer successful refresh', async () => {
  const fixture = mount(); await flush();
  const stale = deferred<TopicMessagePage>();
  mockRead.mockReturnValueOnce(stale.promise).mockResolvedValueOnce(page([message(10)]));
  let old!: Promise<void>;
  act(() => { old = fixture.chat.refresh(true); });
  await act(async () => { await fixture.chat.refresh(true); });
  await act(async () => { stale.reject(new Error('Old connection')); await old; });
  expect(fixture.chat.loadError).toBe(false);
});

it('does not let an old foreground finally hide the latest loading state', async () => {
  const fixture = mount(); await flush();
  const stale = deferred<TopicMessagePage>(), latest = deferred<TopicMessagePage>();
  mockRead.mockReturnValueOnce(stale.promise).mockReturnValueOnce(latest.promise);
  let old!: Promise<void>, current!: Promise<void>;
  act(() => { old = fixture.chat.refresh(); current = fixture.chat.refresh(); });
  await act(async () => { stale.resolve(page([message(10)])); await old; });
  expect(fixture.chat.loading).toBe(true);
  await act(async () => { latest.resolve(page([message(11)])); await current; });
  expect(fixture.chat.loading).toBe(false);
});

it('publishes initial loading before one catch-up for a realtime burst during that read', async () => {
  const initial = deferred<TopicMessagePage>(), catchUp = deferred<TopicMessagePage>();
  mockRead.mockReturnValueOnce(initial.promise).mockReturnValueOnce(catchUp.promise);
  const fixture = mount();
  await flush();
  act(() => { for (let i = 0; i < 30; i++) mockChannels[0].callbacks.community_topic_messages(); }); await flush();
  expect(mockRead).toHaveBeenCalledTimes(1);
  await act(async () => { initial.resolve(page([message(10)])); }); await flush();
  expect(fixture.chat.loading).toBe(false);
  expect(fixture.chat.messages.map(row => row.id)).toEqual(['message-10']);
  expect(mockRead).toHaveBeenCalledTimes(2);
  await act(async () => { catchUp.resolve(page([message(10), message(11)])); }); await flush();
  expect(fixture.chat.messages.map(row => row.id)).toEqual(['message-10', 'message-11']);
});

it('coalesces slow realtime bursts and publishes each owned snapshot before the next catch-up', async () => {
  const fixture = mount(); await flush();
  const first = deferred<TopicMessagePage>(), second = deferred<TopicMessagePage>(), third = deferred<TopicMessagePage>();
  mockRead.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise);
  act(() => mockChannels[0].callbacks.community_topic_messages()); await flush();
  act(() => { for (let i = 0; i < 30; i++) mockChannels[0].callbacks.community_topic_message_reactions({ eventType: 'DELETE' }); }); await flush();
  expect(mockRead).toHaveBeenCalledTimes(2); // Initial + one automatic read.
  await act(async () => { first.resolve(page([message(10, 'First snapshot')])); }); await flush();
  expect(mockRead).toHaveBeenCalledTimes(3);
  expect(fixture.chat.messages[0].body).toBe('First snapshot');
  act(() => { for (let i = 0; i < 30; i++) mockChannels[0].callbacks.community_topic_messages(); }); await flush();
  expect(mockRead).toHaveBeenCalledTimes(3);
  await act(async () => { second.resolve(page([message(10, 'Second snapshot')])); }); await flush();
  expect(mockRead).toHaveBeenCalledTimes(4);
  expect(fixture.chat.messages[0].body).toBe('Second snapshot');
  await act(async () => { third.resolve(page([message(10, 'Caught up')])); }); await flush();
  expect(mockRead).toHaveBeenCalledTimes(4);
  expect(fixture.chat.messages[0].body).toBe('Caught up');
});

it('keeps a queued automatic catch-up behind an explicit retry and preserves its visible result', async () => {
  const fixture = mount(); await flush();
  const automatic = deferred<TopicMessagePage>(), manual = deferred<TopicMessagePage>(), catchUp = deferred<TopicMessagePage>();
  mockRead.mockReturnValueOnce(automatic.promise);
  act(() => mockChannels[0].callbacks.community_topic_messages()); await flush();
  act(() => mockChannels[0].callbacks.community_topic_messages()); await flush();
  mockRead.mockReturnValueOnce(manual.promise).mockReturnValueOnce(catchUp.promise);
  let retry!: Promise<void>;
  act(() => { retry = fixture.chat.refresh(); });
  await act(async () => { automatic.resolve(page([message(10, 'Old automatic')])); }); await flush();
  expect(mockRead).toHaveBeenCalledTimes(3);
  expect(fixture.chat.loading).toBe(true);
  expect(fixture.chat.messages[0].body).toBe('Message 10');
  await act(async () => { manual.resolve(page([message(10, 'Explicit retry')])); await retry; }); await flush();
  expect(mockRead).toHaveBeenCalledTimes(4);
  expect(fixture.chat.messages[0].body).toBe('Explicit retry');
  await act(async () => { catchUp.resolve(page([message(10, 'Catch-up')])); }); await flush();
  expect(fixture.chat.messages[0].body).toBe('Catch-up');
});

it.each([false, true])('releases failed automatic work without spinning and honors only an existing queued catch-up (%s)', async queued => {
  const fixture = mount(); await flush();
  const failed = deferred<TopicMessagePage>(), retry = deferred<TopicMessagePage>();
  mockRead.mockReturnValueOnce(failed.promise).mockReturnValueOnce(retry.promise);
  act(() => mockChannels[0].callbacks.community_topic_messages()); await flush();
  if (queued) {
    act(() => { for (let i = 0; i < 15; i++) mockChannels[0].callbacks.community_topic_messages(); }); await flush();
  }
  await act(async () => { failed.reject(new Error('Automatic read unavailable')); }); await flush();
  expect(fixture.chat.loadError).toBe(true);
  expect(fixture.chat.messages[0].body).toBe('Message 10');
  expect(mockRead).toHaveBeenCalledTimes(queued ? 3 : 2);
  if (!queued) { act(() => mockChannels[0].callbacks.community_topic_messages()); await flush(); }
  await act(async () => { retry.resolve(page([message(10, 'Recovered')])); }); await flush();
  expect(fixture.chat.loadError).toBe(false);
  expect(fixture.chat.messages[0].body).toBe('Recovered');
  expect(mockRead).toHaveBeenCalledTimes(3);
});

it('does not drain a retired automatic queue or unlock the new A visit after A → B → A', async () => {
  const fixture = mount(); await flush();
  const retired = deferred<TopicMessagePage>(), current = deferred<TopicMessagePage>(), catchUp = deferred<TopicMessagePage>();
  mockRead.mockReturnValueOnce(retired.promise);
  act(() => mockChannels[0].callbacks.community_topic_messages()); await flush();
  act(() => mockChannels[0].callbacks.community_topic_messages()); await flush();
  fixture.navigate('topic-b'); await flush();
  fixture.navigate('topic-a'); await flush();
  mockRead.mockReturnValueOnce(current.promise).mockReturnValueOnce(catchUp.promise);
  act(() => mockChannels[2].callbacks.community_topic_messages()); await flush();
  const reads = mockRead.mock.calls.length;
  await act(async () => { retired.resolve(page([message(10, 'Retired')])); }); await flush();
  act(() => mockChannels[2].callbacks.community_topic_messages()); await flush();
  expect(mockRead).toHaveBeenCalledTimes(reads);
  expect(fixture.chat.messages[0].body).toBe('Message 10');
  await act(async () => { current.resolve(page([message(10, 'Current A')])); }); await flush();
  expect(mockRead).toHaveBeenCalledTimes(reads + 1);
  expect(fixture.chat.messages[0].body).toBe('Current A');
  await act(async () => { catchUp.resolve(page([message(10, 'Current caught up')])); }); await flush();
  expect(fixture.chat.messages[0].body).toBe('Current caught up');
});

it('discards a queued catch-up when the automatic visit unmounts', async () => {
  const fixture = mount(); await flush();
  const retired = deferred<TopicMessagePage>();
  mockRead.mockReturnValueOnce(retired.promise);
  act(() => mockChannels[0].callbacks.community_topic_messages()); await flush();
  act(() => mockChannels[0].callbacks.community_topic_messages()); await flush();
  const reads = mockRead.mock.calls.length;
  fixture.unmount();
  await act(async () => { retired.resolve(page([message(11)])); }); await flush();
  expect(mockRead).toHaveBeenCalledTimes(reads);
});

it.each(['success', 'error'] as const)('rejects newest %s from a retired A visit after A → B → A', async outcome => {
  const fixture = mount(); await flush();
  const stale = deferred<TopicMessagePage>();
  mockRead.mockReturnValueOnce(stale.promise);
  let old!: Promise<void>;
  act(() => { old = fixture.chat.refresh(true); });
  fixture.navigate('topic-b'); await flush();
  mockRead.mockResolvedValueOnce(page([message(12)]));
  fixture.navigate('topic-a'); await flush();
  await act(async () => {
    if (outcome === 'success') stale.resolve(page([message(10), message(13)]));
    else stale.reject(new Error('Retired A read'));
    await old;
  });
  expect(fixture.chat.messages.map(row => row.id)).toEqual(['message-12']);
  expect(fixture.chat.loadError).toBe(false);
});

it('guards a refresh that becomes stale while its block lookup is pending', async () => {
  const fixture = mount(); await flush();
  const blocks = deferred<Set<string>>();
  mockRead.mockResolvedValueOnce(page([message(10, 'Old')]));
  mockBlocked.mockReturnValueOnce(blocks.promise);
  let old!: Promise<void>;
  act(() => { old = fixture.chat.refresh(true); }); await flush();
  mockRead.mockResolvedValueOnce(page([message(10, 'New')]));
  await act(async () => { await fixture.chat.refresh(true); });
  await act(async () => { blocks.resolve(new Set()); await old; });
  expect(fixture.chat.messages[0].body).toBe('New');
});

it.each(['success', 'error'] as const)('rejects older-page %s from a retired A visit', async outcome => {
  const fixture = mount(); await flush();
  const stale = deferred<TopicMessagePage>();
  mockRead.mockReturnValueOnce(stale.promise);
  let old!: Promise<void>;
  act(() => { old = fixture.chat.loadOlder(); });
  fixture.navigate('topic-b'); await flush();
  fixture.navigate('topic-a'); await flush();
  await act(async () => {
    if (outcome === 'success') stale.resolve(page([message(1)]));
    else stale.reject(new Error('Retired older read'));
    await old;
  });
  expect(fixture.chat.messages.map(row => row.id)).toEqual(['message-10']);
  expect(fixture.chat.olderLoadError).toBe(false);
});

it('starts pagination in B while A pagination is still pending', async () => {
  const fixture = mount(); await flush();
  const stale = deferred<TopicMessagePage>();
  mockRead.mockReturnValueOnce(stale.promise);
  let old!: Promise<void>;
  act(() => { old = fixture.chat.loadOlder(); });
  fixture.navigate('topic-b'); await flush();
  expect(fixture.chat.loadingOlder).toBe(false);
  mockRead.mockResolvedValueOnce(page([message(2)]));
  await act(async () => { await fixture.chat.loadOlder(); });
  expect(mockRead.mock.calls.at(-1)?.[0]).toBe('topic-b');
  expect(mockRead.mock.calls.at(-1)?.[1]).toEqual(page([message(10)]).olderCursor);
  await act(async () => { stale.resolve(page([message(1)])); await old; });
});

it('does not let old pagination finally release the current room pagination lock', async () => {
  const fixture = mount(); await flush();
  const stale = deferred<TopicMessagePage>(), latest = deferred<TopicMessagePage>();
  mockRead.mockReturnValueOnce(stale.promise);
  let old!: Promise<void>, current!: Promise<void>;
  act(() => { old = fixture.chat.loadOlder(); });
  fixture.navigate('topic-b'); await flush();
  mockRead.mockReturnValueOnce(latest.promise);
  act(() => { current = fixture.chat.loadOlder(); });
  await act(async () => { stale.resolve(page([message(1)])); await old; });
  const reads = mockRead.mock.calls.length;
  act(() => { void fixture.chat.loadOlder(); });
  expect(mockRead).toHaveBeenCalledTimes(reads);
  expect(fixture.chat.loadingOlder).toBe(true);
  await act(async () => { latest.resolve(page([message(2)])); await current; });
});

it('discards a pending older page when an explicit foreground refresh supersedes it', async () => {
  const fixture = mount(); await flush();
  const stale = deferred<TopicMessagePage>();
  mockRead.mockReturnValueOnce(stale.promise);
  let old!: Promise<void>;
  act(() => { old = fixture.chat.loadOlder(); });
  mockRead.mockResolvedValueOnce(page([message(10, 'Refreshed')], true));
  await act(async () => { await fixture.chat.refresh(); });
  await act(async () => { stale.resolve(page([message(1), message(10, 'Stale copy')])); await old; });
  expect(fixture.chat.messages.map(row => row.body)).toEqual(['Refreshed']);
  expect(fixture.chat.hasOlder).toBe(true);
  expect(fixture.chat.loadingOlder).toBe(false);
});

it.each([false, true])('keeps the paging lock and completes history during silent realtime refreshes (older page already loaded: %s)', async alreadyLoaded => {
  const fixture = mount(); await flush();
  if (alreadyLoaded) {
    mockRead.mockResolvedValueOnce(page([message(5)], true));
    await act(async () => { await fixture.chat.loadOlder(); });
  }
  const older = deferred<TopicMessagePage>();
  mockRead.mockReturnValueOnce(older.promise);
  let pagination!: Promise<void>;
  act(() => { pagination = fixture.chat.loadOlder(); });
  mockRead.mockResolvedValueOnce(page([message(10, 'Fresh'), message(11)], true));
  act(() => mockChannels[0].callbacks.community_topic_messages()); await flush();
  expect(fixture.chat.loadingOlder).toBe(true);
  const reads = mockRead.mock.calls.length;
  await act(async () => { await fixture.chat.loadOlder(); });
  expect(mockRead).toHaveBeenCalledTimes(reads);
  mockRead.mockResolvedValueOnce(page([message(10, 'Freshest'), message(11), message(12)], true));
  act(() => mockChannels[0].callbacks.community_topic_message_reactions({ eventType: 'DELETE' })); await flush();
  expect(fixture.chat.loadingOlder).toBe(true);
  await act(async () => { older.resolve(page([message(1)])); await pagination; });
  expect(fixture.chat.messages.map(row => row.id)).toEqual(alreadyLoaded
    ? ['message-1', 'message-5', 'message-10', 'message-11', 'message-12']
    : ['message-1', 'message-10', 'message-11', 'message-12']);
  expect(fixture.chat.messages.find(row => row.id === 'message-10')?.body).toBe('Freshest');
  expect(fixture.chat.hasOlder).toBe(false);
  expect(fixture.chat.loadingOlder).toBe(false);
});

it.each(['success', 'error'] as const)('rejects older-page %s when an in-flight newest read replaces its cursor', async outcome => {
  const fixture = mount(); await flush();
  const newest = deferred<TopicMessagePage>(), older = deferred<TopicMessagePage>();
  mockRead.mockReturnValueOnce(newest.promise).mockReturnValueOnce(older.promise);
  let refresh!: Promise<void>, pagination!: Promise<void>;
  act(() => { refresh = fixture.chat.refresh(true); pagination = fixture.chat.loadOlder(); });
  await act(async () => { newest.resolve(page([message(11)])); await refresh; });
  await act(async () => {
    if (outcome === 'success') older.resolve(page([message(1)], true));
    else older.reject(new Error('Old cursor failed'));
    await pagination;
  });
  // hasMore=false means this is complete history, so the absent old row is
  // deleted; neither a late older-page success nor error may resurrect it.
  expect(fixture.chat.messages.map(row => row.id)).toEqual(['message-11']);
  expect(fixture.chat.hasOlder).toBe(false);
  expect(fixture.chat.olderLoadError).toBe(false);
  expect(fixture.chat.loadingOlder).toBe(false);
});

it('does not restart a retired refresh or pagination callback after unmount', async () => {
  const fixture = mount(); await flush();
  const { refresh, loadOlder } = fixture.chat;
  fixture.unmount();
  const reads = mockRead.mock.calls.length;
  await act(async () => { await refresh(); await loadOlder(); });
  expect(mockRead).toHaveBeenCalledTimes(reads);
  expect(mockRemoveChannel).toHaveBeenCalledTimes(1);
});

it('stops a pending read before secondary work after unmount and ignores a retired realtime callback', async () => {
  const pending = deferred<TopicMessagePage>();
  mockRead.mockReturnValueOnce(pending.promise);
  const fixture = mount();
  await flush();
  fixture.unmount();
  act(() => mockChannels[0].callbacks.community_topic_messages());
  await act(async () => { pending.resolve(page([message(10)])); }); await flush();
  expect(mockRead).toHaveBeenCalledTimes(1);
  expect(mockBlocked).not.toHaveBeenCalled();
});

it('clears the read state without fetching when the room id becomes unavailable', async () => {
  const fixture = mount(); await flush();
  const refresh = fixture.chat.refresh;
  fixture.navigate(undefined);
  const reads = mockRead.mock.calls.length;
  await act(async () => { await refresh(); await fixture.chat.loadOlder(); });
  expect(mockRead).toHaveBeenCalledTimes(reads);
  expect(fixture.chat.messages).toEqual([]);
  expect(fixture.chat.loading).toBe(false);
  expect(fixture.chat.hasOlder).toBe(false);
});

it('preserves the exhausted older cursor when the newest page still has more raw rows', async () => {
  const fixture = mount(); await flush();
  mockRead.mockResolvedValueOnce(page([message(1)], false));
  await act(async () => { await fixture.chat.loadOlder(); });
  mockRead.mockResolvedValueOnce(page([message(10), message(11)], true));
  await act(async () => { await fixture.chat.refresh(true); });
  expect(fixture.chat.messages.map(row => row.id)).toEqual(['message-1', 'message-10', 'message-11']);
  expect(fixture.chat.hasOlder).toBe(false);
});

it('keeps filtered history and its raw cursor when a newest page has no visible rows', async () => {
  const fixture = mount(); await flush();
  mockRead.mockResolvedValueOnce(page([message(1, 'Readable', { sender_id: 'allowed' })], true));
  await act(async () => { await fixture.chat.loadOlder(); });
  mockRead.mockResolvedValueOnce(page([], true, message(5)));
  mockBlocked.mockResolvedValueOnce(new Set(['other']));
  await act(async () => { await fixture.chat.refresh(true); });
  expect(fixture.chat.messages.map(row => row.id)).toEqual(['message-1']);
  mockRead.mockResolvedValueOnce(page([]));
  await act(async () => { await fixture.chat.loadOlder(); });
  expect(mockRead.mock.calls.at(-1)?.[1]).toEqual(page([message(1)]).olderCursor);
});

it('does not reintroduce a blocked sender through a newly returned row after the block lookup', async () => {
  const fixture = mount(); await flush();
  mockRead.mockResolvedValueOnce(page([message(10), message(11), message(12, 'Readable', { sender_id: 'allowed' })], true));
  mockBlocked.mockResolvedValueOnce(new Set(['other']));
  await act(async () => { await fixture.chat.refresh(true); });
  expect(fixture.chat.messages.map(row => row.id)).toEqual(['message-12']);
});

it('keeps a send confirmed during a pending refresh and preserves another pending UUID', async () => {
  const fixture = mount(); await flush();
  const stale = deferred<TopicMessagePage>(), first = deferred<any>(), second = deferred<any>();
  mockRead.mockReturnValueOnce(stale.promise);
  let refresh!: Promise<void>, sendA!: Promise<void>, sendB!: Promise<void>;
  act(() => { refresh = fixture.chat.refresh(true); });
  mockInsert.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  act(() => {
    sendA = fixture.chat.sendMessage('Same text', undefined, undefined, undefined, 'send-a');
    sendB = fixture.chat.sendMessage('Same text', undefined, undefined, undefined, 'send-b');
  });
  await act(async () => { first.resolve({ data: { topic_id: 'topic-a', sender_id: 'viewer', body: 'Same text', id: 'send-a', created_at: message(20).created_at }, error: null }); await sendA; });
  await act(async () => { stale.resolve(page([message(10)])); await refresh; });
  expect(fixture.chat.messages.map(row => row.id).sort()).toEqual(['message-10', 'send-a', 'send-b']);
  expect(fixture.chat.messages.find(row => row.id === 'send-b')?.delivery_state).toBe('sending');
  await act(async () => { second.resolve({ data: { topic_id: 'topic-a', sender_id: 'viewer', body: 'Same text', id: 'send-b', created_at: message(21).created_at }, error: null }); await sendB; });
});

it('accepts the authoritative server row for the exact pending UUID without duplicating or dropping another send', async () => {
  const fixture = mount(); await flush();
  const first = deferred<any>(), second = deferred<any>();
  mockInsert.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  let sendA!: Promise<void>, sendB!: Promise<void>;
  act(() => {
    sendA = fixture.chat.sendMessage('Same text', undefined, undefined, undefined, 'send-a');
    sendB = fixture.chat.sendMessage('Same text', undefined, undefined, undefined, 'send-b');
  });
  const confirmed = message(20, 'Authoritative row', { id: 'send-a', sender_id: 'viewer' });
  mockRead.mockResolvedValueOnce(page([message(10), confirmed]));
  await act(async () => { await fixture.chat.refresh(true); });
  expect(fixture.chat.messages.filter(row => row.id === 'send-a')).toEqual([confirmed]);
  expect(fixture.chat.messages.find(row => row.id === 'send-b')?.delivery_state).toBe('sending');
  await act(async () => {
    first.resolve({ data: { topic_id: 'topic-a', sender_id: 'viewer', body: 'Same text', id: 'send-a', created_at: confirmed.created_at }, error: null });
    second.resolve({ data: { topic_id: 'topic-a', sender_id: 'viewer', body: 'Same text', id: 'send-b', created_at: message(21).created_at }, error: null });
    await Promise.all([sendA, sendB]);
  });
});


it('reaction landing reads around its target and preserves an earlier-history cursor', async () => {
  const anchor = { id: 'message-3', source: 'topic' };
  const fixture = mount('topic-a', anchor); await flush();
  expect(fixture.chat.messages.map(row => row.id)).toEqual(['message-2', 'message-3']);
  expect(mockRead).not.toHaveBeenCalled(); expect(mockAnchorWindow).toHaveBeenCalledWith({ kind: 'topic', topicId: 'topic-a' }, anchor, expect.objectContaining({ userId: 'viewer' }));
  mockRead.mockResolvedValueOnce(page([message(1)], false)); await act(async () => fixture.chat.loadOlder());
  expect(fixture.chat.messages.map(row => row.id)).toEqual(['message-1', 'message-2', 'message-3']);
  expect(mockRead.mock.calls[0][1].id).toBe('message-2');
});
it('returning to latest discards a delayed old target window', async () => {
  const pending = deferred<any>(); mockAnchorWindow.mockReturnValueOnce(pending.promise);
  const fixture = mount('topic-a', { id: 'message-3', source: 'topic' }); await flush();
  fixture.anchor(null); await flush(); expect(fixture.chat.messages.map(row => row.id)).toEqual(['message-10']);
  await act(async () => pending.resolve({ messages: [{ key: 'topic:message-3', source: 'topic', message: message(3) }], hasMore: false, olderCursor: null }));
  expect(fixture.chat.messages.map(row => row.id)).toEqual(['message-10']);
});
it('target deletion clears stale visible content after a realtime refresh', async () => {
  const fixture = mount('topic-a', { id: 'message-3', source: 'topic' }); await flush();
  mockAnchorWindow.mockRejectedValue(new CommunityMessageUnavailableError());
  act(() => mockChannels.at(-1)?.callbacks.community_topic_messages()); await flush();
  expect(fixture.chat.anchorUnavailable).toBe(true); expect(fixture.chat.messages).toEqual([]);
});
it('failed target loading remains retryable and does not become a missing-message result', async () => {
  mockAnchorWindow.mockRejectedValueOnce(Error('offline'));
  const fixture = mount('topic-a', { id: 'message-3', source: 'topic' }); await flush();
  expect(fixture.chat.loadError).toBe(true); expect(fixture.chat.anchorUnavailable).toBe(false);
  await act(async () => fixture.chat.refresh());
  expect(fixture.chat.loadError).toBe(false); expect(fixture.chat.messages.map(row => row.id)).toEqual(['message-2', 'message-3']);
});
it('reaction refresh stays within the target window instead of jumping to latest', async () => {
  const fixture = mount('topic-a', { id: 'message-3', source: 'topic' }); await flush();
  act(() => mockChannels.at(-1)?.callbacks.community_topic_message_reactions({ eventType: 'DELETE' })); await flush();
  expect(mockAnchorWindow.mock.calls.length).toBeGreaterThan(1); expect(mockRead).not.toHaveBeenCalled();
  expect(fixture.chat.messages.map(row => row.id)).toEqual(['message-2', 'message-3']);
});

it('returning to latest keeps ownership of a send already awaiting its receipt', async () => {
  const receipt = deferred<any>(); mockInsert.mockReturnValueOnce(receipt.promise);
  const fixture = mount('topic-a', { id: 'message-3', source: 'topic' }); await flush();
  let sending!: Promise<unknown>; act(() => { sending = fixture.chat.sendMessage('See you soon', undefined, undefined, undefined, 'owned-send'); }); await flush();
  fixture.anchor(null); await flush();
  expect(fixture.chat.messages.some(row => row.id === 'owned-send' && row.delivery_state === 'sending')).toBe(true);
  await act(async () => { receipt.resolve({ data: { topic_id: 'topic-a', sender_id: 'viewer', body: 'See you soon', id: 'owned-send', created_at: '2026-09-21T12:00:00Z' }, error: null }); await sending; });
  expect(fixture.chat.messages.find(row => row.id === 'owned-send')).toMatchObject({ body: 'See you soon', delivery_state: undefined });
});

it('catches up older edits and deletions after reconnect without replacing loaded history', async () => {
  const fixture = mount(); await flush();
  mockRead.mockResolvedValueOnce(page([message(1), message(2)], false));
  await act(async () => fixture.chat.loadOlder());
  mockLoadedEdits.mockResolvedValueOnce([{ id: 'message-2', body: 'Edited while disconnected', edited_at: '2026-09-25T09:00:00Z', mention_data: null }]);
  act(() => mockChannels[0].callbacks.system({ status: 'ok', extension: 'postgres_changes' }));
  await flush();
  expect(fixture.chat.messages.map(row => row.id)).toEqual(['message-2', 'message-10']);
  expect(fixture.chat.messages[0].body).toBe('Edited while disconnected');
  expect(fixture.chat.hasOlder).toBe(false);
  expect(fixture.chat.loading).toBe(false);
});

it('a stale older edit read and delayed UPDATE cannot overwrite a newer own edit', async () => {
  const fixture = mount(); await flush();
  mockRead.mockResolvedValueOnce(page([message(1, 'Original', { sender_id: 'viewer' })], false));
  await act(async () => fixture.chat.loadOlder());
  const oldRead = deferred<any>(), write = deferred<any>();
  mockLoadedEdits.mockReturnValueOnce(oldRead.promise); mockUpdate.mockReturnValueOnce(write.promise);
  act(() => mockChannels[0].callbacks.community_topic_messages({ eventType: 'UPDATE', new: { id: 'message-1', body: 'Earlier edit' } }));
  let operation!: Promise<void>;
  act(() => { operation = fixture.chat.editMessage('message-1', 'My newest edit'); }); await flush();
  await act(async () => oldRead.resolve([{ id: 'message-1', body: 'Earlier edit', edited_at: null }]));
  expect(fixture.chat.messages[0].body).toBe('My newest edit');
  await act(async () => { write.resolve({ error: null }); await operation; });
  mockLoadedEdits.mockResolvedValueOnce([{ id: 'message-1', body: 'My newest edit', edited_at: '2026-09-25T10:00:00Z' }]);
  act(() => mockChannels[0].callbacks.community_topic_messages({ eventType: 'UPDATE', new: { id: 'message-1', body: 'Earlier edit' } }));
  await flush();
  expect(fixture.chat.messages[0].body).toBe('My newest edit');
});

it.each(['edits', 'reactions'])('drains a queued older %s event after failure and ignores retired results', async kind => {
  const fixture = mount(); await flush();
  mockRead.mockResolvedValueOnce(page([message(1)], false));
  await act(async () => fixture.chat.loadOlder());
  const reader = kind === 'edits' ? mockLoadedEdits : mockReadLoadedReactions;
  const trigger = () => kind === 'edits'
    ? mockChannels[0].callbacks.community_topic_messages({ eventType: 'UPDATE', new: { id: 'message-1' } })
    : mockChannels[0].callbacks.community_topic_message_reactions({ eventType: 'INSERT', new: { message_id: 'message-1' } });
  const first = deferred<any>(); reader.mockReturnValueOnce(first.promise)
    .mockResolvedValueOnce(kind === 'edits' ? [{id:'message-1',body:'Recovered',edited_at:null}]
      : [{message_id:'message-1',user_id:'other',reaction:'❤️'}]);
  act(trigger); await flush(); act(trigger);
  await act(async () => first.reject(Error('Interrupted read'))); await flush();
  expect(reader).toHaveBeenCalledTimes(2);
  if(kind==='edits') expect(fixture.chat.messages[0].body).toBe('Recovered');
  else expect(fixture.chat.messages[0].reactions).toHaveLength(1);
  const late = deferred<any>();reader.mockReturnValueOnce(late.promise);
  act(trigger); await flush(); fixture.navigate('topic-b'); await flush();
  await act(async () => late.resolve(kind==='edits' ? [{id:'message-1',body:'Private old result'}]
    : [{message_id:'message-1',user_id:'other',reaction:'❤️'}]));
  expect(fixture.chat.messages.map(row => row.id)).toEqual(['message-10']);
});

it('an unsuccessful delete superseding an edit does not leave older edit refresh permanently busy', async () => {
  const fixture = mount(); await flush();
  mockRead.mockResolvedValueOnce(page([message(1, 'Original', { sender_id: 'viewer' })], false));
  await act(async () => fixture.chat.loadOlder());
  const editing = deferred<any>(); mockUpdate.mockReturnValueOnce(editing.promise);
  let edit!: Promise<void>;
  act(() => { edit = fixture.chat.editMessage('message-1', 'Unconfirmed edit'); });
  const editResult = edit.catch(error => error);
  await flush();
  mockUpdate.mockResolvedValueOnce({error:Error('Delete failed')});
  await act(async () => { await expect(fixture.chat.deleteMessage('message-1')).rejects.toThrow('Delete failed'); });
  await act(async () => { editing.resolve({error:null}); await editResult; });
  mockLoadedEdits.mockResolvedValueOnce([{id:'message-1',body:'Authoritative revision',edited_at:null}]);
  act(() => mockChannels[0].callbacks.community_topic_messages({eventType:'UPDATE',new:{id:'message-1'}}));
  await flush();
  expect(fixture.chat.messages[0].body).toBe('Authoritative revision');
});


it('waits for socket close on rapid room return and retires earlier delayed joins', async () => {
 jest.useFakeTimers();try {
  mockClosing=true;const fixture=mount();await flush();
  fixture.navigate('topic-b');await flush();fixture.navigate('topic-a');await flush();
  expect(mockSubscribe).not.toHaveBeenCalled();
  expect(new Set(mockChannels.map(channel=>channel.name)).size).toBe(3);
  mockClosing=false;await act(async()=>{jest.advanceTimersByTime(100);});await flush();
  expect(mockSubscribe).toHaveBeenCalledTimes(1);
  expect(mockSubscribe).toHaveBeenCalledWith(mockChannels[2].name);
 }finally{close.splice(0).forEach(fn=>fn());jest.useRealTimers();}
});
