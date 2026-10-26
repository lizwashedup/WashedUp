import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { Modal, Platform, Text, TouchableOpacity } from 'react-native';
import InboxModal from '../InboxModal';
const mockPush = jest.fn(), mockClose = jest.fn(), mockWrite = jest.fn();
let mockCurrent = true;
let mockInvites: any[] = [];
const mockClient = { invalidateQueries: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('../../hooks/useInboxNotificationScope', () => ({ useInboxNotificationScope: () => ({ userId: 'fictional-viewer', isCurrent: () => mockCurrent }) }));
jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => mockClient, useQuery: ({queryKey}: any) => ({
  data: queryKey[0] === 'app-notifications' ? [{id:'fictional-notice',type:'member_joined',title:'Fictional reminder',event_id:'fictional-plan',created_at:new Date().toISOString()}] : queryKey[0] === 'pending-invites' ? mockInvites : [], refetch: jest.fn(), isLoading: false,
}) }));
jest.mock('../../lib/supabase', () => ({ supabase: { from: () => ({update: () => { const chain: any = {eq: () => chain, then: (yes: any, no: any) => mockWrite().then(yes, no)}; return chain; }}) } }));
jest.mock('expo-notifications', () => ({ setBadgeCountAsync: jest.fn(async () => {}) }));
jest.mock('../../lib/haptics', () => ({ hapticLight: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({bottom:0,top:0,left:0,right:0}) }));
jest.mock('../BrandedAlert', () => ({ BrandedAlert: () => null }));
jest.mock('../legal/ParticipationNotice', () => ({ ParticipationNotice: () => null }));
let tree: ReactTestRenderer;
const row = () => tree.root.findAllByType(TouchableOpacity).find(n => n.findAllByType(Text).some(t => t.props.children === 'Fictional reminder'))!;
beforeEach(() => { jest.clearAllMocks(); mockCurrent = true; mockInvites = []; Platform.OS = 'ios'; mockWrite.mockResolvedValue({error:null}); act(() => { tree = create(<InboxModal visible userId="fictional-viewer" onClose={mockClose} />); }); });
afterEach(() => act(() => tree.unmount()));
it('does not open a chat before its native inbox window dismisses', async () => {
  await act(async () => row().props.onPress());
  expect(mockPush).not.toHaveBeenCalled();
  act(() => tree.root.findByType(Modal).props.onDismiss());
  expect(mockPush).toHaveBeenCalledWith('/(tabs)/chats/fictional-plan');
});
it('does not dispatch the same row action twice in one frame', async () => {
  const press = row().props.onPress;
  await act(async () => { await Promise.all([press(), press()]); });
  expect(mockWrite).toHaveBeenCalledTimes(1);
});

const renderInbox = (visible = true, userId = 'fictional-viewer') => <InboxModal visible={visible} userId={userId} onClose={mockClose} />;
it('closes the native window first and completes a repeated dismissal only once', async () => {
  await act(async () => row().props.onPress());
  expect(tree.root.findByType(Modal).props.visible).toBe(false);
  expect(mockClose).not.toHaveBeenCalled();
  const dismiss = tree.root.findByType(Modal).props.onDismiss;
  act(() => { dismiss(); dismiss(); });
  expect(mockClose).toHaveBeenCalledTimes(1);
  expect(mockPush).toHaveBeenCalledTimes(1);
});
it.each(['hidden', 'reopened', 'account', 'unmounted'])('retires queued navigation after the inbox is %s', async change => {
  await act(async () => row().props.onPress());
  const dismiss = tree.root.findByType(Modal).props.onDismiss;
  if (change === 'unmounted') act(() => tree.unmount());
  else if (change === 'account') act(() => tree.update(renderInbox(true, 'other')));
  else {
    act(() => tree.update(renderInbox(false)));
    if (change === 'reopened') act(() => tree.update(renderInbox()));
  }
  act(() => dismiss());
  expect(mockPush).not.toHaveBeenCalled();
  expect(mockClose).not.toHaveBeenCalled();
});
it('does not navigate after account ownership retires before dismissal', async () => {
  await act(async () => row().props.onPress());
  mockCurrent = false;
  act(() => tree.root.findByType(Modal).props.onDismiss());
  expect(mockPush).not.toHaveBeenCalled();
});
it('allows Android to open without waiting for the iOS-only completion', async () => {
  Platform.OS = 'android';
  await act(async () => row().props.onPress());
  expect(mockPush).toHaveBeenCalledWith('/(tabs)/chats/fictional-plan');
  expect(mockClose).toHaveBeenCalledTimes(1);
});
it('ignores a pending row result when the user closes the inbox', async () => {
  let resolve!: (value: any) => void;
  mockWrite.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  let pending!: Promise<void>;
  act(() => { pending = row().props.onPress(); });
  await act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });
  act(() => tree.root.findByType(Modal).props.onRequestClose());
  await act(async () => { resolve({error: null}); await pending; });
  act(() => tree.root.findByType(Modal).props.onDismiss());
  expect(mockPush).not.toHaveBeenCalled();
  expect(mockClose).toHaveBeenCalledTimes(1);
});
it('releases a rejected action for retry without leaving the inbox', async () => {
  mockWrite.mockRejectedValueOnce(Error('offline'));
  await act(async () => row().props.onPress());
  expect(tree.root.findByType(Modal).props.visible).toBe(true);
  expect(mockPush).not.toHaveBeenCalled();
  await act(async () => row().props.onPress());
  act(() => tree.root.findByType(Modal).props.onDismiss());
  expect(mockWrite).toHaveBeenCalledTimes(2);
  expect(mockPush).toHaveBeenCalledTimes(1);
});

it('offers a named close control that waits for native dismissal without navigation', () => {
  const close = tree.root.findAllByType(TouchableOpacity).find(n => n.props.accessibilityLabel === 'Close inbox')!;
  act(() => close.props.onPress());
  expect(tree.root.findByType(Modal).props.visible).toBe(false);
  expect(mockClose).not.toHaveBeenCalled();
  act(() => tree.root.findByType(Modal).props.onDismiss());
  expect(mockClose).toHaveBeenCalledTimes(1);
  expect(mockPush).not.toHaveBeenCalled();
});

it('opens an invitation without acknowledging acceptance before confirmed membership', async () => {
  mockInvites = [{id:'fictional-invite',event_id:'fictional-plan',recipient_id:'fictional-viewer',status:'pending',events:{title:'Fictional invited plan'}}];
  act(() => tree.update(renderInbox()));
  const open = tree.root.findAllByType(TouchableOpacity).find(n => n.findAllByType(Text).some(t => t.props.children === "Let's Go →"))!;
  await act(async () => { await open.props.onPress(); await open.props.onPress(); });
  expect(mockWrite).not.toHaveBeenCalled();
  expect(mockPush).not.toHaveBeenCalled();
  act(() => tree.root.findByType(Modal).props.onDismiss());
  expect(mockPush).toHaveBeenCalledTimes(1);
  expect(mockPush).toHaveBeenCalledWith('/plan/fictional-plan');
});
