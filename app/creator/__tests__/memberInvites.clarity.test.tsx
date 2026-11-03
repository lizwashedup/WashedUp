import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Platform, Share, StyleSheet, TextInput } from 'react-native';
import { FontSizes, LineHeights } from '../../../constants/Typography';
let mockFontScale = 1;
const mockFontListeners = new Set<(value: number) => void>();
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => {
 const React = require('react'); const [fontScale, setScale] = React.useState(mockFontScale);
 React.useEffect(() => { mockFontListeners.add(setScale); return () => { mockFontListeners.delete(setScale); }; }, []);
 return { width: 390, height: 844, scale: 3, fontScale };
} }));
function resizeFont(scale: number) { act(() => { mockFontScale = scale; mockFontListeners.forEach(update => update(scale)); }); }
const mockCreate = jest.fn(), mockRevoke = jest.fn(), mockList = jest.fn(), mockInvalidate = jest.fn();
let mockScope: any, mockCommunity: any, mockAccess: any, mockSearch: any, mockAccount: any, mockFocused: boolean;
jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: mockInvalidate }) }));
jest.mock('expo-router', () => ({ Redirect: (p: any) => require('react').createElement('redirect', p) }));
jest.mock('../../../hooks/useCreatorAccessRead', () => ({ useCreatorAccessRead: () => mockAccess }));
jest.mock('../../../hooks/useCreatorPageScope', () => ({ useCreatorPageScope: () => ({ scope: mockScope, account: mockAccount, focused: mockFocused }) }));
jest.mock('../../../hooks/useMemberInviteSearch', () => ({ useMemberInviteSearch: () => mockSearch }));
jest.mock('../../../hooks/useAfterglowFonts', () => ({ useAfterglowFonts: () => ({ fonts: require('../../../constants/Typography').CreatorFonts }) }));
jest.mock('../../../lib/selectedCommunity', () => ({ useLedCommunity: () => mockCommunity }));
jest.mock('../../../constants/FeatureFlags', () => ({ MEMBER_INVITES_ENABLED: true }));
jest.mock('../../../components/creator/pages/PageFrame', () => ({
 PageFrame: (p: any) => require('react').createElement('frame', p, p.children),
 PageAction: (p: any) => require('react').createElement('button', { ...p, accessibilityLabel: p.accessibilityLabel ?? p.title }, p.title),
}));
jest.mock('../../../components/BrandedAlert', () => ({ BrandedAlert: (p: any) => p.visible ? require('react').createElement('confirmation', p) : null }));
jest.mock('../../../components/keyboard/KeyboardDoneBar', () => ({ KEYBOARD_DONE_ACCESSORY_ID: 'done' }));
jest.mock('../../../lib/memberInvites', () => ({
 ...jest.requireActual('../../../lib/memberInvites'),
 createMemberInvite: (...args: any[]) => mockCreate(...args), revokeMemberInvite: (...args: any[]) => mockRevoke(...args), listCommunityMemberInvites: (...args: any[]) => mockList(...args),
}));
import Screen from '../member-invites';
import { MemberInviteOutcomeUnknown } from '../../../lib/memberInvites';
let tree: ReactTestRenderer;
const text = () => JSON.stringify(tree.toJSON());
const control = (label: string) => tree.root.findAll(n => typeof n.type === 'string' && n.props.accessibilityLabel === label)[0];
const press = async (label: string) => act(async () => tree.root.findAll(n => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function')[0].props.onPress());
const confirm = () => tree.root.find(n => n.type === ('confirmation' as any)).props.buttons[1].onPress;
const pending = () => { let resolve!: (v: any) => void; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const recipient = { id: 'sage', name: 'Sage', photo: null };
const row = { id: 'invite-1', communityId: 'sunset', invitedByUserId: 'one', targetUserId: 'sage', inviteMessage: null, status: 'pending', expiresAt: '2030-01-01T00:00:00Z', createdAt: '2026-01-01T00:00:00Z', targetName: 'Sage', targetPhoto: null };
const receipt = { rawToken: 'private-token', inviteId: 'invite-1', expiresAt: row.expiresAt };
const mount = () => act(async () => { tree = create(<Screen />); });
const choose = async () => { await press('Invite someone'); await press('Select Sage'); };
beforeEach(() => {
 mockFontScale = 1; jest.clearAllMocks(); mockScope = { userId: 'one', isCurrent: () => true }; mockAccount = { epoch: 1, isLoading: false, error: null };
 mockCommunity = { id: 'sunset', name: 'Sunset', role: 'leader', status: 'active' }; mockAccess = { data: {}, isLoading: false, isError: false }; mockFocused = true;
 mockSearch = { results: [recipient], loading: false, error: false, retry: jest.fn() };
 mockList.mockResolvedValue([]); mockCreate.mockResolvedValue(receipt); mockRevoke.mockResolvedValue(undefined);
 jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.dismissedAction });
});
afterEach(() => { if (tree) act(() => tree.unmount()); jest.restoreAllMocks(); });
it('selection does not invite: the creator reviews, confirms, then shares explicitly', async () => {
 await mount(); await choose(); expect(mockCreate).not.toHaveBeenCalled();
 await act(async () => control('Invitation note').props.onChangeText('Hello')); await press('Create link'); expect(mockCreate).not.toHaveBeenCalled();
 const response = pending(); mockCreate.mockReturnValueOnce(response.promise); const action = confirm(); act(() => { action(); action(); }); expect(mockCreate).toHaveBeenCalledTimes(1);
 await act(async () => response.resolve(receipt)); expect(mockCreate).toHaveBeenCalledWith('sunset', 'sage', 'Hello', mockScope); expect(Share.share).not.toHaveBeenCalled();
 expect(text()).toContain('Link ready for'); await press('Share link'); expect(Share.share).toHaveBeenCalledWith({ message: 'washedupapp://invite/member/private-token' });
 expect(control('Share link')).toBeDefined(); // Canceling native Share keeps the same link available.
});
it('a search failure does not become no match, and a history failure blocks new mutations', async () => {
 await mount(); await press('Invite someone'); mockSearch = { ...mockSearch, results: [], error: true }; await act(async () => tree.update(<Screen />));
 expect(text()).toContain('Couldn’t search'); expect(text()).not.toContain('No match'); await press('Try again'); expect(mockSearch.retry).toHaveBeenCalled();
 mockList.mockRejectedValueOnce(Error('offline')); await press('Refresh invite history'); expect(text()).toContain('Couldn’t load the latest invitations');
});
it('shows expired pending records as past and never offers their cancel/new-link controls', async () => {
 mockList.mockResolvedValue([{ ...row, expiresAt: '2020-01-01T00:00:00Z' }]); await mount();
 expect(text()).toContain('Expired'); expect(text()).not.toContain('Waiting to join'); expect(control('Create a new link for Sage')).toBeUndefined();
});
it('new link explains replacement and requires confirmation', async () => {
 mockList.mockResolvedValue([row]); await mount(); await press('Create a new link for Sage'); expect(mockCreate).not.toHaveBeenCalled();
 expect(tree.root.find(n => n.type === ('confirmation' as any)).props.message).toContain('stop working'); await act(async () => confirm()()); expect(mockCreate).toHaveBeenCalledTimes(1);
 expect(text()).not.toContain('Resend');
});
it('blocks a repeat after an unknown result until history is refreshed', async () => {
 mockCreate.mockRejectedValueOnce(new MemberInviteOutcomeUnknown()); await mount(); await choose(); await press('Create link'); await act(async () => confirm()());
 expect(control('Create link').props.disabled).toBe(true); expect(text()).toContain('Refresh invite history');
 await press('Refresh invite history'); expect(control('Create link').props.disabled).toBe(false);
});
it('rejects old confirmations and clears person/note when the community/account changes', async () => {
 await mount(); await choose(); await press('Create link'); const stale = confirm(); mockScope.isCurrent = () => false;
 mockScope = { userId: 'two', isCurrent: () => true }; mockAccount = { ...mockAccount, epoch: 2 }; mockCommunity = { ...mockCommunity, id: 'other' };
 await act(async () => tree.update(<Screen />)); await act(async () => stale()); expect(mockCreate).not.toHaveBeenCalled(); expect(control('Invitation note')).toBeUndefined(); expect(mockList).toHaveBeenLastCalledWith('other');
});
it('uses the selected community role and archived state, not leadership of another community', async () => {
 mockCommunity.role = 'member_care'; await mount(); expect(control('Invite someone')).toBeUndefined();
 mockCommunity = { ...mockCommunity, role: 'leader', status: 'archived' }; await act(async () => tree.update(<Screen />)); expect(control('Invite someone')).toBeUndefined(); expect(text()).toContain('closed to new members');
});
it('does not fetch invitation history when access is loading or failed', async () => {
 mockAccess.isLoading = true; await mount(); expect(mockList).not.toHaveBeenCalled();
 mockAccess = { isLoading: false, isError: true, refetch: jest.fn() }; await act(async () => tree.update(<Screen />)); expect(mockList).not.toHaveBeenCalled(); expect(text()).toContain('Couldn’t check your community access');
});
it('requires confirmation for cancellation and prevents repeated same-frame cancellation', async () => {
 mockList.mockResolvedValue([row]); await mount(); await press('Cancel invitation for Sage'); expect(mockRevoke).not.toHaveBeenCalled();
 const response = pending(); mockRevoke.mockReturnValueOnce(response.promise); const action = confirm(); act(() => { action(); action(); }); expect(mockRevoke).toHaveBeenCalledTimes(1);
 await act(async () => response.resolve(undefined)); expect(mockRevoke).toHaveBeenCalledWith('invite-1', mockScope); expect(text()).toContain('Invitation canceled');
});

it('resizes iOS search and note fields both ways without losing their values or remounting', async () => {
 jest.replaceProperty(Platform, 'OS', 'ios'); await mount(); await press('Invite someone');
 const search = tree.root.findByType(TextInput); act(() => search.props.onChangeText('sage'));
 for (const scale of [2, 1]) {
  resizeFont(scale); expect(tree.root.findByType(TextInput)).toBe(search); expect(search.props.value).toBe('sage');
  expect(StyleSheet.flatten(search.props.style)).toMatchObject({ fontSize: FontSizes.bodyMD * scale, lineHeight: LineHeights.bodyMD * scale });
  expect(search.props.allowFontScaling).toBe(false);
 }
 await press('Select Sage'); const note = tree.root.findByType(TextInput); act(() => note.props.onChangeText('Keep this\nsecond line'));
 for (const scale of [2, 1]) {
  resizeFont(scale); expect(tree.root.findByType(TextInput)).toBe(note); expect(note.props.value).toBe('Keep this\nsecond line');
  expect(StyleSheet.flatten(note.props.style)).toMatchObject({ fontSize: FontSizes.bodyMD * scale, lineHeight: LineHeights.bodyMD * scale });
 }
 expect(mockCreate).not.toHaveBeenCalled();
});
it.each(['android', 'web'] as const)('leaves %s input scaling with the platform', async platform => {
 jest.replaceProperty(Platform, 'OS', platform); await mount(); await press('Invite someone'); const field = tree.root.findByType(TextInput);
 resizeFont(2); expect(tree.root.findByType(TextInput)).toBe(field); expect(field.props.allowFontScaling).toBeUndefined();
 expect(StyleSheet.flatten(field.props.style).fontSize).toBe(FontSizes.bodyMD);
});

it('opens Profile above the invitation route so Back can return to the same community', async () => {
 await mount(); expect(tree.root.find(n => n.type === ('frame' as any)).props.stackedProfile).toBe(true);
});
