import React from 'react';
import { act, create } from 'react-test-renderer';
import { PlanCard } from '../PlanCard';
import { BrandedAlert } from '../../BrandedAlert';

const mockPush = jest.fn(), mockRead = jest.fn(), mockAuth = jest.fn();
let mockFocused = true;
const mockListeners = new Set<(event: string, session: any) => void>();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useFocusEffect: (callback: () => void) => require('react').useEffect(
    () => mockFocused ? callback() : undefined, [callback, mockFocused]),
}));
jest.mock('../../../lib/supabase', () => ({ supabase: {
  auth: {
    getUser: () => mockAuth(),
    onAuthStateChange: (callback: any) => {
      mockListeners.add(callback);
      return { data: { subscription: { unsubscribe: () => mockListeners.delete(callback) } } };
    },
  },
  from: () => ({ select: () => ({ eq: () => ({ single: () => mockRead() }) }) }),
} }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
jest.mock('../../BrandedAlert', () => ({ BrandedAlert: () => null }));
const plan = { id: 'plan-one', title: 'Picnic', host_message: null, start_time: '2099-01-01T20:00:00Z',
  status: 'active', location_text: 'Park', category: 'outdoors', max_invites: 7, member_count: 8,
  allow_duplicate: true, creator: { id: 'creator', first_name_display: 'Alex', profile_photo_url: null } };
const source = { ...plan, circle_id: null, description: 'Bring a blanket', tickets_url: 'https://example.invalid/tickets' };
let tree: ReturnType<typeof create>, props: React.ComponentProps<typeof PlanCard>;
const render = () => <PlanCard {...props} plan={{ ...props.plan }} />;
const update = () => act(() => tree.update(render()));
const button = () => tree.root.findAll(node => node.props.accessibilityLabel === 'Post your own' && typeof node.props.onPress === 'function')[0];
const alert = () => tree.root.findAllByType(BrandedAlert)[0];
function deferred() { let resolve!: (value: any) => void; const promise = new Promise<any>(yes => { resolve = yes; }); return { promise, resolve }; }
async function flush() { await act(async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); }); }
beforeEach(() => {
  jest.useFakeTimers(); jest.clearAllMocks(); mockListeners.clear(); mockFocused = true;
  mockAuth.mockResolvedValue({ data: { user: { id: 'alice' } }, error: null });
  mockRead.mockResolvedValue({ data: source, error: null }); props = { plan };
  act(() => { tree = create(render()); });
});
afterEach(() => { act(() => tree.unmount()); jest.clearAllTimers(); jest.useRealTimers(); });
it('locks repeated taps before the first render can disable the action', async () => {
  const wait = deferred(); mockRead.mockReturnValue(wait.promise); const press = button().props.onPress;
  act(() => { void press(); void press(); }); await flush(); expect(mockRead).toHaveBeenCalledTimes(1);
  wait.resolve({ data: source, error: null }); await flush(); expect(mockPush).toHaveBeenCalledTimes(1);
});
it.each(['unmount', 'blur-return', 'replacement'])('does not open an old draft after %s', async retirement => {
  const wait = deferred(); mockRead.mockReturnValue(wait.promise); act(() => { void button().props.onPress(); }); await flush();
  if (retirement === 'unmount') act(() => tree.unmount());
  if (retirement === 'blur-return') { mockFocused = false; update(); mockFocused = true; update(); }
  if (retirement === 'replacement') { props = { plan: { ...plan, id: 'plan-two' } }; update(); }
  wait.resolve({ data: source, error: null }); await flush(); expect(mockPush).not.toHaveBeenCalled();
});
it.each([{ allow_duplicate: false }, { circle_id: 'private-circle' }, { status: 'cancelled' }, { id: 'other-plan' }])('rejects a source that is no longer eligible: %p', async change => {
  mockRead.mockResolvedValue({ data: { ...source, ...change }, error: null });
  await act(async () => { await button().props.onPress(); }); expect(mockPush).not.toHaveBeenCalled(); expect(alert()).toBeDefined();
});
it('recovers a stalled read and ignores its late result before an explicit retry', async () => {
  const wait = deferred(); mockRead.mockReturnValueOnce(wait.promise); act(() => { void button().props.onPress(); });
  await act(async () => { await jest.advanceTimersByTimeAsync(12001); });
  expect(button().props.disabled).toBe(false); expect(alert()).toBeDefined();
  wait.resolve({ data: source, error: null }); await flush(); expect(mockPush).not.toHaveBeenCalled();
  act(() => alert().props.onClose()); await act(async () => { await button().props.onPress(); }); expect(mockPush).toHaveBeenCalledTimes(1);
});
it('shows a retryable read error rather than silently ignoring the tap', async () => {
  mockRead.mockResolvedValue({ data: null, error: new Error('offline') });
  await act(async () => { await button().props.onPress(); }); expect(alert()).toBeDefined(); expect(button().props.disabled).toBe(false);
});
it('retains the established duplicate prefill for an eligible source', async () => {
  await act(async () => { await button().props.onPress(); });
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/(tabs)/post', params: expect.objectContaining({
    prefillTitle: 'Picnic', prefillDescription: 'Bring a blanket', duplicatedFromEventId: 'plan-one',
    prefillStartTime: source.start_time, prefillTicketsUrl: source.tickets_url,
  }) });
});
it('retires a source read across an account round trip', async () => {
  const wait = deferred(); mockRead.mockReturnValue(wait.promise); act(() => { void button().props.onPress(); }); await flush();
  act(() => { for (const callback of mockListeners) { callback('SIGNED_IN', { user: { id: 'bob' } }); callback('SIGNED_IN', { user: { id: 'alice' } }); } });
  wait.resolve({ data: source, error: null }); await flush(); expect(mockPush).not.toHaveBeenCalled();
});
it('keeps the tap locked until navigation leaves the card', async () => {
  const press = button().props.onPress;
  await act(async () => { await press(); });
  await act(async () => { await press(); });
  expect(mockPush).toHaveBeenCalledTimes(1);
});
it('recovers a stalled account check without dispatching its late source read', async () => {
  const wait = deferred(); mockAuth.mockReturnValueOnce(wait.promise);
  act(() => { void button().props.onPress(); });
  await act(async () => { await jest.advanceTimersByTimeAsync(12001); });
  expect(button().props.disabled).toBe(false); expect(alert()).toBeDefined();
  wait.resolve({ data: { user: { id: 'alice' } }, error: null }); await flush();
  expect(mockRead).not.toHaveBeenCalled();
  act(() => alert().props.onClose()); await act(async () => { await button().props.onPress(); });
  expect(mockPush).toHaveBeenCalledTimes(1);
});
it('ignores the source after the card becomes joined', async () => {
  const wait = deferred(); mockRead.mockReturnValue(wait.promise);
  act(() => { void button().props.onPress(); }); await flush(); props = { plan, isMember: true }; update();
  wait.resolve({ data: source, error: null }); await flush(); expect(mockPush).not.toHaveBeenCalled();
});
it('does not load a source for an unconfirmed account', async () => {
  mockAuth.mockResolvedValue({ data: { user: null }, error: null });
  await act(async () => { await button().props.onPress(); }); expect(mockRead).not.toHaveBeenCalled(); expect(alert()).toBeDefined();
});
it('preserves same-account token refresh and removes its temporary auth listener', async () => {
  const wait = deferred(); mockRead.mockReturnValue(wait.promise);
  act(() => { void button().props.onPress(); }); await flush();
  act(() => { for (const callback of mockListeners) callback('TOKEN_REFRESHED', { user: { id: 'alice' } }); });
  wait.resolve({ data: source, error: null }); await flush(); expect(mockPush).toHaveBeenCalledTimes(1); expect(mockListeners.size).toBe(0);
});
