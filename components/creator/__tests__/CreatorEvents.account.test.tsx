import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Text } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Screen from '../../../app/(creator)/events';

let mockUser = 'alice';
const mockUserRead = jest.fn();
const mockTemplates = jest.fn();
const mockAccess = jest.fn();
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ section: 'drafts' }),
  useFocusEffect: (fn: () => void) => require('react').useEffect(fn, [fn]),
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock('../../../lib/creatorMode', () => ({
  getCreatorEvents: (...args: unknown[]) => mockUserRead(...args),
  getCreatorAccess: (...args: unknown[]) => mockAccess(...args),
}));
jest.mock('../../../lib/supabase', () => ({ supabase: { auth: { getUser: async () => ({ data: { user: { id: mockUser } } }) } } }));
jest.mock('../../../lib/creatorEvents', () => ({ listEventTemplates: () => mockTemplates() }));
jest.mock('../../../constants/FeatureFlags', () => ({ CREATOR_PAGES_ENABLED: false }));
jest.mock('../../../hooks/useCreatorPageScope', () => ({
  useCreatorPageScope: () => {
    const id = mockUser;
    const scope = require('react').useMemo(() => ({ userId: id, isCurrent: () => mockUser === id }), [id]);
    return { scope, focused: true, account: { viewerId: id, epoch: 1, isLoading: false, isCurrent: scope.isCurrent } };
  },
}));
jest.mock('../../../lib/selectedCommunity', () => ({ useLedCommunity: () => null }));
jest.mock('../../../lib/workspaceContext', () => ({ useWorkspace: (access: unknown) => access ? 'organization' : null, eventBelongsToWorkspace: () => true }));
jest.mock('../../../hooks/useAfterglowFonts', () => ({ useAfterglowFonts: () => ({ fonts: require('../../../constants/Typography').CreatorFonts }) }));
jest.mock('../CreatorActionFill', () => ({ CreatorActionFill: () => null }));
jest.mock('../../events/EventMediaImage', () => ({ EventMediaImage: () => null }));

it.each(['Drafts', 'Templates'])('never shows the previous account’s %s during a slow account switch', async segment => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const row = (id: string) => [{ id, name: id, title: id, fields: { title: id, image_url: '' }, status: 'Draft', community_id: null, event_date: null, tiers: [] }];
  let release!: () => void;
  const wait = new Promise<void>(done => { release = done; });
  const read = async () => { const id = mockUser; if (id === 'bob') await wait; return row(id + ' private title'); };
  mockUserRead.mockImplementation(read);
  mockTemplates.mockImplementation(read);
  mockAccess.mockResolvedValue({ hasEventHostGrant: true, ledCommunities: [] });
  const ui = () => <QueryClientProvider client={client}><Screen key={mockUser}/></QueryClientProvider>;
  let tree!: ReactTestRenderer;
  const labels = () => tree.root.findAllByType(Text).map(n => n.props.children).filter(v => typeof v === 'string').join(' ');
  const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  const showSegment = async () => {
    const target = tree.root.findAll(n => n.props.accessibilityLabel === segment && typeof n.props.onPress === 'function')[0];
    act(() => target.props.onPress()); await settle();
  };
  try {
    mockUser = 'alice';
    await act(async () => { tree = create(ui()); }); await settle(); await showSegment();
    expect(labels()).toContain('alice private title');
    mockUser = 'bob'; await act(async () => tree.update(ui())); await settle(); await showSegment();
    expect(labels()).not.toContain('alice private title');
    release(); await settle();
    expect(labels()).toContain('bob private title');
  } finally {
    release(); act(() => tree.unmount()); client.clear();
  }
});

it.each(['access', 'templates'])('recovers a failed %s read without presenting it as an empty list', async failure => {
  mockUser = 'creator';
  mockUserRead.mockResolvedValue([]);
  mockAccess.mockResolvedValue({ hasEventHostGrant: true, ledCommunities: [] });
  mockTemplates.mockResolvedValue([]);
  const pendingRead = failure === 'access' ? mockAccess : mockTemplates;
  pendingRead.mockRejectedValueOnce(new Error('Offline'));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  let tree!: ReactTestRenderer;
  const button = (label: string) => tree.root.findAll(n => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function')[0];
  const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); });
  try {
    await act(async () => { tree = create(<QueryClientProvider client={client}><Screen/></QueryClientProvider>); });
    await settle();
    if (failure === 'templates') { act(() => button('Templates').props.onPress()); await settle(); }
    const retryLabel = failure === 'access' ? 'Retry events' : 'Check template library';
    expect(button(retryLabel)).toBeDefined();
    const before = pendingRead.mock.calls.length;
    act(() => button(retryLabel).props.onPress());
    await settle();
    expect(pendingRead.mock.calls.length).toBe(before + 1);
    expect(button(retryLabel)).toBeUndefined();
  } finally {
    act(() => tree.unmount()); client.clear();
  }
});
