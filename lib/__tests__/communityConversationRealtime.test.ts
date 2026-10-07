import { subscribeCommunityMain, subscribeCommunityReplies } from '../communityConversationRealtime';

const mockListeners: { event: string; filter: any; callback: (payload: any) => void }[] = [];
const mockRemove = jest.fn(), mockSubscribe = jest.fn();
const mockNames: string[] = []; let mockClosing = false;
jest.mock('../supabase', () => ({ supabase: { realtime: { isDisconnecting: () => mockClosing },
  channel: (name: string) => { mockNames.push(name); const channel = {
    on: (event: string, filter: any, callback: any) => { mockListeners.push({ event, filter, callback }); return channel; },
    subscribe: () => { mockSubscribe(); return channel; },
  }; return channel; }, removeChannel: (...args: any[]) => mockRemove(...args),
} }));
let current: boolean, stop: () => void;
const refresh = jest.fn(), marker = jest.fn();
const options = { channelName: 'synthetic', isCurrent: () => current, refresh };
const emit = (table: string, payload: any, unfiltered = false) => {
  const listener = mockListeners.find(item => item.filter.table === table && (!unfiltered || !item.filter.filter));
  expect(listener).toBeDefined(); listener!.callback(payload);
};
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
const main = () => { stop = subscribeCommunityMain({ ...options, communityId: 'community', hasMessage: id => id === 'known', hasMessages: () => true, onMessage: marker }); };
const replies = () => { stop = subscribeCommunityReplies({ ...options, broadcastId: 'known', hasReply: id => id === 'reply' }); };
beforeEach(() => { jest.clearAllMocks(); mockListeners.length = 0; mockNames.length = 0; mockClosing = false; current = true; refresh.mockReset().mockResolvedValue(undefined); });
afterEach(() => stop?.());

it.each(['INSERT', 'UPDATE', 'DELETE'])('refreshes a loaded message’s %s reaction without acknowledging unread messages', async eventType => {
  main(); emit('community_broadcast_reactions', { eventType, [eventType === 'DELETE' ? 'old' : 'new']: { broadcast_id: 'known' } });
  await settle(); expect(refresh).toHaveBeenCalledTimes(1); expect(marker).not.toHaveBeenCalled();
});
it('ignores reactions and new replies belonging to another community', async () => {
  main(); for (const table of ['community_broadcast_reactions', 'community_broadcast_replies']) emit(table, { eventType: 'INSERT', new: { broadcast_id: 'other' } });
  await settle(); expect(refresh).not.toHaveBeenCalled();
});
it('refreshes known message deletion and reply counts using their available delete identities', async () => {
  main(); emit('community_broadcasts', { eventType: 'DELETE', old: { id: 'known' } }, true); await settle();
  emit('community_broadcast_replies', { eventType: 'DELETE', old: { id: 'only-primary-key' } }); await settle();
  expect(refresh).toHaveBeenCalledTimes(2); expect(marker).not.toHaveBeenCalled();
});
it.each(['main', 'replies'])('catches up %s only when the PostgreSQL stream is actually ready', async kind => {
  kind === 'main' ? main() : replies(); const signal = mockListeners.find(item => item.event === 'system')!.callback;
  signal({ status: 'ok', extension: 'presence' }); signal({ status: 'error', extension: 'postgres_changes' }); await settle(); expect(refresh).not.toHaveBeenCalled();
  signal({ status: 'ok', extension: 'postgres_changes' }); await settle();
  signal({ status: 'ok', extension: 'postgres_changes' }); await settle(); expect(refresh).toHaveBeenCalledTimes(2);
});
it('coalesces a burst and performs one trailing read for changes arriving during a pending read', async () => {
  let finish!: () => void; refresh.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; })); main();
  const change = () => emit('community_broadcast_reactions', { eventType: 'INSERT', new: { broadcast_id: 'known' } });
  change(); change(); change(); await settle(); expect(refresh).toHaveBeenCalledTimes(1);
  change(); change(); finish(); await settle(); expect(refresh).toHaveBeenCalledTimes(2);
});
it('retires queued work, read markers and stale callbacks when the room closes', async () => {
  main(); emit('community_broadcast_reactions', { eventType: 'INSERT', new: { broadcast_id: 'known' } }); stop();
  emit('community_broadcasts', { eventType: 'INSERT', new: { id: 'late' } }); await settle();
  expect(refresh).not.toHaveBeenCalled(); expect(marker).not.toHaveBeenCalled(); expect(mockRemove).toHaveBeenCalledTimes(1);
});
it('drops a trailing refresh after admission is lost and allows recovery after a failed read', async () => {
  refresh.mockRejectedValueOnce(Error('offline')); main();
  const change = () => emit('community_broadcast_reactions', { eventType: 'INSERT', new: { broadcast_id: 'known' } });
  change(); await settle(); change(); await settle(); expect(refresh).toHaveBeenCalledTimes(2);
  current = false; change(); await settle(); expect(refresh).toHaveBeenCalledTimes(2);
});
it('refreshes the open reply panel for known ID-only deletes but ignores other threads', async () => {
  replies(); emit('community_broadcast_replies', { eventType: 'DELETE', old: { id: 'other' } }, true); await settle(); expect(refresh).not.toHaveBeenCalled();
  emit('community_broadcast_replies', { eventType: 'DELETE', old: { id: 'reply' } }, true); await settle(); expect(refresh).toHaveBeenCalledTimes(1);
});

it('waits for the last socket close and gives a returning room its own channel', async () => {
  jest.useFakeTimers();
  try {
    main();stop();mockClosing=true;main();expect(mockSubscribe).toHaveBeenCalledTimes(1);
    expect(new Set(mockNames).size).toBe(2);
    await jest.advanceTimersByTimeAsync(50);expect(mockSubscribe).toHaveBeenCalledTimes(1);
    mockClosing=false;await jest.advanceTimersByTimeAsync(50);expect(mockSubscribe).toHaveBeenCalledTimes(2);
  } finally {jest.useRealTimers();}
});
it('does not join a retired reply panel when a pending socket close finishes',async()=>{
  jest.useFakeTimers();try{mockClosing=true;replies();stop();mockClosing=false;await jest.advanceTimersByTimeAsync(100);expect(mockSubscribe).not.toHaveBeenCalled();}finally{jest.useRealTimers();}
});
