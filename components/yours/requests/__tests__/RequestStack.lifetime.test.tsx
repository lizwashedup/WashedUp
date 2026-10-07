import React from 'react';
import { Modal, Text } from 'react-native';
import { act, create } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import RequestStack, { type RequestStackProps } from '../RequestStack';
import RequestRow from '../RequestRow';
import BlockPrompt from '../BlockPrompt';
import RequestBanner from '../RequestBanner';
import { AfterglowFonts } from '../../../../constants/Typography';
import type { IncomingRequest } from '../../../../lib/yours/types';

const mockRpc = jest.fn(), mockGetUser = jest.fn();
let mockViewer: string | null = 'alice';
const mockListeners = new Set<(event: string, session: { user: { id: string } } | null) => void>();
jest.mock('../../../../lib/supabase', () => ({ supabase: {
  rpc: (...args: unknown[]) => mockRpc(...args),
  auth: { getUser: () => mockGetUser(), onAuthStateChange: (fn: typeof mockListeners extends Set<infer T> ? T : never) => {
    mockListeners.add(fn); return { data: { subscription: { unsubscribe: () => mockListeners.delete(fn) } } };
  } },
} }));
jest.mock('../../../../lib/haptics', () => ({ hapticSelection: jest.fn(), hapticSuccess: jest.fn() }));
jest.mock('expo-image', () => ({ Image: (props: any) => require('react').createElement('Photo', props) }));
jest.mock('lucide-react-native', () => ({ X: () => null, ChevronRight: () => null }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaProvider: ({ children }: any) => children, SafeAreaView: ({ children, ...props }: any) => require('react').createElement('SafeFrame', props, children) }));
const request = (id: string): IncomingRequest => ({ connection_id: `connection-${id}`, requester_user_id: id,
  first_name_display: id, profile_photo_url: `https://example.invalid/${id}.jpg`, handle: id,
  context: 'handle_lookup', context_event_id: null, context_event_title: null, context_line: 'Found you by your handle', requested_at: '2026-09-13' });
const requests = [request('Bea'), request('Zoe')];
const cleanup: Array<() => void> = [];
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function flush() { await act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); }); }
function mount(extra: Partial<RequestStackProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } });
  let props: RequestStackProps = { visible: true, userId: 'alice', onClose: jest.fn(), requests: [...requests], appearance: { fonts: AfterglowFonts }, ...extra };
  const render = () => <QueryClientProvider client={client}><RequestStack {...props} /></QueryClientProvider>;
  let tree!: ReturnType<typeof create>, mounted = true;
  act(() => { tree = create(render()); });
  const unmount = () => { if (mounted) act(() => tree.unmount()); mounted = false; };
  cleanup.push(() => { unmount(); client.clear(); });
  const update = (next: Partial<RequestStackProps>) => { props = { ...props, ...next }; act(() => tree.update(render())); };
  const button = (label: string) => tree.root.findAll(n => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function')[0];
  return { tree, update, unmount, button, get props() { return props; },
    tap: async (label: string) => { act(() => button(label).props.onPress()); await flush(); },
    text: () => tree.root.findAllByType(Text).flatMap(n => n.props.children).join(' '),
    rows: () => tree.root.findAllByType(RequestRow),
    auth: (id: string | null, updateProp = true) => {
      mockViewer = id;
      act(() => { for (const fn of mockListeners) fn(id ? 'SIGNED_IN' : 'SIGNED_OUT', id ? { user: { id } } : null); });
      if (updateProp) update({ userId: id ?? '' });
    },
  };
}
beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); mockViewer = 'alice'; mockListeners.clear(); mockRpc.mockReset().mockResolvedValue({ error: null }); mockGetUser.mockReset().mockImplementation(async () => ({ data: { user: mockViewer ? { id: mockViewer } : null }, error: null })); });
afterEach(() => { cleanup.splice(0).forEach(fn => fn()); jest.clearAllTimers(); jest.useRealTimers(); });

it('opening the list neither reads auth nor accepts or declines; hidden owns no timer or listener', async () => {
  const f = mount({ visible: false, requests: [] }); await flush(); act(() => jest.advanceTimersByTime(10000));
  expect(mockRpc).not.toHaveBeenCalled(); expect(mockGetUser).not.toHaveBeenCalled(); expect(mockListeners.size).toBe(0); expect(f.props.onClose).not.toHaveBeenCalled();
  f.update({ visible: true, requests }); await flush(); expect(f.rows()).toHaveLength(2); expect(mockRpc).not.toHaveBeenCalled();
});
it('keeps a pending Add visible and prevents close until the void RPC confirms success', async () => {
  const write = deferred<{ error: null }>(); mockRpc.mockReturnValueOnce(write.promise);
  const f = mount({ requests: [requests[0]] }); await f.tap('Add Bea');
  expect(f.text()).toContain('Adding…'); expect(f.rows()).toHaveLength(1); expect(f.button('Add Bea').props.disabled).toBe(true);
  act(() => jest.advanceTimersByTime(2000)); expect(f.props.onClose).not.toHaveBeenCalled();
  await act(async () => write.resolve({ error: null })); await flush();
  expect(f.rows()).toHaveLength(0); act(() => jest.advanceTimersByTime(600)); expect(f.props.onClose).toHaveBeenCalledTimes(1);
  expect(mockRpc).toHaveBeenCalledWith('accept_people_request', { p_requester: 'Bea' });
});
it('guards rapid duplicate Add while auth preflight is unresolved', async () => {
  const auth = deferred<any>(); mockGetUser.mockReturnValueOnce(auth.promise); const f = mount();
  const add = f.button('Add Bea').props.onPress; act(() => { add(); add(); });
  expect(mockGetUser).toHaveBeenCalledTimes(1); await act(async () => auth.resolve({ data: { user: { id: 'alice' } }, error: null })); await flush();
  expect(mockRpc).toHaveBeenCalledTimes(1);
});
it('retains the person and honest error after failed Add, then permits an explicit retry', async () => {
  mockRpc.mockResolvedValueOnce({ error: new Error('offline') }); const f = mount(); await f.tap('Add Bea');
  expect(f.rows()).toHaveLength(2); expect(f.text()).toContain('Try again'); expect(f.props.onClose).not.toHaveBeenCalled();
  await f.tap('Try again to add Bea'); expect(f.rows()).toHaveLength(1); expect(mockRpc).toHaveBeenCalledTimes(2);
});
it('decline requires confirmation and does not reveal Block before confirmed decline', async () => {
  const write = deferred<{ error: null }>(); mockRpc.mockReturnValueOnce(write.promise); const f = mount();
  await f.tap('Decline Bea'); expect(mockRpc).not.toHaveBeenCalled(); expect(f.text()).toContain('Decline Bea?');
  await f.tap('Confirm decline Bea'); expect(f.text()).toContain('Declining…'); expect(f.tree.root.findAllByType(BlockPrompt)).toHaveLength(0);
  await act(async () => write.resolve({ error: null })); await flush();
  expect(f.tree.root.findAllByType(BlockPrompt)).toHaveLength(1); expect(mockRpc).toHaveBeenCalledWith('decline_people_request', { p_requester: 'Bea', p_block: false });
});
it('Keep cancels inline decline without changing the connection', async () => {
  const f = mount(); await f.tap('Decline Bea'); await f.tap('Keep request from Bea');
  expect(mockRpc).not.toHaveBeenCalled(); expect(f.button('Add Bea')).toBeDefined();
});
it('a failed soft decline never opens Block and retry remains confirm-gated', async () => {
  mockRpc.mockResolvedValueOnce({ error: new Error('offline') }); const f = mount(); await f.tap('Decline Bea'); await f.tap('Confirm decline Bea');
  expect(f.tree.root.findAllByType(BlockPrompt)).toHaveLength(0); expect(f.rows()).toHaveLength(2);
  await f.tap('Try again to decline Bea'); expect(mockRpc).toHaveBeenCalledTimes(1); await f.tap('Confirm decline Bea'); expect(mockRpc).toHaveBeenCalledTimes(2);
});
it('offers Block only for the confirmed requester and waits through block failure/retry', async () => {
  const f = mount(); await f.tap('Decline Bea'); await f.tap('Confirm decline Bea');
  const write = deferred<{ error: Error | null }>(); mockRpc.mockReturnValueOnce(write.promise); await f.tap('Block Bea');
  expect(f.text()).toContain('Blocking…'); act(() => jest.advanceTimersByTime(10000)); expect(f.tree.root.findAllByType(BlockPrompt)).toHaveLength(1);
  await act(async () => write.resolve({ error: new Error('offline') })); await flush();
  act(() => jest.advanceTimersByTime(10000)); expect(f.tree.root.findAllByType(BlockPrompt)).toHaveLength(1); expect(f.text()).toContain('Try again');
  await f.tap('Try again to block Bea'); expect(f.tree.root.findAllByType(BlockPrompt)).toHaveLength(0);
  expect(mockRpc.mock.calls.slice(1)).toEqual([['decline_people_request', { p_requester: 'Bea', p_block: true }], ['decline_people_request', { p_requester: 'Bea', p_block: true }]]);
});
it('preserves the legacy optional Block timer without blocking', async () => {
  const f = mount({ appearance: undefined }); await f.tap('Decline Bea'); await f.tap('Confirm decline Bea'); act(() => jest.advanceTimersByTime(4000));
  expect(f.tree.root.findAllByType(BlockPrompt)).toHaveLength(0); expect(mockRpc).toHaveBeenCalledTimes(1);
});
it('keeps close available during saving and suppresses success after dismissal even before visible prop updates', async () => {
  const write = deferred<{ error: null }>(); mockRpc.mockReturnValueOnce(write.promise); const f = mount(); await f.tap('Add Bea'); await f.tap('Close requests');
  await act(async () => write.resolve({ error: null })); await flush(); act(() => jest.advanceTimersByTime(2000));
  expect(f.props.onClose).toHaveBeenCalledTimes(1); expect(f.rows()).toHaveLength(2);
});
it.each(['close', 'account', 'signout', 'auth-roundtrip', 'unmount'])('retires preflight before RPC on %s', async kind => {
  const auth = deferred<any>(); mockGetUser.mockReturnValueOnce(auth.promise); const f = mount(); await f.tap('Add Bea');
  if (kind === 'close') f.update({ visible: false });
  if (kind === 'account') f.update({ userId: 'bob' });
  if (kind === 'signout') f.auth(null, false);
  if (kind === 'auth-roundtrip') { f.auth('bob', false); f.auth('alice', false); }
  if (kind === 'unmount') f.unmount();
  await act(async () => auth.resolve({ data: { user: { id: 'alice' } }, error: null })); await flush();
  expect(mockRpc).not.toHaveBeenCalled();
});
it.each(['success', 'failure'])('retired %s never updates, closes or opens Block in a reopened visit', async outcome => {
  const write = deferred<any>(); mockRpc.mockReturnValueOnce(write.promise); const f = mount(); await f.tap('Decline Bea'); await f.tap('Confirm decline Bea');
  f.update({ visible: false }); f.update({ visible: true });
  await act(async () => write.resolve({ error: outcome === 'failure' ? new Error('blocked') : null })); await flush(); act(() => jest.advanceTimersByTime(1000));
  expect(f.rows()).toHaveLength(2); expect(f.tree.root.findAllByType(BlockPrompt)).toHaveLength(0); expect(f.props.onClose).not.toHaveBeenCalled(); expect(f.text()).not.toContain("You can't add this person.");
});
it('an unresolved earlier visit does not allow a duplicate request after reopen', async () => {
  const write = deferred<any>(); mockRpc.mockReturnValueOnce(write.promise); const f = mount(); await f.tap('Add Bea');
  f.update({ visible: false }); f.update({ visible: true }); await f.tap('Add Bea');
  expect(mockRpc).toHaveBeenCalledTimes(1); expect(f.text()).toContain('earlier request');
  await act(async () => write.resolve({ error: null })); await flush();
});
it('ignores old Add and decline confirmations after account A to B to A', async () => {
  const f = mount(); const add = f.button('Add Bea').props.onPress; await f.tap('Decline Bea'); const decline = f.button('Confirm decline Bea').props.onPress;
  f.update({ userId: 'bob' }); f.update({ userId: 'alice' }); act(() => { add(); decline(); }); await flush();
  expect(mockRpc).not.toHaveBeenCalled(); expect(f.text()).not.toContain('Decline Bea?');
});
it('keeps pending snapshots until completion when query data removes them early', async () => {
  const write = deferred<any>(); mockRpc.mockReturnValueOnce(write.promise); const f = mount({ requests: [requests[0]] }); await f.tap('Add Bea');
  f.update({ requests: [] }); act(() => jest.advanceTimersByTime(2000)); expect(f.rows()).toHaveLength(1); expect(f.props.onClose).not.toHaveBeenCalled();
  await act(async () => write.resolve({ error: null })); await flush(); expect(f.rows()).toHaveLength(0);
});
it('does not dispatch against a withdrawn request after preflight', async () => {
  const auth = deferred<any>(); mockGetUser.mockReturnValueOnce(auth.promise); const f = mount(); await f.tap('Add Bea'); f.update({ requests: [requests[1]] });
  await act(async () => auth.resolve({ data: { user: { id: 'alice' } }, error: null })); await flush();
  expect(mockRpc).not.toHaveBeenCalled(); expect(f.text()).toContain('This request is no longer available.'); expect(f.button('Add Bea')).toBeUndefined(); expect(f.button('Decline Bea')).toBeUndefined();
});
it('updates only the captured row while another request changes or completes', async () => {
  const first = deferred<any>(); mockRpc.mockImplementation((_, args) => args.p_requester === 'Bea' ? first.promise : Promise.resolve({ error: null }));
  const f = mount(); await f.tap('Add Bea'); await f.tap('Add Zoe'); expect(f.rows().map(r => r.props.req.requester_user_id)).toEqual(['Bea']);
  f.update({ requests: [request('New'), requests[0]] }); await act(async () => first.resolve({ error: null })); await flush();
  expect(f.rows().map(r => r.props.req.requester_user_id)).toEqual(['New']);
});
it('preserves highlighted-request sorting without automatically acting on it', () => {
  const f = mount({ highlightRequesterId: 'Zoe' }); expect(f.rows().map(r => r.props.req.requester_user_id)).toEqual(['Zoe', 'Bea']); expect(mockRpc).not.toHaveBeenCalled();
});
it('auth failure keeps the request and never writes', async () => {
  mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: new Error('offline') }); const f = mount(); await f.tap('Add Bea');
  expect(mockRpc).not.toHaveBeenCalled(); expect(f.rows()).toHaveLength(2); expect(f.text()).toContain('Try again');
});
it('native dismissal closes without choosing a request', () => {
  const f = mount(); act(() => f.tree.root.findByType(Modal).props.onRequestClose()); expect(f.props.onClose).toHaveBeenCalledTimes(1); expect(mockRpc).not.toHaveBeenCalled();
});
it('banner is absent at zero and keeps its explicit request callback', () => {
  const onPress = jest.fn(); let tree!: ReturnType<typeof create>;
  act(() => { tree = create(<RequestBanner count={0} onPress={onPress} appearance={{ fonts: AfterglowFonts }} />); }); cleanup.push(() => act(() => tree.unmount())); expect(tree.toJSON()).toBeNull();
  act(() => tree.update(<RequestBanner count={2} onPress={onPress} appearance={{ fonts: AfterglowFonts }} />));
  act(() => tree.root.findAll(n => typeof n.props.onPress === 'function')[0].props.onPress()); expect(onPress).toHaveBeenCalledTimes(1);
});

it('does not carry inline decline confirmation into a replacement request identity', () => {
  const add = jest.fn(), decline = jest.fn(); let tree!: ReturnType<typeof create>;
  act(() => { tree = create(<RequestRow req={requests[0]} onAdd={add} onDecline={decline} appearance={{ fonts: AfterglowFonts }} />); }); cleanup.push(() => act(() => tree.unmount()));
  const button = (label: string) => tree.root.findAll(n => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function')[0];
  act(() => button('Decline Bea').props.onPress()); expect(button('Confirm decline Bea')).toBeDefined();
  act(() => tree.update(<RequestRow req={{ ...requests[0], requested_at: '2026-09-14' }} onAdd={add} onDecline={decline} appearance={{ fonts: AfterglowFonts }} />));
  expect(button('Confirm decline Bea')).toBeUndefined(); expect(button('Add Bea')).toBeDefined(); expect(decline).not.toHaveBeenCalled();
});
it('request photo fallback resets for a replacement and ignores the retired load error', () => {
  const f = mount({ requests: [requests[0]] }); const error = f.tree.root.findByType('Photo' as any).props.onError;
  act(() => error()); expect(f.tree.root.findAllByType('Photo' as any)).toHaveLength(0);
  f.update({ requests: [{ ...requests[0], profile_photo_url: 'https://example.invalid/replacement.jpg' }] });
  act(() => error()); expect(f.tree.root.findByType('Photo' as any).props.source.uri).toBe('https://example.invalid/replacement.jpg');
});
it('a known mismatched account is rejected before the mutation', async () => {
  mockGetUser.mockResolvedValueOnce({ data: { user: { id: 'bob' } }, error: null }); const f = mount(); await f.tap('Add Bea');
  expect(mockRpc).not.toHaveBeenCalled(); expect(f.text()).toContain('Your account changed');
});
it('a stale block action after a new visit cannot block its captured person', async () => {
  const f = mount(); await f.tap('Decline Bea'); await f.tap('Confirm decline Bea'); const block = f.button('Block Bea').props.onPress;
  f.update({ visible: false }); f.update({ visible: true }); act(() => block()); await flush();
  expect(mockRpc).toHaveBeenCalledTimes(1); expect(f.tree.root.findAllByType(BlockPrompt)).toHaveLength(0);
});

it('keeps the staged Block choice available without a reading deadline', async () => {
  const f = mount(); await f.tap('Decline Bea'); await f.tap('Confirm decline Bea');
  act(() => jest.advanceTimersByTime(60000)); expect(f.button('Block Bea')).toBeDefined(); expect(f.props.onClose).not.toHaveBeenCalled();
  await f.tap('No thanks, skip blocking'); expect(f.tree.root.findAllByType(BlockPrompt)).toHaveLength(0); expect(mockRpc).toHaveBeenCalledTimes(1);
});
