jest.mock('../../ProfileButton', () => ({ __esModule: true, default: () => require('react').createElement(require('react-native').TouchableOpacity, { accessibilityRole: 'button', accessibilityLabel: 'Profile' }) }));
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ActionSheetIOS, Alert, Platform, Text, TouchableOpacity } from 'react-native';
import CircleChatScreen from '../../../app/(tabs)/chats/circle/[id]';
import ChatThread from '../ChatThread';
import MenuCard from '../../menu/MenuCard';
import AddPeopleSheet from '../../circles/AddPeopleSheet';
import CirclePlanComposer from '../../circles/plan/CirclePlanComposer';
import { buildComposerWithPerson } from '../../../lib/composerLink';

let mockAnchor: string | undefined;
let mockRoomId = 'circle-one', mockViewerId: string | null = 'account-a', mockEpoch = 1;
let mockError = false, mockNamed = false, mockLoading = false, mockUnavailable = false;
const mockRefetch = jest.fn();
const mockPush = jest.fn(), mockBack = jest.fn();
const mockMember = (id: string, name: string) => ({ user_id: id, first_name_display: name, profile_photo_url: null });
jest.mock('expo-router', () => ({ Redirect: () => null, useLocalSearchParams: () => ({ id: mockRoomId, reactionMessageId: mockAnchor, reactionMessageSource: mockAnchor ? 'chat' : undefined }), useRouter: () => ({ push: mockPush, back: mockBack }) }));
jest.mock('../../../constants/FeatureFlags', () => ({ GROUPS_ENABLED: true }));
jest.mock('../../yours/state/useAuthUserId', () => ({ useAuthUserId: () => ({ data: mockViewerId }) }));
jest.mock('../../../hooks/useObservedUser', () => ({ useObservedUser: () => {
  const React = require('react');
  const viewerId = mockViewerId, epoch = mockEpoch;
  return React.useMemo(() => ({ viewerId, epoch, isLoading: false, error: null, isCurrent: () => viewerId === mockViewerId && epoch === mockEpoch }), [viewerId, epoch]);
} }));
jest.mock('../../../hooks/useCircle', () => ({ useCircle: (id: string) => {
  const React = require('react');
  const viewerId = mockViewerId, viewerEpoch = mockEpoch;
  const isCurrentViewer = React.useCallback(() => viewerId === mockViewerId && viewerEpoch === mockEpoch, [viewerId, viewerEpoch]);
  return {
    isError: mockError, isLoading: mockLoading, isFetching: mockLoading, refetch: mockRefetch, viewerId, viewerEpoch, isCurrentViewer,
    data: mockLoading ? undefined : mockUnavailable ? null : { circle: { id, name: mockNamed ? 'Our circle' : '' }, members: [mockMember(mockViewerId ?? 'account-a', 'Me'), mockMember('member-one', 'Jamie')] },
  };
} }));
jest.mock('../ChatThread', () => ({ __esModule: true, default: () => null }));
jest.mock('../../menu/MenuCard', () => ({ __esModule: true, default: () => null }));
jest.mock('../../circles/AddPeopleSheet', () => ({ __esModule: true, default: () => null }));
jest.mock('../../circles/plan/CirclePlanComposer', () => ({ __esModule: true, default: () => null }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: require('react-native').View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('lucide-react-native', () => ({ CalendarPlus: () => null, Users: () => null, ChevronLeft: () => null, MessageCircle: () => null }));

let tree: ReactTestRenderer | undefined;
let nativeMenus: { options: any; choose: (index: number) => void }[];
let androidMenus: any[][];
const anchor = { x: 300, y: 48, width: 40, height: 40 };
const thread = () => tree!.root.findByType(ChatThread).props;
const menu = () => tree!.root.findByType(MenuCard).props;
const add = () => tree!.root.findByType(AddPeopleSheet).props;
const plan = () => tree!.root.findByType(CirclePlanComposer).props;
async function mount() { await act(async () => { tree = create(<CircleChatScreen />); }); }
async function update() { await act(async () => tree!.update(<CircleChatScreen />)); }
async function move(change: 'room' | 'account') {
  if (change === 'room') mockRoomId = 'circle-two'; else { mockViewerId = 'account-b'; mockEpoch++; }
  await update();
}
function openPlus() { act(() => thread().headerMenu.onPress(anchor)); }
function chooseDm(key: 'plan' | 'circle') {
  const props = menu();
  act(() => { props.onClose(); props.rows.find((row: any) => row.key === key).onPress(); });
  return menu().onClosed;
}
beforeEach(() => {
  mockAnchor=undefined; jest.clearAllMocks(); mockRoomId = 'circle-one'; mockViewerId = 'account-a'; mockEpoch = 1; mockNamed = false; mockError = false; mockLoading = false; mockUnavailable = false;
  nativeMenus = []; androidMenus = [];
  jest.replaceProperty(Platform, 'OS', 'ios');
  jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation((options, choose) => { nativeMenus.push({ options, choose }); });
  jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => { androidMenus.push(buttons ?? []); });
});
afterEach(() => { act(() => tree?.unmount()); tree = undefined; jest.restoreAllMocks(); });

it('preserves the DM plan route and waits for the current menu to finish closing', async () => {
  await mount(); expect(thread().title).toBe('Jamie'); openPlus(); expect(menu().visible).toBe(true); expect(menu().anchor).toEqual(anchor);
  const closed = chooseDm('plan'); expect(mockPush).not.toHaveBeenCalled(); act(() => closed());
  expect(mockPush).toHaveBeenCalledWith(buildComposerWithPerson('member-one', 'Jamie', null));
  act(() => closed()); expect(mockPush).toHaveBeenCalledTimes(1);
});

it('preserves Start a circle with the original room and member IDs after dismissal', async () => {
  await mount(); openPlus(); const closed = chooseDm('circle'); expect(add().visible).toBe(false);
  act(() => closed()); expect(add()).toMatchObject({ visible: true, circleId: 'circle-one', existingMemberIds: ['account-a', 'member-one'] });
  expect(mockPush).not.toHaveBeenCalled();
});

it('passes the same readable entry scope to child workflows and retires it with access', async () => {
  await mount();
  const scope = add().scope;
  expect(scope).toMatchObject({ userId: 'account-a', isCurrent: expect.any(Function) });
  expect(scope.isCurrent()).toBe(true); expect(plan().scope).toBe(scope);
  mockError = true; await update(); expect(scope.isCurrent()).toBe(false);
});

it('keeps child ownership stable across same-account metadata refreshes', async () => {
  await mount();
  const scope = add().scope;
  await update();
  expect(add().scope).toBe(scope); expect(plan().scope).toBe(scope);
  expect(scope.isCurrent()).toBe(true);
});

it.each(['room', 'account'] as const)('rejects the measured plus-menu callback after the %s changes', async change => {
  await mount(); const measuredPlus = thread().headerMenu.onPress;
  await move(change); act(() => measuredPlus(anchor));
  expect(menu().visible).toBe(false); expect(nativeMenus).toHaveLength(0);
});

it.each(['room', 'account'] as const)('retires a pending DM plan when its %s changes before menu dismissal', async change => {
  await mount(); openPlus(); const closed = chooseDm('plan'); await move(change);
  act(() => closed()); expect(mockPush).not.toHaveBeenCalled(); expect(add().visible).toBe(false); expect(plan().visible).toBe(false);
});

it.each(['room', 'account'] as const)('retires Start a circle when its %s changes before menu dismissal', async change => {
  await mount(); openPlus(); const closed = chooseDm('circle'); await move(change);
  act(() => closed()); expect(add().visible).toBe(false); expect(mockPush).not.toHaveBeenCalled();
});

it('does not revive an old DM intent after account A to B to A between renders', async () => {
  await mount(); openPlus(); const closed = chooseDm('plan');
  mockViewerId = 'account-b'; mockEpoch++; mockViewerId = 'account-a'; mockEpoch++;
  act(() => closed()); expect(mockPush).not.toHaveBeenCalled(); await update();
  act(() => closed()); expect(mockPush).not.toHaveBeenCalled();
});

it('does not let an old menu closure consume a newly opened menu action in the same room', async () => {
  await mount(); openPlus(); const oldClosed = chooseDm('plan');
  openPlus(); const newClosed = chooseDm('circle');
  act(() => oldClosed()); expect(add().visible).toBe(false); expect(mockPush).not.toHaveBeenCalled();
  act(() => newClosed()); expect(add().visible).toBe(true); expect(mockPush).not.toHaveBeenCalled();
});

it('accepts only the first queued row action for one closing menu', async () => {
  await mount(); openPlus(); const props = menu();
  act(() => { props.onClose(); props.rows.find((row: any) => row.key === 'circle').onPress(); props.rows.find((row: any) => row.key === 'plan').onPress(); });
  act(() => menu().onClosed());
  expect(add().visible).toBe(true); expect(mockPush).not.toHaveBeenCalled();
});

it('ignores an old menu close callback while a newer same-room menu is open', async () => {
  await mount(); openPlus(); const old = menu(); act(() => old.onClose()); openPlus();
  expect(menu().visible).toBe(true); act(() => old.onClose()); expect(menu().visible).toBe(true);
});

it('preserves branded Circle actions and post-dismissal plan navigation', async () => {
  mockNamed = true; await mount(); expect(thread().title).toBe('Our circle'); openPlus();
  act(() => chooseDm('circle')()); expect(add().visible).toBe(true);
  act(() => add().onClose()); openPlus(); act(() => chooseDm('plan')());
  const composer = plan(); expect(composer).toMatchObject({ visible: true, circleId: 'circle-one', circleName: 'Our circle', isDm: false });
  act(() => { composer.onClose(); composer.onPosted({ has_own_chat: true, event_id: 'new-plan' }); });
  expect(mockPush).toHaveBeenCalledWith('/plan/new-plan');
  mockPush.mockClear(); act(() => composer.onPosted({ has_own_chat: false, event_id: 'circle-plan' })); expect(mockPush).not.toHaveBeenCalled();
});

it.each(['room', 'account'] as const)('ignores a Circle menu result after the %s changes', async change => {
  mockNamed = true; await mount(); openPlus(); const closed = chooseDm('plan');
  await move(change); act(() => closed());
  expect(add().visible).toBe(false); expect(plan().visible).toBe(false);
});

it('uses the same branded Circle actions on Android and retires old callbacks', async () => {
  mockNamed = true; jest.replaceProperty(Platform, 'OS', 'android'); await mount(); openPlus();
  expect(menu().rows.map((r: any) => r.label)).toEqual(['Make a plan', 'Add people']);
  const closed = chooseDm('circle'); expect(add().visible).toBe(false);
  act(() => closed()); expect(add().visible).toBe(true);
  await move('account'); act(() => closed()); expect(add().visible).toBe(false);
  openPlus(); act(() => chooseDm('plan')()); expect(plan().visible).toBe(true);
  expect(nativeMenus).toHaveLength(0); expect(androidMenus).toHaveLength(0);
});

it('rejects old context navigation and completed composer callbacks after an account change', async () => {
  mockNamed = true; await mount(); const view = thread().onViewContext; openPlus(); act(() => chooseDm('plan')());
  const composer = plan(); await move('account');
  act(() => { view(); composer.onPosted({ has_own_chat: true, event_id: 'old-plan' }); }); expect(mockPush).not.toHaveBeenCalled();
  act(() => thread().onViewContext()); expect(mockPush).toHaveBeenCalledWith('/circle/circle-one');
});

it('does not let an old sheet close the new account’s sheet', async () => {
  mockNamed = true; await mount(); openPlus(); act(() => chooseDm('circle')()); const oldClose = add().onClose;
  await move('account'); openPlus(); act(() => chooseDm('circle')()); expect(add().visible).toBe(true);
  act(() => oldClose()); expect(add().visible).toBe(true);
});

it('retires pending DM navigation on unmount', async () => {
  await mount(); openPlus(); const closed = chooseDm('plan'); act(() => tree!.unmount());
  act(() => closed()); expect(mockPush).not.toHaveBeenCalled();
});

it('holds the Circle and direct composer until its identity and details load', async () => {
  mockLoading = true; await mount();
  expect(tree!.root.findAllByType(ChatThread)).toHaveLength(0);
  expect(tree!.root.findAllByType(Text).map(text => text.props.children)).toContain('Opening your chat');
  mockLoading = false; await update();
  expect(thread().title).toBe('Jamie');
});
it('offers retry after Circle or direct chat details fail', async () => {
  mockError = true; await mount();
  const retry = tree!.root.findAllByType(TouchableOpacity).find(button => button.props.accessibilityLabel === 'Retry opening chat')!;
  act(() => retry.props.onPress()); expect(mockRefetch).toHaveBeenCalledTimes(1);
  expect(tree!.root.findAllByType(ChatThread)).toHaveLength(0);
});

it.each([true,false])('passes a reaction target through an admitted named-circle=%s route', async named => {
 mockNamed=named;mockAnchor='33333333-3333-4333-8333-000000000100';await mount();
 expect(thread().reactionMessageId).toBe(mockAnchor);expect(thread().reactionMessageSource).toBe('chat');
});

it('shows the neutral unavailable entry without mounting private chat or exposing the peer', async () => {
  mockUnavailable = true; await mount();
  expect(tree!.root.findAllByType(ChatThread)).toHaveLength(0);
  expect(tree!.root.findAllByType(MenuCard)).toHaveLength(0);
  const text = tree!.root.findAllByType(Text).map(node => node.props.children);
  expect(text).toContain('Chat unavailable'); expect(text).not.toContain('Jamie');
});
it('removes a newly blocked conversation and rejects its retained profile and plan actions', async () => {
  await mount(); const viewPerson = thread().onViewContext;
  openPlus(); const closed = chooseDm('plan'); mockUnavailable = true; mockEpoch++; await update();
  act(() => { closed(); viewPerson(); }); expect(mockPush).not.toHaveBeenCalled();
  expect(tree!.root.findAllByType(ChatThread)).toHaveLength(0);
  expect(tree!.root.findAllByType(CirclePlanComposer)).toHaveLength(0);
});
