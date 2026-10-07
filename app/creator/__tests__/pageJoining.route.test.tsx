import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

const mockPageId = 'f5d7644a-2ff5-4def-b0ab-d04b8250892b';
const mockOwnerId = '22222222-2222-4222-8222-222222222222';
let mockParams: { id?: string | string[] } = {};
let mockPagesEnabled = true;
const mockScope = { userId: mockOwnerId, isCurrent: () => true };
const mockLoad = jest.fn(), mockPersist = jest.fn(), mockSave = jest.fn(), mockReplace = jest.fn();
const mockFonts = { regular: 'System', medium: 'System', semibold: 'System', display: 'System' };
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
  Redirect: () => null,
  router: { dismissTo: (...args: unknown[]) => mockReplace(...args), replace: (...args: unknown[]) => mockReplace(...args) },
  Stack: { Screen: () => null },
}));
jest.mock('../../../constants/FeatureFlags', () => ({ get CREATOR_PAGES_ENABLED() { return mockPagesEnabled; } }));
jest.mock('../../../hooks/useCreatorPageScope', () => ({ useCreatorPageScope: () => ({ scope: mockScope, account: { isLoading: false, error: null } }) }));
jest.mock('../../../hooks/useAfterglowFonts', () => ({ useAfterglowFonts: () => ({ fonts: mockFonts }) }));
jest.mock('../../../lib/creatorPageJoinSettings', () => ({
  loadPageJoinEditor: (...args: unknown[]) => mockLoad(...args),
  persistPageJoinDraft: (...args: unknown[]) => mockPersist(...args),
  savePageJoinDraft: (...args: unknown[]) => mockSave(...args),
}));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: require('react-native').View }));
jest.mock('../../../components/ProfileButton', () => () => null);

import { Redirect } from 'expo-router';
import CreatorPageJoiningRoute from '../page-joining';
import CreatorPageJoinSettingsScreen from '../../../components/creator/pages/CreatorPageJoinSettingsScreen';
import { PageFrame } from '../../../components/creator/pages/PageFrame';
import { Field } from '../../../components/creator/ApplyFormKit';

let tree: ReactTestRenderer;
async function mount() { await act(async () => { tree = create(<CreatorPageJoiningRoute />); }); }
beforeEach(() => {
  jest.clearAllMocks(); mockParams = { id: mockPageId }; mockPagesEnabled = true;
  const settings = { join_policy: 'open', join_welcome_message: 'Welcome back', join_intro_question: 'Introduce yourself', guidelines_url: null,
    join_ask_reason: false, join_ask_source: false, join_ask_rules_confirm: false, join_open_question: 'What brings you here?' };
  const draft = { pageId: mockPageId, userId: mockOwnerId, baseVersion: 2, settings, pending: false };
  mockLoad.mockResolvedValue({ state: { page_id: mockPageId, owner_id: mockOwnerId, name: 'Sunday Table', published: false, audience: 'everyone', version: 2, pending_count: 0, settings }, draft, confirmed: false, conflict: false });
  mockPersist.mockResolvedValue(undefined);
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); });

it.each([mockPageId, mockPageId.toUpperCase()])('opens the actual joining editor for the exact UUID %s', async id => {
  mockParams = { id }; await mount();
  expect(tree.root.findAllByType(Redirect)).toHaveLength(0);
  expect(tree.root.findByType(CreatorPageJoinSettingsScreen).props.pageId).toBe(id);
  expect(mockLoad).toHaveBeenCalledWith(id, mockScope);
  expect(tree.root.findByType(PageFrame).props.title).toBe('Joining questions');
  expect(tree.root.findAllByType(Field).find(field => field.props.label === 'Welcome message')?.props.value).toBe('Welcome back');
  expect(mockSave).not.toHaveBeenCalled();
});

it.each([undefined, '', [mockPageId], 'f5d7644a-2ff5-4def-d04b8250892b', `${mockPageId}x`, mockPageId.replace('f5d7', 'z5d7')])('rejects a missing or malformed page identity: %j', async id => {
  mockParams = { id }; await mount();
  expect(tree.root.findByType(Redirect).props.href).toBe('/(tabs)/friends');
  expect(mockLoad).not.toHaveBeenCalled();
});

it('preserves the creator-page feature gate', async () => {
  mockPagesEnabled = false; await mount();
  expect(tree.root.findByType(Redirect).props.href).toBe('/(tabs)/friends');
  expect(mockLoad).not.toHaveBeenCalled();
});

it('keeps permission failures in the joining editor without exposing editable defaults or redirecting', async () => {
  mockLoad.mockRejectedValue(new Error('Page unavailable for this account')); await mount();
  expect(JSON.stringify(tree.toJSON())).toContain('Page unavailable for this account');
  expect(tree.root.findAllByType(Field)).toHaveLength(0);
  expect(tree.root.findAllByType(Redirect)).toHaveLength(0);
  expect(mockSave).not.toHaveBeenCalled();
});

it('preserves the page identity and local draft when returning to its workspace', async () => {
  await mount(); await act(async () => { tree.root.findByType(PageFrame).props.onBack(); });
  expect(mockPersist).toHaveBeenCalledWith(expect.objectContaining({ pageId: mockPageId, userId: mockOwnerId }), mockScope);
  expect(mockReplace).toHaveBeenCalledWith(`/creator/page?id=${mockPageId}`);
  expect(mockSave).not.toHaveBeenCalled();
});
