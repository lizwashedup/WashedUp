import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Text, TouchableOpacity } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
const mockRead = jest.fn();
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({ id: 'organizer' }), router: { back: jest.fn(), push: jest.fn() }, Stack: { Screen: () => null }, Redirect: () => null }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: require('react-native').View }));
jest.mock('../../../constants/FeatureFlags', () => ({ CREATOR_PAGES_ENABLED: true, COMMUNITIES_ENABLED: true }));
jest.mock('../../../components/ProfileButton', () => () => null);
jest.mock('../../../components/creator/OrganizationManageLink', () => ({ OrganizationManageLink: () => null }));
jest.mock('../../../components/creator/pages/PublicOrganizationPageScreen', () => () => null);
jest.mock('../../../components/events/EventMediaImage', () => ({ EventMediaImage: () => null }));
jest.mock('../../../components/yours/state/useAuthUserId', () => ({ useAuthUserId: () => ({ data: null }) }));
jest.mock('../../../lib/organizerProfile', () => ({ getOrganizationPage: () => mockRead() }));
jest.mock('../../../lib/organizerFollows', () => ({ getFollowerCount: async () => null }));
jest.mock('../../../lib/haptics', () => ({ hapticLight: () => {}, hapticError: () => {}, hapticSuccess: () => {} }));
jest.mock('../../../lib/url', () => ({ openUrl: jest.fn() }));
import Route from '../[id]';
let tree: ReactTestRenderer;
let client: QueryClient;
const data = { profile: { user_id: 'organizer', display_name: 'Local Walks', city: null, bio: null, logo_url: null, link_url: null }, upcomingEvents: [], pastEvents: [] };
const words = () => tree.root.findAllByType(Text).map(n => n.props.children).flat().join(' ');
const retry = () => tree.root.findAllByType(TouchableOpacity).find(n => n.props.accessibilityLabel === 'Retry organization page');
async function flush() { await act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); }); await act(async () => jest.advanceTimersByTime(1)); }
async function mount() { await act(async () => { tree = create(<QueryClientProvider client={client}><Route /></QueryClientProvider>); }); await flush(); }
beforeEach(() => { jest.useFakeTimers(); mockRead.mockReset().mockResolvedValue(data); client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } }); });
afterEach(() => { act(() => tree?.unmount()); client.clear(); jest.useRealTimers(); });
it('offers a retry for a failed read instead of claiming the page is gone', async () => {
  mockRead.mockRejectedValueOnce(new Error('Offline')); await mount();
  expect(words()).not.toContain("this page isn't around"); expect(retry()).toBeDefined();
  act(() => retry()!.props.onPress()); await flush(); expect(words()).toContain('Local Walks');
});
it('ends a stalled read with a reachable retry', async () => {
  mockRead.mockImplementationOnce(() => new Promise(() => {})); await mount();
  await act(async () => jest.advanceTimersByTime(12000)); await flush(); expect(retry()).toBeDefined();
  act(() => retry()!.props.onPress()); await flush(); expect(words()).toContain('Local Walks');
});
it('keeps confirmed content visible after a refresh failure and retries in place', async () => {
  await mount(); mockRead.mockRejectedValueOnce(new Error('Offline'));
  await act(async () => { await client.invalidateQueries({ queryKey: ['organization-page'] }); }); await flush();
  expect(words()).toContain('Local Walks'); expect(retry()).toBeDefined();
  act(() => retry()!.props.onPress()); await flush(); expect(words()).toContain('Local Walks'); expect(retry()).toBeUndefined();
});
it('preserves the confirmed-missing destination', async () => {
  mockRead.mockResolvedValue(null); await mount(); expect(words()).toContain("this page isn't around"); expect(retry()).toBeUndefined();
});
