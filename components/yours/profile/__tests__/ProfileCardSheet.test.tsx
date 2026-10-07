import React from 'react';
import { Text, ScrollView, StyleSheet } from 'react-native';
import { act, create } from 'react-test-renderer';
import ProfileCardSheet, { type ProfileCardSheetProps } from '../ProfileCardSheet';
import { AfterglowFallbackFonts } from '../../../../constants/Typography';
import type { ProfileCard } from '../../../../lib/yours/types';
const mockProfile = jest.fn(), mockSend = jest.fn(), mockRefetch = jest.fn(), mockRetryIdentity = jest.fn();
let mockViewerId: string | null = 'alice', mockEpoch = 0, mockIdentityError: Error | null = null, mockIdentityLoading = false;
jest.mock('../../../../hooks/useProfileCard', () => ({ useProfileCard: (...args: unknown[]) => mockProfile(...args) }));
jest.mock('../../../../hooks/useObservedUser', () => ({ useObservedUser: () => {
  const epoch = mockEpoch; return { viewerId: mockViewerId, epoch, error: mockIdentityError, isLoading: mockIdentityLoading, isCurrent: () => epoch === mockEpoch, retry: mockRetryIdentity };
} }));
jest.mock('../../../../hooks/usePeopleConnectionMutations', () => ({ usePeopleConnectionMutations: () => ({ sendRequest: { mutateAsync: mockSend } }), friendlyConnectionError: () => 'Request failed. Try again.', isObsoletePeopleConnection: (error: Error) => error?.name === 'ObsoletePeopleConnectionError' }));
jest.mock('../../primitives/BottomSheet', () => ({ __esModule: true, default: (props: any) => require('react').createElement('BottomSheet', props, props.children) }));
jest.mock('../../primitives/YoursAvatar', () => ({ __esModule: true, default: (props: any) => require('react').createElement('LegacyAvatar', props) }));
jest.mock('expo-image', () => ({ Image: (props: any) => require('react').createElement('ProfileImage', props) }));
const card = (extra: Partial<ProfileCard> = {}): ProfileCard => ({ user_id: 'amelia', kind: 'minimal', first_name_display: 'Amelia', profile_photo_url: 'https://example.invalid/amelia.jpg', handle: 'amelia', shared_count: 2, since_date: '2026-01-01', milestone: null, upcoming: null, adventures: null, ...extra });
let result: { data: ProfileCard | null; isLoading: boolean; isFetching: boolean; isError: boolean; refetch: typeof mockRefetch };
const cleanup: Array<() => void> = [];
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function mount(extra: Partial<ProfileCardSheetProps> = {}) {
  let props: ProfileCardSheetProps = { visible: true, userId: 'alice', targetId: 'amelia', onClose: jest.fn(), appearance: { fonts: AfterglowFallbackFonts }, ...extra };
  let tree!: ReturnType<typeof create>; act(() => { tree = create(<ProfileCardSheet {...props} />); });
  let closed = false; const unmount = () => { if (!closed) act(() => tree.unmount()); closed = true; }; cleanup.push(unmount);
  return { tree, unmount, props, update: (next: Partial<ProfileCardSheetProps> = {}) => { props = { ...props, ...next }; act(() => tree.update(<ProfileCardSheet {...props} />)); },
    text: () => tree.root.findAllByType(Text).map(n => n.props.children).flat().join(' '),
    button: (label: string) => tree.root.findAll(n => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function')[0],
    sheet: () => tree.root.findByType('BottomSheet' as any), photo: () => tree.root.findAllByType('ProfileImage' as any)[0],
  };
}
beforeEach(() => {
  jest.clearAllMocks(); mockViewerId = 'alice'; mockEpoch = 0; mockIdentityError = null; mockIdentityLoading = false;
  result = { data: card(), isLoading: false, isFetching: false, isError: false, refetch: mockRefetch };
  mockProfile.mockImplementation(() => result); mockSend.mockResolvedValue('requested'); mockRefetch.mockResolvedValue({}); mockRetryIdentity.mockResolvedValue(undefined);
});
afterEach(() => cleanup.splice(0).forEach(fn => fn()));
it('does not mount query or identity work while hidden', () => { mount({ visible: false }); expect(mockProfile).not.toHaveBeenCalled(); });
it('preserves minimal profile/history only and uses truthful Add instead of Add back', () => {
  const f = mount(); expect(mockProfile).toHaveBeenCalledWith('alice', 'amelia'); expect(f.button('Add Amelia')).toBeDefined(); expect(f.text()).not.toContain('Add back'); expect(f.text()).toContain('2 shared plans');
  expect(f.sheet().props.appearance).toEqual({ fonts: AfterglowFallbackFonts });
});
it('shows unavailable after a null result, rather than an endless loading spinner', () => {
  result.data = null; const f = mount(); expect(f.text()).toContain('This profile isn’t available'); expect(f.text()).not.toContain('Loading'); expect(f.button('Add Amelia')).toBeUndefined();
});
it('shows failed profile and retry without offering Add from cached error data', async () => {
  result.isError = true; const f = mount(); expect(f.text()).toContain('Couldn’t load this profile'); expect(f.button('Add Amelia')).toBeUndefined();
  await act(async () => f.button('Try again to load profile').props.onPress()); expect(mockRefetch).toHaveBeenCalledTimes(1);
  result.isError = false; f.update(); expect(f.button('Add Amelia')).toBeDefined();
});
it('loading is explicit and a missing target is unavailable', () => {
  result.isLoading = true; result.data = null; const f = mount(); expect(f.text()).toContain('Loading profile');
  f.update({ targetId: null }); expect(f.text()).toContain('This profile isn’t available');
});
it('does not expose private full-card fields or offer Add for a connected card', () => {
  result.data = card({ kind: 'full', upcoming: [{ event_id: 'e', title: 'Private picnic', start_time: '' }], adventures: [{ album_id: 'a', event_id: 'e', title: 'Secret album', date: '', thumb_url: null }] });
  const f = mount(); expect(f.button('Add Amelia')).toBeUndefined(); expect(f.text()).not.toContain('Private picnic'); expect(f.text()).not.toContain('Secret album');
});
it('rejects a wrong-target response and any old Add callback when data changes', async () => {
  const f = mount(); const add = f.button('Add Amelia').props.onPress; result.data = card({ user_id: 'luca' }); f.update();
  expect(f.text()).toContain('isn’t available'); await act(async () => add()); expect(mockSend).not.toHaveBeenCalled();
});
it('an old Add callback cannot bypass a new profile error or loading identity', async () => {
  const f = mount(); const add = f.button('Add Amelia').props.onPress; result.isError = true; f.update(); await act(async () => add()); expect(mockSend).not.toHaveBeenCalled();
  result.isError = false; mockIdentityLoading = true; f.update(); await act(async () => add()); expect(mockSend).not.toHaveBeenCalled();
});
it('locks repeat Add immediately and preserves the existing handshake args', async () => {
  const pending = deferred<string>(); mockSend.mockReturnValue(pending.promise); const f = mount(); const add = f.button('Add Amelia').props.onPress;
  act(() => { add(); add(); }); expect(mockSend).toHaveBeenCalledTimes(1); expect(mockSend).toHaveBeenCalledWith({ recipientId: 'amelia', context: 'handle_lookup' }, { scope: { userId: 'alice', isCurrent: expect.any(Function) } });
  expect(f.button('Sending request to Amelia').props.disabled).toBe(true); expect(f.props.onClose).not.toHaveBeenCalled();
  await act(async () => pending.resolve('requested')); expect(f.props.onClose).toHaveBeenCalledTimes(1); expect(f.text()).toContain('Request sent');
});
it.each(['now_connected', 'already_connected'])('accepts the confirmed %s receipt before closing', async (outcome) => {
  mockSend.mockResolvedValue(outcome); const f = mount(); await act(async () => f.button('Add Amelia').props.onPress());
  expect(f.props.onClose).toHaveBeenCalledTimes(1); expect(f.text()).toContain('Added to your people'); expect(f.text()).not.toContain('Request sent');
});
it('does not claim success for an unknown receipt', async () => {
  mockSend.mockResolvedValue(undefined); const f = mount(); await act(async () => f.button('Add Amelia').props.onPress());
  expect(f.props.onClose).not.toHaveBeenCalled(); expect(f.text()).toContain('couldn’t confirm'); expect(f.button('Add Amelia').props.disabled).toBe(false);
});
it('current failure keeps the profile open, restores Add and supports retry', async () => {
  mockSend.mockRejectedValueOnce(new Error('offline')); const f = mount(); await act(async () => f.button('Add Amelia').props.onPress());
  expect(f.text()).toContain('Request failed'); expect(f.props.onClose).not.toHaveBeenCalled(); await act(async () => f.button('Add Amelia').props.onPress()); expect(f.props.onClose).toHaveBeenCalledTimes(1);
});
it('dismissal retires request completion even before parent hides the sheet', async () => {
  const pending = deferred<string>(); mockSend.mockReturnValue(pending.promise); const f = mount(); act(() => f.button('Add Amelia').props.onPress());
  const close = f.sheet().props.onClose; act(() => { close(); close(); }); expect(f.props.onClose).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve('requested')); expect(f.props.onClose).toHaveBeenCalledTimes(1);
});
it('close and reopen cannot be closed by the previous request completion', async () => {
  const pending = deferred<string>(); mockSend.mockReturnValue(pending.promise); const f = mount(); act(() => f.button('Add Amelia').props.onPress());
  f.update({ visible: false }); f.update({ visible: true }); await act(async () => pending.resolve('requested')); expect(f.props.onClose).not.toHaveBeenCalled(); expect(f.button('Add Amelia')).toBeDefined();
});
it('changing target ignores old completions and old close/Add handlers', async () => {
  const pending = deferred<string>(); mockSend.mockReturnValue(pending.promise); const f = mount(); const add = f.button('Add Amelia').props.onPress, close = f.sheet().props.onClose;
  act(() => add()); result.data = card({ user_id: 'luca', first_name_display: 'Luca' }); f.update({ targetId: 'luca' }); act(() => { add(); close(); });
  await act(async () => pending.resolve('requested')); expect(f.props.onClose).not.toHaveBeenCalled(); expect(mockSend).toHaveBeenCalledTimes(1); expect(f.button('Add Luca')).toBeDefined();
});
it('account A to B to A resets pending state and prevents old completions', async () => {
  const pending = deferred<string>(); mockSend.mockReturnValue(pending.promise); const f = mount(); const add = f.button('Add Amelia').props.onPress; act(() => add());
  mockViewerId = 'bob'; mockEpoch++; f.update({ userId: 'bob' }); mockViewerId = 'alice'; mockEpoch++; f.update({ userId: 'alice' });
  act(() => add()); await act(async () => pending.resolve('requested')); expect(mockSend).toHaveBeenCalledTimes(1); expect(f.props.onClose).not.toHaveBeenCalled(); expect(f.button('Add Amelia')).toBeDefined();
});
it('auth epoch alone retires an operation even when parent account props are unchanged', async () => {
  const pending = deferred<string>(); mockSend.mockReturnValue(pending.promise); const f = mount(); act(() => f.button('Add Amelia').props.onPress());
  mockEpoch++; await act(async () => pending.resolve('requested')); expect(f.props.onClose).not.toHaveBeenCalled();
});
it('account errors offer a retry and never fetch a mismatched account profile', async () => {
  mockIdentityError = new Error('offline'); const f = mount(); expect(mockProfile).toHaveBeenCalledWith(null, null); expect(f.text()).toContain('Couldn’t check your account');
  await act(async () => f.button('Try again to check account').props.onPress()); expect(mockRetryIdentity).toHaveBeenCalledTimes(1);
});
it('uses the latest close callback in the same visit', async () => {
  const f = mount(), close = jest.fn(); f.update({ onClose: close }); await act(async () => f.button('Add Amelia').props.onPress()); expect(close).toHaveBeenCalledTimes(1); expect(f.props.onClose).not.toHaveBeenCalled();
});
it('fullcolor photo failure has a scoped initial fallback and new photo retries', () => {
  const f = mount(); expect(StyleSheet.flatten(f.photo().props.style).opacity).toBe(1); const oldError = f.photo().props.onError;
  act(() => oldError()); expect(f.photo()).toBeUndefined(); expect(f.text()).toContain('A'); result.data = card({ profile_photo_url: 'https://example.invalid/new.jpg' }); f.update();
  act(() => oldError()); expect(f.photo().props.source.uri).toContain('new.jpg');
});
it('long names wrap and malformed historical dates are omitted', () => {
  const name = 'Amelia Alexandra de la Cruz'; result.data = card({ first_name_display: name, since_date: 'bad-date' }); const f = mount();
  const title = f.tree.root.findAllByType(Text).find(n => n.props.children === name)!; expect(title.props.numberOfLines).toBeUndefined(); expect(f.text()).not.toContain('Invalid Date'); expect(f.text()).not.toContain('since');
});
it('keeps the default visual family when appearance is absent', () => {
  const f = mount({ appearance: undefined }); expect(f.tree.root.findByType('LegacyAvatar' as any).props.size).toBe(120); expect(f.photo()).toBeUndefined(); expect(f.sheet().props.appearance).toBeUndefined();
});

it('uses content height for staged minimal profiles while retaining scroll bounds and the legacy80% sheet', () => {
  const f = mount(); expect(f.sheet().props.heightPct).toBeUndefined();
  expect(StyleSheet.flatten(f.tree.root.findByType(ScrollView).props.style)).toMatchObject({ flexGrow: 0, flexShrink: 1 });
  f.update({ appearance: undefined }); expect(f.sheet().props.heightPct).toBe(0.8);
  expect(f.tree.root.findByType(ScrollView).props.style).toBeUndefined();
});

it('passes a visit scope that prevents a deferred request from dispatching after close/reopen', async () => {
  const gate = deferred<void>(), dispatched = jest.fn();
  mockSend.mockImplementation(async (args, options) => {
    await gate.promise;
    if (!options.scope.isCurrent()) { const error = new Error('obsolete'); error.name = 'ObsoletePeopleConnectionError'; throw error; }
    dispatched(args); return 'requested';
  });
  const f = mount(); act(() => f.button('Add Amelia').props.onPress());
  const scope = mockSend.mock.calls[0][1].scope; expect(scope.userId).toBe('alice'); expect(scope.isCurrent()).toBe(true);
  f.update({ visible: false }); f.update({ visible: true }); expect(scope.isCurrent()).toBe(false);
  await act(async () => gate.resolve()); expect(dispatched).not.toHaveBeenCalled(); expect(f.props.onClose).not.toHaveBeenCalled(); expect(f.text()).not.toContain('Request failed');
});
it('does not show mutation-layer obsolete feedback even if the profile observer has not rerendered yet', async () => {
  const error = new Error('obsolete'); error.name = 'ObsoletePeopleConnectionError'; mockSend.mockRejectedValue(error);
  const f = mount(); await act(async () => f.button('Add Amelia').props.onPress());
  expect(f.text()).not.toContain('Request failed'); expect(f.props.onClose).not.toHaveBeenCalled(); expect(f.button('Add Amelia').props.disabled).toBe(false);
});
