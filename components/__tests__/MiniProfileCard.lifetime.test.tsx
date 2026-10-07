import React from 'react';
import { Text, TouchableOpacity } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import MiniProfileCard from '../MiniProfileCard';
const mockGetUser = jest.fn(), mockFrom = jest.fn(), mockRpc = jest.fn();
const mockListeners = new Set<(event: string, session?: any) => void>();
jest.mock('../../lib/supabase', () => ({ supabase: { auth: {
  getUser: () => mockGetUser(),
  onAuthStateChange: (cb: any) => { mockListeners.add(cb); return { data: { subscription: { unsubscribe: () => mockListeners.delete(cb) } } }; },
}, from: (...args: any[]) => mockFrom(...args), rpc: (...args: any[]) => mockRpc(...args) } }));
jest.mock('../marks/MarkIcons', () => ({ __esModule: true, default: () => null }));
const deferred = () => { let resolve!: (v: any) => void; const promise = new Promise<any>(done => { resolve = done; }); return { promise, resolve }; };
const auth = (id: string) => ({ data: { user: { id } }, error: null });
const peer = (name: string) => ({ data: { first_name_display: name, profile_photo_url: null }, error: null });
let tree: ReactTestRenderer;
const onClose = jest.fn(), onReport = jest.fn(), onBlock = jest.fn();
const screen = (visible = true, userId: string | null = 'peer') => <MiniProfileCard visible={visible} userId={userId} onClose={onClose} onReport={onReport} onBlock={onBlock} />;
const mount = async (visible = true) => { await act(async () => { tree = create(screen(visible)); }); };
const texts = () => tree.root.findAllByType(Text).map(n => n.props.children);
const button = (label: string) => tree.root.findAllByType(TouchableOpacity).find(n => n.props.accessibilityLabel === label);
beforeEach(() => {
  jest.useFakeTimers(); jest.clearAllMocks(); mockListeners.clear(); mockGetUser.mockResolvedValue(auth('viewer'));
  mockFrom.mockImplementation(() => { const q: any = { select: () => q, eq: () => q, single: async () => peer('Peer') }; return q; });
  mockRpc.mockResolvedValue({ data: [], error: null });
});
afterEach(() => { act(() => tree?.unmount()); jest.useRealTimers(); });
it('makes no hidden auth or profile reads, then verifies identity on opening', async () => {
  await mount(false); expect(mockGetUser).not.toHaveBeenCalled(); expect(mockFrom).not.toHaveBeenCalled(); expect(mockRpc).not.toHaveBeenCalled();
  await act(async () => tree.update(screen())); expect(mockGetUser).toHaveBeenCalledTimes(1); expect(button('Report Peer')).toBeDefined();
});
it('does not read profiles or expose moderation before opening identity is confirmed', async () => {
  const pending = deferred(); mockGetUser.mockReturnValue(pending.promise); await mount();
  expect(mockFrom).not.toHaveBeenCalled(); expect(button('Report Peer')).toBeUndefined();
  await act(async () => pending.resolve(auth('peer'))); expect(button('Report Peer')).toBeUndefined(); expect(button('Block Peer')).toBeUndefined();
});
it('ignores auth that completes after closing and does not start profile reads', async () => {
  const pending = deferred(); mockGetUser.mockReturnValue(pending.promise); await mount();
  await act(async () => tree.update(screen(false, null))); await act(async () => pending.resolve(auth('viewer')));
  expect(mockFrom).not.toHaveBeenCalled(); expect(mockRpc).not.toHaveBeenCalled();
});
it('does not leak an old target profile or continue its marks lookup', async () => {
  const pending = deferred(); let target = '';
  mockFrom.mockImplementation(() => { const q: any = { select: () => q, eq: (_k: string, id: string) => { target = id; return q; }, single: () => target === 'peer' ? pending.promise : Promise.resolve(peer('New peer')) }; return q; });
  await mount(); await act(async () => tree.update(screen(true, 'new-peer'))); expect(texts()).toContain('New peer');
  await act(async () => pending.resolve(peer('Old peer'))); expect(texts()).not.toContain('Old peer');
  expect(mockRpc.mock.calls.map(a => a[1].p_user_id)).toEqual(['new-peer']);
});
it('rejects an old auth result after account change', async () => {
  const pending = deferred(); mockGetUser.mockReturnValueOnce(pending.promise).mockResolvedValue(auth('peer')); await mount();
  await act(async () => { for (const cb of mockListeners) cb('SIGNED_IN', { user: { id: 'peer' } }); });
  await act(async () => pending.resolve(auth('viewer'))); expect(button('Report Peer')).toBeUndefined(); expect(button('Block Peer')).toBeUndefined();
});
it('keeps intentional report dismissal sequencing without a hidden reread', async () => {
  await mount(); const reads = mockGetUser.mock.calls.length;
  act(() => button('Report Peer')!.props.onPress()); await act(async () => tree.update(screen(false, null)));
  act(() => jest.advanceTimersByTime(150)); expect(onReport).toHaveBeenCalledWith('peer', 'Peer'); expect(mockGetUser).toHaveBeenCalledTimes(reads);
});
it('cancels delayed moderation after an auth change', async () => {
  await mount(); act(() => button('Block Peer')!.props.onPress()); await act(async () => tree.update(screen(false, null)));
  await act(async () => { for (const cb of mockListeners) cb('SIGNED_OUT', null); });
  act(() => jest.advanceTimersByTime(150)); expect(onBlock).not.toHaveBeenCalled();
});
it('ends a stalled auth read with no moderation or profile work', async () => {
  mockGetUser.mockReturnValue(new Promise(() => {})); await mount(); await act(async () => { jest.advanceTimersByTime(12000); });
  expect(button('Report Member')).toBeUndefined(); expect(mockFrom).not.toHaveBeenCalled();
});
