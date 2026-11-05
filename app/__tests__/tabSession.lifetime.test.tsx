import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TabLayout from '../(tabs)/_layout';

const mockSession = jest.fn();
let mockAuth: (event: string, session: any) => void;
const mockUnsubscribe = jest.fn();
jest.mock('expo-router', () => {
  const Tabs = ({ children }: any) => children;
  Tabs.Screen = (props: any) => require('react').createElement('TabScreen', props);
  return { Tabs, usePathname: () => '/plans', router: { push: jest.fn(), replace: jest.fn(), navigate: jest.fn() } };
});
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('../../components/creator/CreatorActionFill', () => ({ CreatorActionFill: () => null }));
jest.mock('../../components/yours/icons/SunriseIcon', () => () => null);
jest.mock('../../components/legal/TermsReacceptance', () => ({ TermsReacceptance: (props: any) => require('react').createElement('Terms', props) }));
jest.mock('../../components/create/CreateMenuSheet', () => (props: any) => require('react').createElement('CreateMenu', props));
jest.mock('../../hooks/useTabBadgeData', () => ({ useTabBadgeData: () => ({ unreadChats: 0, hasPendingInvites: false, pendingRequests: 0 }) }));
jest.mock('../../lib/authGate', () => ({ fetchNeedsPhoneMigration: async () => false }));
jest.mock('../../hooks/useProfile', () => ({ getAuthProfile: async () => null }));
jest.mock('../../lib/ticketing', () => ({ getOrder: jest.fn() }));
jest.mock('../../lib/navState', () => ({ getVerificationDestination: () => null, approveVerificationEntry: jest.fn() }));
jest.mock('../../lib/pendingLink', () => ({ peekPendingCheckout: async () => null, consumePendingDestination: async () => null, clearPendingDestination: async () => {} }));
jest.mock('../../lib/sceneStage', () => ({ SCENE_STAGE: 1, SCENE_BADGE_KEY: ['scene-stage'], getSeenSceneStage: async () => 1 }));
jest.mock('../../constants/FeatureFlags', () => ({ YOURS_PAGE_ENABLED: true }));
jest.mock('../../lib/supabase', () => ({ supabase: { auth: {
  getSession: () => mockSession(),
  getUser: async () => ({ data: { user: null }, error: null }),
  onAuthStateChange: (callback: typeof mockAuth) => { mockAuth = callback; return { data: { subscription: { unsubscribe: mockUnsubscribe } } }; },
} } }));

let tree: ReactTestRenderer;
let client: QueryClient;
let resolveSession: (value: any) => void;
const session = (id: string | null) => id ? { user: { id } } : null;
const termsEnabled = () => tree.root.findByType('Terms' as any).props.enabled;
const menuVisible = () => tree.root.findByType('CreateMenu' as any).props.visible;
async function emit(id: string | null) { await act(async () => mockAuth(id ? 'SIGNED_IN' : 'SIGNED_OUT', session(id))); }
async function settle(id: string | null) { await act(async () => resolveSession({ data: { session: session(id) }, error: null })); }
async function openMenu() { await act(async () => tree.root.findAllByType('TabScreen' as any).find(n => n.props.name === 'post/index')!.props.listeners.tabPress({ preventDefault: jest.fn() })); }
beforeEach(async () => {
  mockUnsubscribe.mockClear();
  mockSession.mockReset().mockImplementation(() => new Promise(resolve => { resolveSession = resolve; }));
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  await act(async () => { tree = create(<QueryClientProvider client={client}><TabLayout /></QueryClientProvider>); });
});
afterEach(() => { act(() => tree.unmount()); client.clear(); });

it('does not re-enable account UI when an old initial session arrives after sign-out', async () => {
  await emit('alice'); expect(termsEnabled()).toBe(true);
  await emit(null); expect(termsEnabled()).toBe(false);
  await settle('alice'); expect(termsEnabled()).toBe(false);
});
it('keeps the new account Create menu open when an old initial session arrives', async () => {
  await emit('bob'); await openMenu(); expect(menuVisible()).toBe(true);
  await settle('alice'); expect(menuVisible()).toBe(true);
});
it('does not clear a new sign-in when the initial signed-out read arrives late', async () => {
  await emit('bob'); await settle(null); expect(termsEnabled()).toBe(true);
});
it('accepts the initial session when no auth event has superseded it', async () => {
  expect(termsEnabled()).toBe(false); await settle('alice'); expect(termsEnabled()).toBe(true);
  await openMenu(); await emit('bob'); expect(menuVisible()).toBe(false);
});
it('unsubscribes on unmount and tolerates the outstanding session result', async () => {
  act(() => tree.unmount()); expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
  await settle('alice');
});
