import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Text } from 'react-native';

const mockId = 'f5d7644a-2ff5-4def-b0ab-d04b8250892b';
const mockUser = '22222222-2222-4222-8222-222222222222';
let mockStack: string[], mockRender: () => void, mockRecord: any, mockSaved: any, mockSubmissions: any[], mockPublication: any;
const mockStart = jest.fn(), mockSave = jest.fn(), mockSubmit = jest.fn();
const mockLegacy = jest.fn(), mockSelect = jest.fn(), mockWorkspace = jest.fn();
const mockPath = () => mockStack[mockStack.length - 1];
const mockNavigate = (path: string, kind: 'push' | 'replace' | 'dismiss') => {
  const existing = kind === 'dismiss' ? mockStack.lastIndexOf(path) : -1;
  mockStack = existing >= 0 ? mockStack.slice(0, existing + 1)
    : kind === 'push' ? [...mockStack, path] : [...mockStack.slice(0, -1), path];
  mockRender();
};
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => Object.fromEntries(new URLSearchParams(mockPath().split('?')[1] ?? '')),
  router: {
    push: (path: string) => mockNavigate(path, 'push'), replace: (path: string) => mockNavigate(path, 'replace'),
    dismissTo: (path: string) => mockNavigate(path, 'dismiss'),
    canGoBack: () => mockStack.length > 1, back: () => { mockStack.pop(); mockRender(); },
  }, Stack: { Screen: () => null }, Redirect: () => null,
}));
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
jest.mock('../../../../lib/supabase', () => ({ supabase: { auth: {
  getUser: async () => ({ data: { user: { id: mockUser } }, error: null }),
  onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
} } }));
jest.mock('../../../../constants/FeatureFlags', () => ({ CREATOR_PAGES_ENABLED: true }));
jest.mock('../../../../constants/Admin', () => ({ isAdmin: () => false }));
jest.mock('../../../../hooks/useAfterglowFonts', () => ({ useAfterglowFonts: () => ({ fonts: { regular: 'System', medium: 'System', semibold: 'System', display: 'System' } }) }));
jest.mock('../../../../lib/creatorPageWorkspace', () => ({
  ...jest.requireActual('../../../../lib/creatorPageWorkspace'),
  listCreatorPages: async () => mockSaved ? [{ ...mockSaved, published_data: mockPublication }] : [],
  loadCreatorPageWorkspace: async (id: string, scope: any) => {
    if (id !== mockId || scope.userId !== mockUser || !scope.isCurrent()) throw Error('Wrong page or account');
    return { draft: mockSaved, submissions: mockSubmissions, publication: mockPublication, events: [] };
  },
}));
jest.mock('../../../../lib/creatorPageEditor', () => ({
  ...jest.requireActual('../../../../lib/creatorPageEditor'),
  listLocalPageEditors: async () => mockRecord ? [mockRecord] : [],
  startPageEditor: (...args: unknown[]) => mockStart(...args),
  readPageEditor: async () => mockRecord,
  persistPageEditor: async (record: any) => { mockRecord = record; },
  loadPageEditing: async (id: string, scope: any) => {
    if (id !== mockId || scope.userId !== mockUser || !scope.isCurrent()) throw Error('Wrong page or account');
    return { record: mockRecord, saved: mockSaved, submissions: mockSubmissions, published: !!mockPublication, conflict: false, gender: 'woman' };
  },
  savePageEditing: (...args: unknown[]) => mockSave(...args),
  submitPageEditing: (...args: unknown[]) => mockSubmit(...args),
}));
jest.mock('../../../../lib/creatorPageEventAttempt', () => ({ readCreatorPageEventAttempt: async () => null }));
jest.mock('../../../../lib/creatorSpaceEntry', () => ({ loadLegacyCreatorSpaces: () => mockLegacy() }));
jest.mock('../../../../lib/selectedCommunity', () => ({ setSelectedCommunityId: (...args: unknown[]) => mockSelect(...args) }));
jest.mock('../../../../lib/workspaceContext', () => ({ setWorkspace: (...args: unknown[]) => mockWorkspace(...args) }));
jest.mock('../../../../lib/haptics', () => ({ hapticLight: () => undefined, hapticSelection: () => undefined }));
jest.mock('../CreatorPageTeamInvitations', () => ({ CreatorPageTeamInvitations: () => null }));
jest.mock('../PageCover', () => ({ PageCover: () => null }));
jest.mock('../../../ProfileButton', () => () => null);
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: require('react-native').View }));
// Approval/publishing has its own full service/screen suite. This boundary proves the
// draft journey reaches that existing editor only after its current approved status.
jest.mock('../ApprovedPageEditorScreen', () => ({ __esModule: true, default: ({ pageId }: any) =>
  require('react').createElement(require('react-native').Text, { testID: 'approved-editor' }, pageId) }));

import PagesRoute from '../../../../app/creator/pages';
import PageRoute from '../../../../app/creator/page';
import EditorRoute from '../../../../app/creator/page-edit';
import { PageFrame, PageAction } from '../PageFrame';
import { Field } from '../../ApplyFormKit';

let tree: ReactTestRenderer;
function Journey() {
  const [, rerender] = React.useState(0); mockRender = () => rerender(value => value + 1);
  const path = mockPath().split('?')[0];
  return path === '/creator/pages' ? <PagesRoute key={mockPath()} />
    : path === '/creator/page' ? <PageRoute key={mockPath()} />
    : path === '/creator/page-edit' ? <EditorRoute key={mockPath()} /> : <Text>{path}</Text>;
}
const action = (title: string) => tree.root.findAllByType(PageAction).find(node => node.props.title === title);
const field = (label: string) => tree.root.findAllByType(Field).find(node => node.props.label === label)!;
async function press(title: string) { await act(async () => { const target = action(title); expect(target).toBeDefined(); expect(target!.props.disabled).not.toBe(true); target!.props.onPress(); }); }
async function tap(label: string) { await act(async () => { const buttons = tree.root.findAll(node => typeof node.props.onPress === 'function'); expect(buttons.map(node => node.props.accessibilityLabel)).toContain(label); buttons.find(node => node.props.accessibilityLabel === label)!.props.onPress(); }); }
async function type(label: string, value: string) { await act(async () => field(label).props.onChange(value)); }
async function back() { await act(async () => tree.root.findByType(PageFrame).props.onBack()); }
async function mount() { await act(async () => { tree = create(<Journey />); }); }
beforeEach(() => {
  jest.clearAllMocks(); mockStack = ['/(tabs)/friends', '/creator/pages']; mockRecord = null; mockSaved = null; mockSubmissions = []; mockPublication = null;
  mockLegacy.mockResolvedValue([]);
  mockStart.mockImplementation(async (_scope, prepared) => {
    mockRecord = { id: mockId, kind: 'community', version: 0, pageData: { name: '', purpose: '', city: 'Los Angeles', audience: 'everyone' }, creator: { name: '', email: '', motivation: '', guidelines: false } };
    prepared(mockRecord); return mockRecord;
  });
  mockSave.mockImplementation(async (record, _saved, scope) => {
    expect(scope.isCurrent()).toBe(true); expect(record.id).toBe(mockId);
    mockRecord = { ...record, version: record.version + 1 };
    mockSaved = { id: mockId, owner_id: mockUser, page_kind: record.kind, version: mockRecord.version, page_data: record.pageData };
    return mockRecord;
  });
  mockSubmit.mockImplementation(async (record, scope) => {
    expect(scope.isCurrent()).toBe(true); expect(record.id).toBe(mockId);
    mockSubmissions = [{ id: 'review', revision: 1, draft_version: record.version, status: 'submitted', page_snapshot: record.pageData }];
    return mockSubmissions[0];
  });
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); });

it('creates one page, saves in place, refines its preview, submits once, and returns without duplicate workspaces', async () => {
  await mount(); await press('New page'); expect(mockPath()).toBe(`/creator/page-edit?id=${mockId}`);
  expect(JSON.stringify(tree.toJSON())).toContain('Step 1 of 3 · Page details');
  expect(JSON.stringify(tree.toJSON())).toContain('Next: preview your page');
  await type('Name', 'Sunday Table'); await press('Save draft');
  expect(mockPath()).toBe(`/creator/page-edit?id=${mockId}`); expect(field('Name').props.value).toBe('Sunday Table');
  await press('Save and continue'); expect(action('Continue')).toBeUndefined(); expect(mockSubmit).not.toHaveBeenCalled();
  await type('What brings people together?', 'A welcoming table for neighbors');
  await tap('Area in LA: Choose an area'); await tap('Many places around LA'); await tap('Category: Community');
  await press('Save and continue'); expect(action('Continue')).toBeDefined();
  expect(JSON.stringify(tree.toJSON())).toContain('Step 2 of 3 · Preview');
  expect(JSON.stringify(tree.toJSON())).toContain('Next: creator details');
  await press('Edit page details'); expect(field('Name').props.value).toBe('Sunday Table');
  await type('Name', 'Sunday Table LA'); await press('Save and continue'); await press('Continue');
  expect(JSON.stringify(tree.toJSON())).toContain('Step 3 of 3 · Creator details');
  await press('Submit for review'); expect(mockSubmit).not.toHaveBeenCalled();
  await type('Your name', 'Aster'); await type('Contact email', 'aster@example.invalid'); await type('Tell us what you have in mind', 'Bring neighbors together around a table');
  await tap('I’ll follow the creator and community guidelines');
  await back(); expect(action('Continue')).toBeDefined(); await press('Continue');
  expect(field('Your name').props.value).toBe('Aster'); await press('Submit for review');
  expect(mockSubmit).toHaveBeenCalledTimes(1); expect(mockStart).toHaveBeenCalledTimes(1);
  expect(mockPath()).toBe(`/creator/page?id=${mockId}`); expect(action('Continue setup')).toBeUndefined();
  expect(JSON.stringify(tree.toJSON())).toContain('In review.');
  await press('Edit private draft'); await press('Save draft'); await back();
  expect(mockStack).toEqual(['/(tabs)/friends', '/creator/pages', `/creator/page?id=${mockId}`]);
  await back(); expect(mockPath()).toBe('/creator/pages'); expect(mockStack).toHaveLength(2);
  await tap('Manage Sunday Table LA, Community · Private page'); expect(mockPath()).toBe(`/creator/page?id=${mockId}`);
  mockSubmissions[0].status = 'approved'; await press('Check review status');
  await press('Preview & publish'); expect(mockPath()).toBe(`/creator/page-edit?id=${mockId}&mode=approved`);
  expect(tree.root.findByProps({ testID: 'approved-editor' }).props.children).toBe(mockId);
  expect(mockSubmit).toHaveBeenCalledTimes(1);
});

it('continues the existing draft from workspace preview and returns to the same workspace once', async () => {
  await mount(); await press('New page'); await type('Name', 'Still creating'); await press('Save draft'); await back();
  expect(mockPath()).toBe(`/creator/page?id=${mockId}`); await press('Preview page');
  expect(action('Continue setup')).toBeDefined(); await press('Continue setup');
  expect(field('Name').props.value).toBe('Still creating'); await back();
  expect(mockStack.filter(path => path === `/creator/page?id=${mockId}`)).toHaveLength(1);
  expect(mockStart).toHaveBeenCalledTimes(1); expect(mockSubmit).not.toHaveBeenCalled();
});

it('retains existing legacy community identity without routing through new-page creation', async () => {
  mockLegacy.mockResolvedValue([{ id: 'existing-community', name: 'Existing community', kind: 'community', route: '/(creator)/today', legacy: { workspace: 'community', communityId: 'existing-community', status: 'active' } }]);
  await mount(); await tap('Manage Existing community, Community');
  expect(mockSelect).toHaveBeenCalledWith('existing-community'); expect(mockWorkspace).toHaveBeenCalledWith('community');
  expect(mockPath()).toBe('/(creator)/today'); expect(mockStart).not.toHaveBeenCalled(); expect(mockSave).not.toHaveBeenCalled();
});
