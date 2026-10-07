import React from 'react';
import { Alert, Modal, ScrollView, StyleSheet, Text } from 'react-native';
import { act, create } from 'react-test-renderer';
import KeepPage, { type KeepPageProps } from '../KeepPage';
import { AfterglowFallbackFonts, AfterglowType } from '../../../../constants/Typography';
import type { ProfileCard } from '../../../../lib/yours/types';
const mockProfile = jest.fn(), mockMyFace = jest.fn(), mockSend = jest.fn(), mockRemove = jest.fn(), mockVisibility = jest.fn(), mockDm = jest.fn(), mockRefetch = jest.fn(), mockRetry = jest.fn(), mockPush = jest.fn(), mockBack = jest.fn();
let mockFocused = true, mockViewerId = 'alice', mockEpoch = 0, mockIdentityError: Error | null = null, mockIdentityLoading = false;
jest.mock('expo-router', () => ({ router: { push: (...args: unknown[]) => mockPush(...args), back: () => mockBack() } }));
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => mockFocused }));
jest.mock('lucide-react-native', () => ({ ChevronLeft: () => null, MoreHorizontal: () => null, MessageCircle: () => null, CalendarPlus: () => null }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: (props: any) => require('react').createElement('SafeArea', props, props.children) }));
jest.mock('../../../../lib/haptics', () => ({ hapticSelection: jest.fn() }));
jest.mock('../../../../hooks/useProfileCard', () => ({ useProfileCard: (...args: unknown[]) => mockProfile(...args) }));
jest.mock('../../../../hooks/useMyFace', () => ({ useMyFace: (...args: unknown[]) => mockMyFace(...args) }));
jest.mock('../../../../hooks/useObservedUser', () => ({ useObservedUser: () => { const epoch = mockEpoch; return { viewerId: mockViewerId, epoch, isCurrent: () => epoch === mockEpoch, isLoading: mockIdentityLoading, error: mockIdentityError, retry: mockRetry }; } }));
jest.mock('../../../../hooks/useGetOrCreateDm', () => ({ useGetOrCreateDm: () => ({ mutateAsync: mockDm }), isObsoleteDmOperation: (error: Error) => error.name === 'ObsoleteDmOperationError' }));
jest.mock('../../../../hooks/usePeopleConnectionMutations', () => ({ usePeopleConnectionMutations: () => ({ sendRequest: { mutateAsync: mockSend }, remove: { mutateAsync: mockRemove }, setVisibility: { mutateAsync: mockVisibility } }), friendlyConnectionError: () => 'Request failed. Try again.', isObsoletePeopleConnection: (error: Error) => error.name === 'ObsoletePeopleConnectionError' }));
jest.mock('../../../BrandedAlert', () => ({ BrandedAlert: (props: any) => require('react').createElement('BrandedAlert', props) }));
jest.mock('../../../ProfileButton', () => ({ __esModule: true, default: (props: any) => require('react').createElement('ProfileButton', props) }));
jest.mock('../KeepHero', () => ({ __esModule: true, default: (props: any) => require('react').createElement('KeepHero', props) }));
jest.mock('../StoryTimeline', () => ({ __esModule: true, default: (props: any) => require('react').createElement('StoryTimeline', props) }));
const full = (extra: Partial<ProfileCard> = {}): ProfileCard => ({ kind: 'full', user_id: 'amelia', first_name_display: 'Amelia', profile_photo_url: 'https://example.invalid/a.jpg', handle: 'amelia', shared_count: 3, milestone: null, since_date: '2026-01-01', upcoming: [{ event_id: 'next-plan', title: 'Their next plan', start_time: '2026-10-01' }], adventures: [{ album_id: 'album-id', event_id: 'event-id', title: 'Beach day', date: '2026-01-01', thumb_url: null }], ...extra });
let result: { data: ProfileCard | null; isLoading: boolean; isFetching: boolean; isError: boolean; refetch: typeof mockRefetch };
let face: { data: { first_name_display: string; profile_photo_url: string } | null; isError: boolean };
const cleanup: Array<() => void> = [];
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function mount(extra: Partial<KeepPageProps> = {}) {
  let props: KeepPageProps = { userId: 'alice', targetId: 'amelia', appearance: { fonts: AfterglowFallbackFonts }, ...extra };
  let tree!: ReturnType<typeof create>; act(() => { tree = create(<KeepPage {...props} />); });
  let closed = false; const unmount = () => { if (!closed) act(() => tree.unmount()); closed = true; }; cleanup.push(unmount);
  const button = (label: string) => tree.root.findAll(n => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function')[0];
  const menu = () => { act(() => button('More options').props.onPress()); return (Alert.alert as jest.Mock).mock.calls.at(-1)[2] as Array<{text: string; onPress?: () => void}>; };
  return { tree, unmount, button, menu,
    update: (next: Partial<KeepPageProps> = {}) => { props = { ...props, ...next }; act(() => tree.update(<KeepPage {...props} />)); },
    text: () => tree.root.findAllByType(Text).map(n => n.props.children).flat().join(' '),
    hero: () => tree.root.findByType('KeepHero' as any).props,
    timeline: () => tree.root.findAllByType('StoryTimeline' as any)[0],
    openRemove: () => { const item = menu().find(i => i.text === 'Remove from your people')!; act(() => item.onPress!()); },
  };
}
beforeEach(() => {
  jest.clearAllMocks(); mockFocused = true; mockViewerId = 'alice'; mockEpoch = 0; mockIdentityError = null; mockIdentityLoading = false;
  result = { data: full(), isLoading: false, isFetching: false, isError: false, refetch: mockRefetch };
  face = { data: { first_name_display: 'Liz', profile_photo_url: 'https://example.invalid/liz.jpg' }, isError: false };
  mockProfile.mockImplementation(() => result); mockMyFace.mockImplementation(() => face);
  mockSend.mockResolvedValue('requested'); mockDm.mockResolvedValue('dm-room'); mockRemove.mockResolvedValue(undefined); mockVisibility.mockResolvedValue(undefined); mockRefetch.mockResolvedValue({}); mockRetry.mockResolvedValue(undefined);
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => { cleanup.splice(0).forEach(fn => fn()); jest.restoreAllMocks(); });
it('preserves both faces, original counts and relationship data with optional appearance', () => {
  const f = mount(); expect(mockProfile).toHaveBeenCalledWith('alice', 'amelia'); expect(mockMyFace).toHaveBeenCalledWith('alice');
  expect(f.hero()).toMatchObject({ myName: 'Liz', myPhoto: 'https://example.invalid/liz.jpg', theirName: 'Amelia', plansCount: 3, albumsCount: 1, comingUpCount: 1, sinceDate: '2026-01-01', appearance: { fonts: AfterglowFallbackFonts } });
  expect(f.text()).toContain('Amelia’s upcoming plans'); expect(f.text()).not.toContain('together');
});
it('uses only allowed minimal fields and hides private full history/actions', () => {
  result.data = full({ kind: 'minimal' }); const f = mount(); expect(f.hero()).toMatchObject({ albumsCount: 0, comingUpCount: 0, sinceDate: null });
  expect(f.timeline()).toBeUndefined(); expect(f.button('More options')).toBeUndefined(); expect(f.button('Message Amelia')).toBeUndefined(); expect(f.button('Add Amelia')).toBeDefined();
});
it('shows unavailable for null and wrong-target data instead of an endless spinner', () => {
  result.data = null; const f = mount(); expect(f.text()).toContain('This page isn’t available'); expect(f.text()).not.toContain('Loading');
  result.data = full({ user_id: 'someone-else' }); f.update(); expect(f.text()).toContain('This page isn’t available'); expect(f.button('Message Amelia')).toBeUndefined();
});
it('profile failures keep Back and explicit retry reachable', async () => {
  result.isError = true; const f = mount(); expect(f.text()).toContain('Couldn’t load this page'); expect(f.button('Back')).toBeDefined();
  await act(async () => f.button('Try again to load shared plans').props.onPress()); expect(mockRefetch).toHaveBeenCalledTimes(1);
});
it('failed identity never queries another account and offers retry', async () => {
  mockIdentityError = new Error('offline'); const f = mount(); expect(mockProfile).toHaveBeenCalledWith(null, null); expect(mockMyFace).toHaveBeenCalledWith(null);
  await act(async () => f.button('Try again to check account').props.onPress()); expect(mockRetry).toHaveBeenCalledTimes(1);
});
it('failed own photo lookup falls back without hiding the other person or pretending a new photo', () => {
  face.isError = true; const f = mount(); expect(f.hero()).toMatchObject({ myName: 'You', myPhoto: null, theirName: 'Amelia' });
});
it('Message serializes rapid taps and routes only to the confirmed existing DM destination', async () => {
  const pending = deferred<string>(); mockDm.mockReturnValue(pending.promise); const f = mount(); const send = f.button('Message Amelia').props.onPress;
  act(() => { send(); send(); }); expect(mockDm).toHaveBeenCalledTimes(1); expect(mockDm).toHaveBeenCalledWith('amelia'); expect(f.button('Opening chat with Amelia').props.disabled).toBe(true);
  await act(async () => pending.resolve('dm-room')); expect(mockPush).toHaveBeenCalledWith('/(tabs)/chats/circle/dm-room');
});
it('Message failure stays visible with a retryable Message action', async () => {
  mockDm.mockRejectedValueOnce(new Error('offline')); const f = mount(); await act(async () => f.button('Message Amelia').props.onPress());
  expect(f.text()).toContain("Couldn't open this chat"); expect(mockPush).not.toHaveBeenCalled(); await act(async () => f.button('Message Amelia').props.onPress()); expect(mockPush).toHaveBeenCalledTimes(1);
});
it('does not navigate on an empty DM receipt', async () => {
  mockDm.mockResolvedValue(''); const f = mount(); await act(async () => f.button('Message Amelia').props.onPress()); expect(mockPush).not.toHaveBeenCalled(); expect(f.text()).toContain("Couldn't open this chat");
});
it('Make a plan preserves a removable pre-attached invite and suppresses repeat navigation', () => {
  const f = mount(); const plan = f.button('Make a plan').props.onPress; act(() => { plan(); plan(); }); expect(mockPush).toHaveBeenCalledTimes(1);
  const route = mockPush.mock.calls[0][0]; expect(route).toContain('prefillInvitePersonId=amelia'); expect(route).toContain('prefillInvitePersonName=Amelia'); expect(route).toContain('prefillInvitePersonPhoto=');
});
it('a retained plan action cannot bypass a Message operation that just started', () => {
  const pending = deferred<string>(); mockDm.mockReturnValue(pending.promise); const f = mount(); const plan = f.button('Make a plan').props.onPress, send = f.button('Message Amelia').props.onPress;
  act(() => { send(); plan(); }); expect(mockDm).toHaveBeenCalledTimes(1); expect(mockPush).not.toHaveBeenCalled();
});
it('keeps plan and album destinations and never substitutes album_id for event_id', () => {
  const f = mount(); act(() => f.timeline().props.onOpenAlbum('event-id')); expect(mockPush).toHaveBeenCalledWith('/album/event-id');
  mockFocused = false; f.update(); mockFocused = true; f.update(); act(() => f.button('View plan, Their next plan, Thu, Oct 1').props.onPress()); expect(mockPush).toHaveBeenLastCalledWith('/plan/next-plan');
});
it('focus changes preserve ScrollView identity but retire a late DM navigation across blur and return', async () => {
  const pending = deferred<string>(); mockDm.mockReturnValue(pending.promise); const f = mount(); const scroll = f.tree.root.findAllByType(ScrollView)[0]; act(() => f.button('Message Amelia').props.onPress());
  mockFocused = false; f.update(); mockFocused = true; f.update(); expect(f.tree.root.findAllByType(ScrollView)[0]).toBe(scroll);
  await act(async () => pending.resolve('dm-room')); expect(mockPush).not.toHaveBeenCalled(); expect(f.button('Message Amelia').props.disabled).toBe(false);
});
it('target replacement and old action/menu callbacks cannot target or navigate the new person', async () => {
  const pending = deferred<string>(); mockDm.mockReturnValue(pending.promise); const f = mount(); const menu = f.menu(), send = f.button('Message Amelia').props.onPress; act(() => send());
  result.data = full({ user_id: 'luca', first_name_display: 'Luca' }); f.update({ targetId: 'luca' }); act(() => menu[0].onPress!());
  await act(async () => pending.resolve('dm-room')); expect(mockPush).not.toHaveBeenCalled(); expect(mockVisibility).not.toHaveBeenCalled();
});
it('account/auth epoch transitions prevent pending work from navigating a new account', async () => {
  const pending = deferred<string>(); mockDm.mockReturnValue(pending.promise); const f = mount(); act(() => f.button('Message Amelia').props.onPress());
  mockViewerId = 'bob'; mockEpoch++; f.update({ userId: 'bob' }); mockViewerId = 'alice'; mockEpoch++; f.update({ userId: 'alice' });
  await act(async () => pending.resolve('dm-room')); expect(mockPush).not.toHaveBeenCalled();
});
it('Back retires current work before unmount or navigation focus update', async () => {
  const pending = deferred<string>(); mockDm.mockReturnValue(pending.promise); const f = mount(); act(() => f.button('Message Amelia').props.onPress());
  act(() => f.button('Back').props.onPress()); await act(async () => pending.resolve('dm-room')); expect(mockBack).toHaveBeenCalledTimes(1); expect(mockPush).not.toHaveBeenCalled();
});
it('minimal Add uses the same scoped handshake and navigates after a confirmed receipt', async () => {
  result.data = full({ kind: 'minimal' }); const f = mount(); await act(async () => f.button('Add Amelia').props.onPress());
  expect(mockSend).toHaveBeenCalledWith({ recipientId: 'amelia', context: 'handle_lookup' }, { scope: { userId: 'alice', isCurrent: expect.any(Function) } }); expect(mockBack).toHaveBeenCalledTimes(1);
});
it('minimal Add failure remains on the same page', async () => {
  result.data = full({ kind: 'minimal' }); mockSend.mockRejectedValue(new Error('failed')); const f = mount(); await act(async () => f.button('Add Amelia').props.onPress()); expect(mockBack).not.toHaveBeenCalled(); expect(f.text()).toContain('Request failed');
});
it('privacy action passes the original values with a current scope and reports confirmed success', async () => {
  const f = mount(); const hide = f.menu()[0].onPress!; await act(async () => hide());
  expect(mockVisibility).toHaveBeenCalledWith({ personId: 'amelia', hidden: true }, { scope: { userId: 'alice', isCurrent: expect.any(Function), canDispatch: expect.any(Function) } }); expect(f.text()).toContain('upcoming plans are hidden');
});
it('privacy failure is visible, and a stale menu after blur cannot issue the write', async () => {
  mockVisibility.mockRejectedValue(new Error('failed')); const f = mount(); const hide = f.menu()[0].onPress!; await act(async () => hide()); expect(f.text()).toContain('Couldn’t update your privacy');
  mockFocused = false; f.update(); mockFocused = true; f.update(); await act(async () => hide()); expect(mockVisibility).toHaveBeenCalledTimes(1);
});
it('remove requires the confirmation, locks repeat taps and navigates only on success', async () => {
  const pending = deferred<void>(); mockRemove.mockReturnValue(pending.promise); const f = mount(); f.openRemove(); expect(mockRemove).not.toHaveBeenCalled(); const remove = f.button('Remove person').props.onPress;
  act(() => { remove(); remove(); }); expect(mockRemove).toHaveBeenCalledTimes(1); expect(mockBack).not.toHaveBeenCalled();
  expect(mockRemove).toHaveBeenCalledWith('amelia', { scope: { userId: 'alice', isCurrent: expect.any(Function), canDispatch: expect.any(Function) } });
  await act(async () => pending.resolve()); expect(mockBack).toHaveBeenCalledTimes(1);
});
it('cancel invalidates a retained Remove callback before it can dispatch', () => {
  const f = mount(); f.openRemove(); const remove = f.button('Remove person').props.onPress; act(() => f.button('Cancel').props.onPress()); act(() => remove()); expect(mockRemove).not.toHaveBeenCalled();
});
it('remove failure keeps relationship intact and offers another deliberate attempt', async () => {
  mockRemove.mockRejectedValueOnce(new Error('failed')); const f = mount(); f.openRemove(); await act(async () => f.button('Remove person').props.onPress()); expect(mockBack).not.toHaveBeenCalled(); expect(f.text()).toContain('remove');
  f.openRemove(); await act(async () => f.button('Remove person').props.onPress()); expect(mockRemove).toHaveBeenCalledTimes(2); expect(mockBack).toHaveBeenCalledTimes(1);
});
it('old remove failures cannot close a newly opened confirmation after focus return', async () => {
  const pending = deferred<void>(); mockRemove.mockReturnValue(pending.promise); const f = mount(); f.openRemove(); act(() => f.button('Remove person').props.onPress());
  mockFocused = false; f.update(); mockFocused = true; f.update(); f.openRemove(); await act(async () => pending.reject(new Error('failed')));
  const modal = f.tree.root.findByType(Modal); expect(modal.props.visible).toBe(true); expect(mockBack).not.toHaveBeenCalled();
});
it('full access disappearing invalidates retained message and plan actions', () => {
  const f = mount(); const send = f.button('Message Amelia').props.onPress, plan = f.button('Make a plan').props.onPress;
  result.data = full({ kind: 'minimal' }); f.update(); act(() => { send(); plan(); }); expect(mockDm).not.toHaveBeenCalled(); expect(mockPush).not.toHaveBeenCalled();
});
it('empty full relationships preserve both faces and clear actions without zero stats', () => {
  result.data = full({ shared_count: 0, upcoming: [], adventures: [] }); const f = mount(); expect(f.hero().hideStats).toBe(true); expect(f.text()).toContain('Your next plan starts here'); expect(f.text()).toContain('Pick something'); expect(f.button('Message Amelia')).toBeDefined();
  const planLabels = f.tree.root.findAllByType(Text).filter(n => n.props.children === 'Make a plan'); expect(planLabels).toHaveLength(1);
});
it('default callers retain the existing visual family and confirmation component', () => {
  const f = mount({ appearance: undefined }); expect(f.hero().appearance).toBeUndefined(); expect(f.tree.root.findByType('BrandedAlert' as any)).toBeDefined();
});

it('retained album and upcoming-plan actions do not open entries removed by a refresh', () => {
  const f = mount(); const album = f.timeline().props.onOpenAlbum, plan = f.button('View plan, Their next plan, Thu, Oct 1').props.onPress;
  result.data = full({ upcoming: [], adventures: [] }); f.update();
  act(() => { album('event-id'); plan(); }); expect(mockPush).not.toHaveBeenCalled();
});

it('shows the upcoming plan’s LA date and time below its title with the original route', () => {
  result.data = full({ upcoming: [{ event_id: 'evening-plan', title: 'Dinner by the ocean', start_time: '2026-10-02T01:30:00Z' }] });
  const f = mount(), when = 'Thu, Oct 1, 6:30 PM'; expect(f.text()).toContain(when);
  const date = f.tree.root.findAllByType(Text).find(n => n.props.children === when)!;
  expect(StyleSheet.flatten(date.props.style)).toMatchObject({ ...AfterglowType.caption, fontFamily: AfterglowFallbackFonts.regular });
  expect(f.tree.root.findAllByType(ScrollView).some(n => n.props.horizontal)).toBe(true);
  act(() => f.button(`View plan, Dinner by the ocean, ${when}`).props.onPress()); expect(mockPush).toHaveBeenCalledWith('/plan/evening-plan');
});
it('keeps a valid date-only plan on the same calendar day without inventing a time', () => {
  const f = mount(); expect(f.text()).toContain('Thu, Oct 1'); expect(f.text()).not.toContain('5:00 PM');
});
it.each(['bad-date', '', '2026-02-30'])('omits invalid upcoming date %s while the plan stays reachable', start_time => {
  result.data = full({ upcoming: [{ event_id: 'next-plan', title: 'Their next plan', start_time }] });
  const f = mount(); expect(f.text()).not.toContain('Invalid Date'); expect(f.text()).not.toContain('Thu, Oct');
  act(() => f.button('View plan, Their next plan').props.onPress()); expect(mockPush).toHaveBeenCalledWith('/plan/next-plan');
});
it('wraps the complete staged title in a bounded horizontal card without clamping its date', () => {
  const title = 'Dinner, stories, and a long plan name that needs several lines on a small phone';
  result.data = full({ upcoming: [{ event_id: 'next-plan', title, start_time: '2026-10-02T01:30:00Z' }] });
  const f = mount(), text = f.tree.root.findAllByType(Text).find(n => n.props.children === title)!;
  expect(text.props.numberOfLines).toBeUndefined();
  expect(StyleSheet.flatten(f.button(`View plan, ${title}, Thu, Oct 1, 6:30 PM`).props.style).maxWidth).toBe(240);
});
it('retains the legacy title-only upcoming pill and label', () => {
  result.data = full({ upcoming: [{ event_id: 'next-plan', title: 'Their next plan', start_time: '2026-10-02T01:30:00Z' }] });
  const f = mount({ appearance: undefined }); expect(f.text()).not.toContain('6:30 PM');
  expect(f.tree.root.findAllByType(Text).find(n => n.props.children === 'Their next plan')!.props.numberOfLines).toBe(1);
  expect(f.button('View plan, Their next plan')).toBeDefined();
});
