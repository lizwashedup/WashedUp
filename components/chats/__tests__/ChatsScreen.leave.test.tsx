import React from 'react';
import { Text, TouchableOpacity } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { useFocusEffect } from '@react-navigation/native';
import ChatsScreen from '../../../app/(tabs)/chats/index';
import { BrandedAlert } from '../../BrandedAlert';
import { COPY } from '../../yours/state/constants';
import { useChatList, type ChatPreview } from '../../../hooks/useChatList';
import { CircleLeaveUnconfirmed } from '../../../lib/circles/leaveReceipt';
import { supabase } from '../../../lib/supabase';

const mockMutateAsync = jest.fn(), mockCheck = jest.fn();
const mockRemoveChat = jest.fn();
const mockRefetch = jest.fn();
let mockCachedUserId: string | null = 'alice';

jest.mock('../../../hooks/useAfterglowFonts', () => ({
  useAfterglowFonts: () => ({ fonts: jest.requireActual('../../../constants/Typography').AfterglowFonts, loaded: true, error: null }),
}));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('expo-notifications', () => ({ setBadgeCountAsync: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@react-navigation/native', () => ({ useFocusEffect: jest.fn() }));
// The current screen also instantiates the separately tested notification query,
// even with its creator-page feature gate disabled in these grouping/leave tests.
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn(), cancelQueries: jest.fn().mockResolvedValue(undefined) }),
  useQuery: () => ({ data: undefined, error: null, isLoading: false, isFetching: false, isError: false, isSuccess: false }),
}));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: require('react-native').View }));
jest.mock('../../../lib/supabase', () => ({ supabase: { auth: { getUser: jest.fn(), onAuthStateChange: jest.fn() } } }));
jest.mock('../../../lib/haptics', () => ({ hapticSelection: jest.fn() }));
jest.mock('../../../hooks/useChatList', () => ({ useChatList: jest.fn() }));
jest.mock('../../../hooks/useCommunityChatRows', () => ({ useCommunityChatRows: () => ({ data: [], viewerId: 'alice', isLoading: false, error: null, refetch: jest.fn() }) }));
jest.mock('../../yours/state/useAuthUserId', () => ({ useAuthUserId: () => ({ data: mockCachedUserId }) }));
jest.mock('../../../hooks/useLeaveCircle', () => ({
  useLeaveCircle: () => ({ isPending: false, mutateAsync: mockMutateAsync, checkStatusAsync: mockCheck }),
  isObsoleteCircleLeave: (error: unknown) => error instanceof Error && error.name === 'ObsoleteCircleLeaveError',
}));
jest.mock('../../../constants/FeatureFlags', () => ({ COMMUNITIES_ENABLED: true, GROUPS_ENABLED: true, COMMUNITY_CHAT_GROUPING_ENABLED: true, CHAT_DELETE_ENABLED: true, YOURS_PAGE_ENABLED: true }));
jest.mock('../../ProfileButton', () => () => null);
jest.mock('../../SkeletonCard', () => ({ SkeletonChatList: () => null }));
jest.mock('../../yours/circles/CircleCover', () => () => null);

const circle: ChatPreview = {
  kind: 'circle', conversationId: 'circle-a', title: 'Weekend walks', category: null,
  image_url: null, start_time: new Date(Date.now() + 86400000).toISOString(), member_count: 3,
  last_message: 'See you there!', last_message_at: null, unread_count: 1,
  is_past: false, ticket_url: null, member_avatars: [],
};
const dm: ChatPreview = { ...circle, conversationId: 'dm-a', title: 'Amelia', is_dm: true };
const plan: ChatPreview = { ...circle, kind: 'event', conversationId: 'plan-a', title: 'Saturday picnic' };
let tree: ReactTestRenderer | undefined;
let emitAuth!: (event: AuthChangeEvent, session: Session | null) => void;
const session = (id: string | null) => id ? { user: { id } } as Session : null;
function deferred() {
  let resolve!: (result: string) => void, reject!: (error: Error) => void;
  const promise = new Promise<string>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function focusInbox() {
  let blur: void | (() => void);
  act(() => { blur = jest.mocked(useFocusEffect).mock.calls[0][0](); });
  return () => act(() => { if (blur) blur(); });
}

async function mount(chats = [circle, dm, plan]) {
  jest.mocked(useChatList).mockImplementation(viewer => {
    const [rows, setRows] = React.useState(chats);
    mockRemoveChat.mockImplementation(id => setRows(previous => previous.filter(row => row.conversationId !== id)));
    return { chats: viewer === 'alice' ? rows : [], loading: false, loadError: false, refetch: mockRefetch, removeChat: mockRemoveChat };
  });
  await act(async () => { tree = create(<ChatsScreen />); });
  return focusInbox();
}
const confirmAlert = () => tree!.root.findAllByType(BrandedAlert).find(node => !!node.props.buttons)!;
const errorAlert = () => tree!.root.findAllByType(BrandedAlert).find(node => !node.props.buttons)!;
const row = (chat: ChatPreview) => tree!.root.findAllByType(TouchableOpacity).find(node => node.findAllByType(Text).some(text => text.props.children === chat.title));
function open(chat = circle) { act(() => { row(chat)!.props.onLongPress(); }); }
function confirm() {
  const button = confirmAlert().props.buttons.find((item: { style?: string }) => item.style === 'destructive');
  let operation!: Promise<void>;
  act(() => { operation = button.onPress(); });
  return operation;
}
async function account(id: string | null) {
  await act(async () => { emitAuth(id ? 'SIGNED_IN' : 'SIGNED_OUT', session(id)); });
}
beforeEach(() => {
  jest.clearAllMocks();
  mockCachedUserId = 'alice';
  mockMutateAsync.mockReset().mockResolvedValue('left');
  jest.mocked(supabase.auth.getUser).mockResolvedValue({ data: { user: { id: 'alice' } }, error: null } as Awaited<ReturnType<typeof supabase.auth.getUser>>);
  jest.mocked(supabase.auth.onAuthStateChange).mockImplementation(callback => {
    emitAuth = callback;
    return { data: { subscription: { id: 'inbox-leave', callback, unsubscribe: jest.fn() } } };
  });
});
afterEach(() => { if (tree) act(() => tree!.unmount()); tree = undefined; });

it.each(['left', 'not_member'])('keeps a row until %s confirms success and blocks duplicate taps before a pending render', async result => {
  const pending = deferred(); mockMutateAsync.mockReturnValueOnce(pending.promise);
  await mount(); open();
  const saved = confirmAlert().props.buttons[1].onPress;
  const operation = confirm();
  act(() => { void saved(); row(dm)!.props.onLongPress(); });
  expect(mockMutateAsync).toHaveBeenCalledTimes(1);
  expect(mockMutateAsync).toHaveBeenCalledWith(circle.conversationId);
  expect(mockRemoveChat).not.toHaveBeenCalled();
  expect(row(circle)).toBeDefined();
  expect(confirmAlert().props.visible).toBe(false);
  await act(async () => { pending.resolve(result); await operation; });
  expect(mockRemoveChat).toHaveBeenCalledTimes(1);
  expect(row(circle)).toBeUndefined();
  expect(row(dm)).toBeDefined();
  expect(row(plan)).toBeDefined();
});

it.each([circle, dm])('keeps $title untouched on failure, uses its correct copy, and permits retry', async chat => {
  mockMutateAsync.mockRejectedValueOnce(new Error('Offline'));
  await mount(); open(chat);
  expect(confirmAlert().props.title).toBe(chat.is_dm ? COPY.dmDeleteTitle : COPY.circleLeaveTitle);
  expect(confirmAlert().props.message).toBe(chat.is_dm ? COPY.dmDeleteBody(chat.title) : COPY.circleLeaveBody);
  await act(async () => { await confirm(); });
  expect(row(chat)).toBeDefined();
  expect(mockRemoveChat).not.toHaveBeenCalled();
  expect(mockRefetch).not.toHaveBeenCalled();
  expect(errorAlert().props.title).toBe(chat.is_dm ? COPY.dmDeleteError : COPY.circleLeaveError);
  expect(errorAlert().props.visible).toBe(true);
  open(chat);
  expect(errorAlert().props.visible).toBe(false);
  await act(async () => { await confirm(); });
  expect(mockMutateAsync).toHaveBeenCalledTimes(2);
  expect(row(chat)).toBeUndefined();
});

it('consumes an actual alert button once and leaves plan rows without a leave action', async () => {
  await mount();
  expect(row(plan)!.props.onLongPress).toBeUndefined();
  open();
  const button = tree!.root.findAllByType(TouchableOpacity).find(node => node.findAllByType(Text).some(text => text.props.children === COPY.circleLeaveGo))!;
  await act(async () => { button.props.onPress(); button.props.onPress(); });
  expect(mockMutateAsync).toHaveBeenCalledTimes(1);
});

it('allows same-event close-before-action ordering but retires an otherwise dismissed confirmation', async () => {
  await mount(); open();
  const dismissed = confirmAlert().props;
  await act(async () => { dismissed.onClose(); });
  await act(async () => { await dismissed.buttons[1].onPress(); });
  expect(mockMutateAsync).not.toHaveBeenCalled();
  open();
  const action = confirmAlert().props;
  await act(async () => { action.onClose(); await action.buttons[1].onPress(); });
  expect(mockMutateAsync).toHaveBeenCalledTimes(1);
});

it('retires cancelled or replaced confirmations without affecting the newer chat', async () => {
  await mount(); open();
  const cancelled = confirmAlert().props;
  act(() => { cancelled.buttons[0].onPress(); void cancelled.buttons[1].onPress(); });
  expect(mockMutateAsync).not.toHaveBeenCalled();
  open();
  const replaced = confirmAlert().props;
  open(dm);
  await act(async () => { replaced.onClose(); await replaced.buttons[1].onPress(); });
  expect(mockMutateAsync).not.toHaveBeenCalled();
  expect(confirmAlert().props.visible).toBe(true);
  expect(confirmAlert().props.title).toBe(COPY.dmDeleteTitle);
  await act(async () => { await confirm(); });
  expect(mockMutateAsync).toHaveBeenCalledWith(dm.conversationId);
});

it('clears old confirmations and uses the observed account despite a stale shared auth query', async () => {
  await mount(); open();
  const saved = confirmAlert().props.buttons[1].onPress;
  await account('bob');
  expect(confirmAlert().props.visible).toBe(false);
  expect(row(circle)).toBeUndefined();
  await act(async () => { await saved(); });
  expect(confirmAlert().props.visible).toBe(false);
  expect(mockMutateAsync).not.toHaveBeenCalled();
  expect(useChatList).toHaveBeenLastCalledWith('bob');
});

it('rejects retained confirmation callbacks during a batched account A → B → A transition', async () => {
  await mount(); open();
  const saved = confirmAlert().props.buttons[1].onPress;
  await act(async () => {
    emitAuth('SIGNED_IN', session('bob'));
    emitAuth('SIGNED_IN', session('alice'));
    await saved();
  });
  expect(mockMutateAsync).not.toHaveBeenCalled();
  expect(confirmAlert().props.visible).toBe(false);
  open();
  await act(async () => { await confirm(); });
  expect(mockMutateAsync).toHaveBeenCalledTimes(1);
});

it('preserves the current confirmation and pending leave across same-account token refreshes', async () => {
  const pending = deferred(); mockMutateAsync.mockReturnValueOnce(pending.promise);
  await mount(); open();
  await act(async () => { emitAuth('TOKEN_REFRESHED', session('alice')); });
  expect(confirmAlert().props.visible).toBe(true);
  const operation = confirm();
  await act(async () => { emitAuth('TOKEN_REFRESHED', session('alice')); pending.resolve('left'); await operation; });
  expect(mockRemoveChat).toHaveBeenCalledWith(circle.conversationId);
});

it.each(['success', 'failure'])('ignores an old %s after account A → B → A and cannot unlock a newer pending request', async outcome => {
  const old = deferred(), next = deferred();
  mockMutateAsync.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
  await mount(); open(); const obsolete = confirm();
  await act(async () => { emitAuth('SIGNED_IN', session('bob')); emitAuth('SIGNED_IN', session('alice')); });
  open(dm); const current = confirm();
  await act(async () => {
    if (outcome === 'success') old.resolve('left'); else old.reject(new Error('Offline'));
    await obsolete;
  });
  expect(mockRemoveChat).not.toHaveBeenCalled();
  expect(errorAlert().props.visible).toBe(false);
  open();
  expect(confirmAlert().props.visible).toBe(false);
  expect(mockMutateAsync).toHaveBeenCalledTimes(2);
  await act(async () => { next.resolve('left'); await current; });
  expect(mockRemoveChat).toHaveBeenCalledWith(dm.conversationId);
  expect(row(circle)).toBeDefined();
});

it('clears old errors on account change and ignores a stale error-dismiss callback', async () => {
  mockMutateAsync.mockRejectedValueOnce(new Error('Offline')).mockRejectedValueOnce(new Error('Still offline'));
  await mount(); open(); await act(async () => { await confirm(); });
  const oldDismiss = errorAlert().props.onClose;
  await account(null);
  expect(errorAlert().props.visible).toBe(false);
  await account('alice'); open(dm); await act(async () => { await confirm(); });
  act(() => { oldDismiss(); });
  expect(errorAlert().props.visible).toBe(true);
  expect(errorAlert().props.title).toBe(COPY.dmDeleteError);
});

it('silently releases obsolete refusals and never removes a row for unknown results', async () => {
  const obsolete = new Error('Obsolete'); obsolete.name = 'ObsoleteCircleLeaveError';
  mockMutateAsync.mockRejectedValueOnce(obsolete).mockResolvedValueOnce(undefined);
  await mount(); open(); await act(async () => { await confirm(); });
  expect(errorAlert().props.visible).toBe(false);
  expect(mockRemoveChat).not.toHaveBeenCalled();
  open(); await act(async () => { await confirm(); });
  expect(mockMutateAsync).toHaveBeenCalledTimes(2);
  expect(mockRemoveChat).not.toHaveBeenCalled();
  expect(errorAlert().props.visible).toBe(true);
});

it.each(['success', 'failure'])('ignores a pending %s after unmount', async outcome => {
  const pending = deferred(); mockMutateAsync.mockReturnValueOnce(pending.promise);
  await mount(); open(); const operation = confirm();
  act(() => { tree!.unmount(); }); tree = undefined;
  await act(async () => {
    if (outcome === 'success') pending.resolve('left'); else pending.reject(new Error('Offline'));
    await operation;
  });
  expect(mockRemoveChat).not.toHaveBeenCalled();
  expect(mockRefetch).not.toHaveBeenCalled();
});

it.each([circle, dm])('requires a fresh confirmation for $title after leaving Chats', async chat => {
  const blur = await mount();
  open(chat);
  const oldConfirm = confirmAlert().props.buttons[1].onPress;
  blur();
  focusInbox();
  await act(async () => { await oldConfirm(); });
  expect(mockMutateAsync).not.toHaveBeenCalled();
  expect(confirmAlert().props.visible).toBe(false);
  open(chat);
  await act(async () => { await confirm(); });
  expect(mockMutateAsync).toHaveBeenCalledWith(chat.conversationId);
});

it('keeps an already confirmed removal when its receipt arrives after leaving Chats', async () => {
  const pending = deferred();
  mockMutateAsync.mockReturnValueOnce(pending.promise);
  const blur = await mount();
  open();
  const operation = confirm();
  blur();
  await act(async () => { pending.resolve('left'); await operation; });
  expect(mockRemoveChat).toHaveBeenCalledWith(circle.conversationId);
});


it.each([circle, dm])('Check status for $title reads once without another destructive action', async chat => {
  mockMutateAsync.mockRejectedValueOnce(new CircleLeaveUnconfirmed());
  mockCheck.mockResolvedValueOnce('not_member');
  await mount(); open(chat); await act(async()=>{await confirm();});
  expect(row(chat)).toBeDefined();
  const retry=tree!.root.findAllByType(BrandedAlert).flatMap(n=>n.props.buttons??[])
    .find(b=>b.text==='Check status').onPress;
  await act(async()=>{retry();retry();});
  expect(mockCheck.mock.calls).toEqual([[chat.conversationId]]);
  expect(mockMutateAsync).toHaveBeenCalledTimes(1);
  expect(row(chat)).toBeUndefined();expect(row(plan)).toBeDefined();
});
