import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Text } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import NewUserEmptyView from '../NewUserEmptyView';
import NearbyPlanCard from '../../nearby/NearbyPlanCard';

const mockRead = jest.fn(), mockInvite = jest.fn(), mockPush = jest.fn();
jest.mock('../../../../lib/supabase', () => ({ supabase: { from: () => {
  const query = { select: () => query, in: () => query, gte: () => query, order: () => query, limit: () => mockRead() };
  return query;
} } }));
jest.mock('expo-router', () => ({ router: { push: (...args: unknown[]) => mockPush(...args) } }));
jest.mock('../../../../hooks/useAfterglowFonts', () => ({ useAfterglowFonts: () => ({ fonts: require('../../../../constants/Typography').CreatorFonts }) }));
jest.mock('lucide-react-native', () => ({ ChevronRight: () => null }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: require('react-native').View }));

const plan = { id: 'sunday', title: 'Sunday by the water', start_time: '2030-09-24T18:00:00Z', member_count: 3 };
let tree: ReactTestRenderer, client: QueryClient;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
function mount() {
  act(() => { tree = create(<QueryClientProvider client={client}><NewUserEmptyView onInvite={mockInvite} /></QueryClientProvider>); });
}
function words() { return tree.root.findAllByType(Text).map(n => n.props.children).join(' '); }
function action(label: string) {
  return tree.root.findAll(n => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function')[0];
}
async function flush() {
  await act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); });
  await act(async () => { jest.advanceTimersByTime(1); for (let i = 0; i < 8; i++) await Promise.resolve(); });
}
beforeEach(() => {
  jest.useFakeTimers(); jest.clearAllMocks();
  mockRead.mockReset().mockResolvedValue({ data: [], error: null });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
});
afterEach(() => { act(() => tree?.unmount()); client.clear(); jest.useRealTimers(); });

it('keeps invitation available while loading, then omits the plan section after a successful empty result', async () => {
  const pending = deferred<any>(); mockRead.mockReturnValueOnce(pending.promise); mount();
  expect(words()).toContain('Keep your people close');
  expect(words()).toContain('Meet at a plan. Keep in touch here.');
  expect(words()).toContain('Finding upcoming plans');
  act(() => action('Invite a friend').props.onPress()); expect(mockInvite).toHaveBeenCalledTimes(1);
  pending.resolve({ data: [], error: null }); await flush();
  expect(words()).not.toContain('Upcoming plans');
  expect(words()).not.toContain('Finding upcoming plans');
  expect(words()).not.toContain('near you');
  expect(words()).not.toContain('decide who stays');
  expect(action('Try again')).toBeUndefined();
  expect(tree.root.findAllByType(NearbyPlanCard)).toHaveLength(0);
  act(() => action('Invite a friend').props.onPress()); expect(mockInvite).toHaveBeenCalledTimes(2);
});

it('renders the returned upcoming plans in order and preserves each existing plan destination', async () => {
  const later = { ...plan, id: 'later', title: 'A longer walk along the coast with friends', member_count: null };
  mockRead.mockResolvedValue({ data: [plan, later], error: null }); mount(); await flush();
  expect(words()).toContain('Upcoming plans');
  expect(words()).not.toContain('near you');
  expect(tree.root.findAllByType(NearbyPlanCard).map(n => n.props.plan.id)).toEqual(['sunday', 'later']);
  act(() => { action(plan.title).props.onPress(); action(later.title).props.onPress(); });
  expect(mockPush.mock.calls).toEqual([['/plan/sunday'], ['/plan/later']]);
});

it('distinguishes a failed read from empty success and retries once even with repeated taps', async () => {
  mockRead.mockResolvedValueOnce({ data: null, error: new Error('offline') }); mount(); await flush();
  expect(words()).toContain('Plans couldn’t load.');
  expect(words()).toContain('Upcoming plans');
  expect(words()).not.toContain('Finding upcoming plans');
  const pending = deferred<any>(); mockRead.mockReturnValueOnce(pending.promise);
  const retry = action('Try again').props.onPress;
  act(() => { retry(); retry(); }); await flush();
  expect(mockRead).toHaveBeenCalledTimes(2);
  // Initial-read retry may temporarily return to loading; invite never disappears.
  expect(action('Invite a friend')).toBeDefined();
  pending.resolve({ data: [], error: null }); await flush();
  expect(words()).not.toContain('Plans couldn’t load.');
  expect(words()).not.toContain('Upcoming plans');
});

it('retains cached cards during refresh failure and retry, then replaces them with the successful result', async () => {
  client.setQueryData(['yours', 'nearby-plans'], [plan]);
  mockRead.mockResolvedValueOnce({ data: null, error: new Error('offline') }); mount(); await flush();
  expect(words()).toContain('Couldn’t refresh these plans.');
  expect(words()).not.toContain('Plans couldn’t load.');
  expect(tree.root.findAllByType(NearbyPlanCard)).toHaveLength(1);
  act(() => action(plan.title).props.onPress()); expect(mockPush).toHaveBeenCalledWith('/plan/sunday');
  const pending = deferred<any>(); mockRead.mockReturnValueOnce(pending.promise);
  const retry = action('Try again').props.onPress;
  act(() => { retry(); retry(); }); await flush();
  expect(mockRead).toHaveBeenCalledTimes(2);
  expect(action('Try again').props.disabled).toBe(true);
  expect(words()).toContain('Retrying…');
  expect(tree.root.findAllByType(NearbyPlanCard)[0].props.plan.id).toBe('sunday');
  act(() => action('Invite a friend').props.onPress()); expect(mockInvite).toHaveBeenCalledTimes(1);
  pending.resolve({ data: [{ ...plan, id: 'new-plan', title: 'A new plan' }], error: null }); await flush();
  expect(words()).not.toContain('Couldn’t refresh');
  expect(tree.root.findAllByType(NearbyPlanCard).map(n => n.props.plan.id)).toEqual(['new-plan']);
});

it('does not replace cached cards with a loading placeholder during a background read', async () => {
  client.setQueryData(['yours', 'nearby-plans'], [plan]);
  const pending = deferred<any>(); mockRead.mockReturnValueOnce(pending.promise); mount();
  expect(words()).toContain('Upcoming plans');
  expect(words()).not.toContain('Finding upcoming plans');
  expect(tree.root.findAllByType(NearbyPlanCard)[0].props.plan.id).toBe('sunday');
  pending.resolve({ data: [plan], error: null }); await flush();
  expect(tree.root.findAllByType(NearbyPlanCard)).toHaveLength(1);
});

it('offers a usable retry again after another failure without hiding the invitation', async () => {
  mockRead.mockResolvedValue({ data: null, error: new Error('offline') }); mount(); await flush();
  act(() => action('Try again').props.onPress()); await flush();
  expect(words()).toContain('Plans couldn’t load.');
  expect(action('Try again').props.disabled).toBe(false);
  act(() => action('Try again').props.onPress()); await flush();
  expect(mockRead).toHaveBeenCalledTimes(3);
  act(() => action('Invite a friend').props.onPress()); expect(mockInvite).toHaveBeenCalledTimes(1);
});
