import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ActivityIndicator, Text, TouchableOpacity } from 'react-native';
import ReferralLanding from '../r/[code]';
const mockReplace = jest.fn(), mockSession = jest.fn(), mockClaim = jest.fn(), mockHeader = jest.fn();
let mockCode = 'INVITE', mockViewer: string | null = 'person-a', mockEpoch = 1;
let mockLoading = false, mockError: Error | null = null;
const mockAccountRetry = jest.fn();
const mockFocus = React.createContext(true);
jest.mock('expo-router', () => ({ router: { replace: (...a: any[]) => mockReplace(...a) }, useLocalSearchParams: () => ({ code: mockCode }),
 useFocusEffect: (callback: any) => { const R = require('react'), active = R.useContext(mockFocus); R.useEffect(() => active ? callback() : undefined, [active, callback]); } }));
jest.mock('../../hooks/useObservedUser', () => ({ useObservedUser: () => { const R = require('react'), id = mockViewer, epoch = mockEpoch;
 return { viewerId: id, epoch, isLoading: mockLoading, error: mockError, retry: mockAccountRetry, isCurrent: R.useCallback(() => mockViewer === id && mockEpoch === epoch, [id, epoch]) }; } }));
jest.mock('../../lib/supabase', () => ({ supabase: { auth: { getSession: () => mockSession() }, rpc: (...a: any[]) => {
 const promise = Promise.resolve(mockClaim(...a)); return Object.assign(promise, { setHeader: (...headers: any[]) => { mockHeader(...headers); return promise; } });
} } }));
jest.mock('@react-native-async-storage/async-storage', () => ({ setItem: jest.fn(async () => {}), getItem: jest.fn(async () => null), removeItem: jest.fn(async () => {}) }));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('../../constants/FeatureFlags', () => ({ YOURS_PAGE_ENABLED: true }));
const inviter = '11111111-1111-4111-8111-111111111111';
let tree: ReactTestRenderer | undefined;
const deferred = () => { let resolve!: (v: any) => void; const promise = new Promise<any>(r => { resolve = r; }); return { promise, resolve }; };
const flush = async () => { await act(async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); }); };
const screen = (focused = true) => <mockFocus.Provider value={focused}><ReferralLanding /></mockFocus.Provider>;
const mount = async () => { await act(async () => { tree = create(screen()); }); await flush(); };
const text = (value: string) => tree!.root.findAllByType(Text).some(n => String(n.props.children).includes(value));
const retry = () => tree!.root.findAllByType(TouchableOpacity).find(n => n.props.accessibilityLabel === 'Try invite again');
beforeEach(() => { jest.clearAllMocks(); mockCode = 'INVITE'; mockViewer = 'person-a'; mockEpoch = 1; mockLoading = false; mockError = null;
 mockSession.mockReset().mockResolvedValue({ data: { session: { user: { id: 'person-a' }, access_token: 'fictional-token' } }, error: null });
 mockClaim.mockReset().mockResolvedValue({ data: inviter, error: null });
});
afterEach(() => { act(() => tree?.unmount()); tree = undefined; jest.useRealTimers(); });
it('opens the original inviter after a confirmed claim', async () => { await mount(); expect(mockReplace).toHaveBeenCalledWith(`/person/${inviter}`); });
it('offers retry instead of calling a connection failure an invalid invite', async () => {
 mockClaim.mockResolvedValueOnce({ data: null, error: { message: 'offline' } }); await mount();
 expect(text('this invite is gone')).toBe(false); expect(retry()).toBeDefined();
 act(() => retry()!.props.onPress()); await flush(); expect(mockReplace).toHaveBeenCalledWith(`/person/${inviter}`);
});
it('releases a stalled claim and ignores its late result', async () => {
 jest.useFakeTimers(); const pending = deferred(); mockClaim.mockReturnValueOnce(pending.promise); await mount();
 await act(async () => { await jest.advanceTimersByTimeAsync(12_001); }); await flush();
 expect(tree!.root.findAllByType(ActivityIndicator)).toHaveLength(0); expect(retry()).toBeDefined();
 pending.resolve({ data: inviter, error: null }); await flush(); expect(mockReplace).not.toHaveBeenCalled();
});
it('releases a stalled session read without claiming', async () => {
 jest.useFakeTimers(); const pending = deferred(); mockSession.mockReturnValueOnce(pending.promise); await mount();
 await act(async () => { await jest.advanceTimersByTimeAsync(12_001); }); await flush();
 expect(retry()).toBeDefined(); expect(mockClaim).not.toHaveBeenCalled();
 pending.resolve({ data: { session: { user: { id: 'person-a' }, access_token: 'fictional-token' } }, error: null }); await flush(); expect(mockClaim).not.toHaveBeenCalled();
});
it.each(['invalid_referral_code', 'invalid_recipient', 'blocked', 'cannot_re_request'])('shows an unavailable invite only for explicit terminal %s', async message => {
 mockClaim.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message } }); await mount();
 expect(text('this invite is unavailable')).toBe(true); expect(retry()).toBeUndefined(); expect(mockReplace).not.toHaveBeenCalled();
});
it('keeps null and malformed receipts retryable and pins the recipient token', async () => {
 mockClaim.mockResolvedValueOnce({ data: null, error: null }); await mount(); expect(retry()).toBeDefined();
 mockClaim.mockResolvedValueOnce({ data: 'malformed', error: null }); act(() => retry()!.props.onPress()); await flush();
 expect(retry()).toBeDefined(); expect(mockReplace).not.toHaveBeenCalled();
 expect(mockHeader).toHaveBeenCalledWith('Authorization', 'Bearer fictional-token');
});
it('refuses a session that belongs to another account', async () => {
 mockSession.mockResolvedValueOnce({ data: { session: { user: { id: 'person-b' }, access_token: 'other-fictional-token' } }, error: null });
 await mount(); expect(mockClaim).not.toHaveBeenCalled(); expect(retry()).toBeDefined();
});
it('coalesces rapid retry taps', async () => {
 mockClaim.mockResolvedValueOnce({ data: null, error: { message: 'offline' } }); await mount();
 const press = retry()!.props.onPress, pending = deferred(); mockClaim.mockReturnValueOnce(pending.promise);
 act(() => { press(); press(); }); await flush(); expect(mockClaim).toHaveBeenCalledTimes(2);
 pending.resolve({ data: inviter, error: null }); await flush();
});
it.each(['blur', 'unmount', 'account'])('ignores a late confirmed claim after %s', async how => {
 const pending = deferred(); mockClaim.mockReturnValueOnce(pending.promise); await mount();
 if (how === 'blur') act(() => tree!.update(screen(false)));
 if (how === 'unmount') act(() => { tree!.unmount(); tree = undefined; });
 if (how === 'account') { mockViewer = 'person-b'; mockEpoch++; }
 pending.resolve({ data: inviter, error: null }); await flush(); expect(mockReplace).not.toHaveBeenCalled();
});
it('does not automatically claim again for a replacement account or A-B-A transition', async () => {
 const pending = deferred(); mockClaim.mockReturnValueOnce(pending.promise); await mount();
 mockViewer = 'person-b'; mockEpoch++; act(() => tree!.update(screen())); await flush();
 expect(text('your account changed')).toBe(true); expect(mockClaim).toHaveBeenCalledTimes(1);
 mockViewer = 'person-a'; mockEpoch++; act(() => tree!.update(screen())); await flush();
 expect(text('your account changed')).toBe(true); expect(mockClaim).toHaveBeenCalledTimes(1);
 pending.resolve({ data: inviter, error: null }); await flush(); expect(mockReplace).not.toHaveBeenCalled();
});
it('keeps a newer code in control when an older claim completes', async () => {
 const pending = deferred(); mockClaim.mockReturnValueOnce(pending.promise); await mount();
 mockCode = 'NEW'; act(() => tree!.update(screen())); await flush();
 expect(mockReplace).toHaveBeenCalledTimes(1);
 pending.resolve({ data: inviter, error: null }); await flush(); expect(mockReplace).toHaveBeenCalledTimes(1);
 expect(mockClaim.mock.calls[1]).toEqual(['claim_referral_invite', { p_code: 'NEW' }]);
});
it('does not run a retained retry after leaving and returning', async () => {
 mockClaim.mockResolvedValueOnce({ data: null, error: { message: 'offline' } }); await mount(); const old = retry()!.props.onPress;
 act(() => tree!.update(screen(false))); act(() => tree!.update(screen())); await flush(); const count = mockClaim.mock.calls.length;
 act(() => old()); await flush(); expect(mockClaim).toHaveBeenCalledTimes(count);
});
it('rejects an overlong code without claiming', async () => {
 mockCode = 'A'.repeat(65); await mount(); expect(mockClaim).not.toHaveBeenCalled(); expect(text('this invite is unavailable')).toBe(true);
});
it('keeps identity failures separate and retries the account read', async () => {
 mockError = new Error('offline'); await mount(); expect(retry()).toBeDefined(); expect(mockClaim).not.toHaveBeenCalled();
 act(() => retry()!.props.onPress()); await flush(); expect(mockAccountRetry).toHaveBeenCalledTimes(1);
});
it('stashes a signed-out invite before returning to sign-in', async () => {
 mockViewer = null; await mount(); expect(mockClaim).not.toHaveBeenCalled(); expect(mockReplace).toHaveBeenCalledTimes(1);
 const storage = require('@react-native-async-storage/async-storage');
 expect(storage.setItem).toHaveBeenCalledWith('pendingReferral.v1', JSON.stringify({ version: 1, code: 'INVITE', ownerId: null }));
});
