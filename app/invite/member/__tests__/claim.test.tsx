import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { TouchableOpacity } from 'react-native';
const mockPreview = jest.fn(), mockAccept = jest.fn(), mockReplace = jest.fn(), mockPush = jest.fn(), mockHaptic = jest.fn(), mockAccountRead = jest.fn();
let mockToken: any, mockAccount: any, mockFocused: boolean, mockEnabled: boolean;
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({ token: mockToken }), useRouter: () => ({ replace: mockReplace, push: mockPush, canGoBack: () => false, back: jest.fn() }), Stack: { Screen: () => null }, Redirect: (p: any) => require('react').createElement('redirect', p) }));
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => mockFocused }));
jest.mock('../../../../constants/FeatureFlags', () => ({ get MEMBER_INVITES_ENABLED() { return mockEnabled; } }));
jest.mock('../../../../hooks/useObservedUser', () => ({ useObservedUser: () => { mockAccountRead(); return mockAccount; } }));
jest.mock('../../../../hooks/useAfterglowFonts', () => ({ useAfterglowFonts: () => ({ fonts: require('../../../../constants/Typography').CreatorFonts }) }));
jest.mock('../../../../components/ProfileButton', () => () => null);
jest.mock('../../../../lib/haptics', () => ({ hapticSuccess: () => mockHaptic() }));
jest.mock('../../../../lib/memberInvites', () => ({ ...jest.requireActual('../../../../lib/memberInvites'), previewMemberInvite: (...args: any[]) => mockPreview(...args), acceptMemberInviteByToken: (...args: any[]) => mockAccept(...args) }));
import Screen from '../[token]';
import { MemberInviteAcceptanceUnknown } from '../../../../lib/memberInvites';
const preview = { inviteId: 'invite', communityId: 'sunset', communityName: 'Sunset', communityHandle: 'sunset', invitedByName: 'Creator', status: 'viewed', expiresAt: '2030-01-01T00:00:00Z', inviteMessage: null };
let tree: ReactTestRenderer;
const mount = () => act(async () => { tree = create(<Screen />); });
const text = () => JSON.stringify(tree.toJSON());
const button = (label: string) => tree.root.findAllByType(TouchableOpacity).find(node => node.props.accessibilityLabel === label)!;
const press = (label: string) => act(async () => { await button(label).props.onPress(); });
const pending = () => { let resolve!: (v: any) => void; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
beforeEach(() => {
 jest.clearAllMocks(); mockEnabled = true; mockToken = 'private-token'; mockFocused = true;
 mockAccount = { viewerId: 'recipient', epoch: 1, isLoading: false, error: null, isCurrent: () => true, retry: jest.fn() };
 mockPreview.mockResolvedValue(preview); mockAccept.mockResolvedValue({ communityId: 'sunset' });
});
afterEach(() => { if (tree) act(() => tree.unmount()); jest.restoreAllMocks(); });
it('accepts a viewed invitation once and opens the actual community', async () => {
 await mount(); expect(text()).not.toContain('canceled'); const response = pending(); mockAccept.mockReturnValueOnce(response.promise);
 const join = button('Join community').props.onPress; act(() => { join(); join(); }); expect(mockAccept).toHaveBeenCalledTimes(1);
 expect(mockAccept).toHaveBeenCalledWith('private-token', expect.objectContaining({ userId: 'recipient' }), 'sunset');
 await act(async () => response.resolve({ communityId: 'sunset' })); expect(text()).toContain('You’re in'); expect(mockHaptic).toHaveBeenCalledTimes(1);
 await press('Open community'); expect(mockReplace).toHaveBeenCalledWith('/community/sunset');
});
it('offers retry for a network failure without claiming the invitation is invalid', async () => {
 mockPreview.mockRejectedValueOnce(Error('offline')); await mount(); expect(text()).toContain('Couldn’t load'); expect(text()).not.toContain('Invitation not found');
 await press('Try again'); expect(button('Join community')).toBeDefined();
});
it('waits for account verification and lets a failed account read retry before previewing', async () => {
 mockAccount.isLoading = true; await mount(); expect(mockPreview).not.toHaveBeenCalled();
 mockAccount = { ...mockAccount, isLoading: false, error: Error('offline') };
 await act(async () => tree.update(<Screen />)); expect(text()).toContain('Couldn’t check your account');
 await press('Try again'); expect(mockAccount.retry).toHaveBeenCalledTimes(1); expect(mockPreview).not.toHaveBeenCalled();
 mockAccount = { ...mockAccount, error: null };
 await act(async () => tree.update(<Screen />)); expect(button('Join community')).toBeDefined();
});
it.each(['expired', 'revoked', 'accepted'])('never offers Join for a %s invitation', async status => {
 mockPreview.mockResolvedValue({ ...preview, status }); await mount(); expect(button('Join community')).toBeUndefined(); expect(mockAccept).not.toHaveBeenCalled();
});
it('rechecks expiration at the instant Join is pressed', async () => {
 const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2029-12-31T23:59:59Z')); await mount();
 clock.mockReturnValue(Date.parse(preview.expiresAt)); await press('Join community'); expect(mockAccept).not.toHaveBeenCalled(); expect(text()).toContain('has expired');
});
it('requires an explicit status check after an uncertain acceptance, without retrying it automatically', async () => {
 mockAccept.mockRejectedValueOnce(new MemberInviteAcceptanceUnknown()); await mount(); await press('Join community');
 expect(button('Join community').props.disabled).toBe(true); await press('Join community'); expect(mockAccept).toHaveBeenCalledTimes(1);
 mockPreview.mockResolvedValueOnce({ ...preview, status: 'accepted' }); await press('Check invitation status');
 expect(text()).toContain('already accepted'); expect(text()).not.toContain('You’re in'); expect(mockHaptic).not.toHaveBeenCalled();
});
it('retains the acceptance lock when the status check fails', async () => {
 mockAccept.mockRejectedValueOnce(new MemberInviteAcceptanceUnknown()); await mount(); await press('Join community');
 mockPreview.mockRejectedValueOnce(Error('offline')); await press('Check invitation status'); expect(button('Join community')).toBeUndefined();
 expect(text()).toContain('Couldn’t load'); expect(mockAccept).toHaveBeenCalledTimes(1);
});
it('shows a wrong-account refusal without claiming membership', async () => {
 mockAccept.mockRejectedValueOnce({ message: 'this invite is not for you', code: '42501' }); await mount(); await press('Join community');
 expect(text()).toContain('different account'); expect(text()).not.toContain('You’re in'); expect(mockReplace).not.toHaveBeenCalled();
});
it('retires late preview results after a token change', async () => {
 const old = pending(); mockPreview.mockReturnValueOnce(old.promise); await mount(); mockToken = 'new-token';
 mockPreview.mockResolvedValueOnce({ ...preview, communityName: 'New community' }); await act(async () => tree.update(<Screen />));
 await act(async () => old.resolve(preview)); expect(text()).toContain('New community'); expect(text()).not.toContain('Sunset');
});
it('ignores late acceptance after an account switch', async () => {
 const old = pending(); mockAccept.mockReturnValueOnce(old.promise); await mount(); act(() => { button('Join community').props.onPress(); });
 mockAccount = { ...mockAccount, viewerId: 'other', epoch: 2 }; await act(async () => tree.update(<Screen />));
 await act(async () => old.resolve({ communityId: 'sunset' })); expect(text()).not.toContain('You’re in'); expect(mockHaptic).not.toHaveBeenCalled();
});
it('ignores late acceptance after leaving the screen', async () => {
 const old = pending(); mockAccept.mockReturnValueOnce(old.promise); await mount(); act(() => { button('Join community').props.onPress(); });
 mockFocused = false; await act(async () => tree.update(<Screen />)); await act(async () => old.resolve({ communityId: 'sunset' }));
 expect(mockHaptic).not.toHaveBeenCalled(); expect(mockReplace).not.toHaveBeenCalled();
});
it('allows signed-out preview but requires sign-in to accept', async () => {
 mockAccount.viewerId = null; await mount(); expect(button('Join community')).toBeUndefined(); await press('Sign in');
 expect(mockPush).toHaveBeenCalledWith('/(auth)/phone-entry'); expect(mockAccept).not.toHaveBeenCalled();
});
it('does not preview or read an account while invitations are disabled', async () => {
 mockEnabled = false; await mount(); expect(mockPreview).not.toHaveBeenCalled(); expect(mockAccountRead).not.toHaveBeenCalled();
});
it('handles an incomplete link without an RPC and provides a safe Back destination', async () => {
 mockToken = undefined; await mount(); expect(text()).toContain('Invitation not found'); expect(mockPreview).not.toHaveBeenCalled();
 await press('Back'); expect(mockReplace).toHaveBeenCalledWith('/(tabs)/plans');
});
