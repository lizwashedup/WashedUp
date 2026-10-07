import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const mockLoad = jest.fn(), mockRead = jest.fn(), mockPush = jest.fn(), mockClose = jest.fn(), mockRefresh = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: (...args: any[]) => mockPush(...args) }) }));
jest.mock('../../../lib/communityNoticeDestination', () => ({ loadCommunityNoticeRoute: (...args: any[]) => mockLoad(...args), markCommunityNoticeRead: (...args: any[]) => mockRead(...args) }));
jest.mock('../../../hooks/useAfterglowFonts', () => ({ useAfterglowFonts: () => ({ fonts: { regular: 'System', semibold: 'System' } }) }));
jest.mock('../../creator/CreatorActionFill', () => ({ CreatorActionFill: () => null }));
import { CommunityNoticeInboxRow } from '../CommunityNoticeInboxRow';
let tree: ReactTestRenderer;
const notice = { id: 'notice', title: 'Jamie reacted ❤️', body: 'Anyone coming straight from work?' };
const render = (extra: any = {}) => <CommunityNoticeInboxRow notice={notice} userId="author" visible enabled onClose={mockClose} onRead={mockRefresh} {...extra} />;
const button = (label = 'Open chat') => tree.root.findAll(node => node.props.accessibilityRole === 'button' && node.props.accessibilityLabel === label)[0];
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { resolve, promise }; }
beforeEach(() => { jest.clearAllMocks(); mockLoad.mockResolvedValue('/community-thread/community?reactionMessageId=message&reactionMessageSource=broadcast'); mockRead.mockResolvedValue(undefined); });
afterEach(() => { act(() => tree?.unmount()); });
it('opens the exact confirmed destination once for a double press', async () => {
  await act(async () => { tree = create(render()); }); const press = button().props.onPress; await act(async () => { press(); press(); });
  expect(mockLoad).toHaveBeenCalledTimes(1); expect(mockRead).toHaveBeenCalledTimes(1); expect(mockPush).toHaveBeenCalledWith('/community-thread/community?reactionMessageId=message&reactionMessageSource=broadcast'); expect(mockClose).toHaveBeenCalledTimes(1);
});
it.each(['failed', 'missing'])('keeps a %s destination visible and retryable without marking read', async state => {
  if (state === 'failed') mockLoad.mockRejectedValueOnce(Error('Could not load. Try again.')); else mockLoad.mockResolvedValueOnce(null);
  await act(async () => { tree = create(render()); }); await act(async () => button().props.onPress());
  expect(mockPush).not.toHaveBeenCalled(); expect(mockRead).not.toHaveBeenCalled(); expect(tree.root.findAll(node => node.props.accessibilityRole === 'alert').length).toBeGreaterThan(0);
  await act(async () => button().props.onPress()); expect(mockPush).toHaveBeenCalledTimes(1);
});
it('opens the confirmed target even if optional read bookkeeping fails', async () => {
  mockRead.mockRejectedValueOnce(Error('offline')); await act(async () => { tree = create(render()); }); await act(async () => button().props.onPress()); expect(mockPush).toHaveBeenCalledTimes(1);
});
it('does not navigate when receipt authorization detects account replacement before props update', async () => {
  mockRead.mockRejectedValueOnce(Object.assign(Error('Sign in to open this conversation.'), { name: 'CommunityNoticeIdentityError' }));
  await act(async () => { tree = create(render()); }); await act(async () => button().props.onPress());
  expect(mockPush).not.toHaveBeenCalled(); expect(mockClose).not.toHaveBeenCalled(); expect(mockRefresh).not.toHaveBeenCalled();
  expect(tree.root.findAll(node => node.props.accessibilityRole === 'alert').length).toBeGreaterThan(0);
});
it.each([{ visible: false }, { userId: 'other' }, { notice: { ...notice, id: 'next' } }, { enabled: false }])('ignores an old target after ownership changes %p', async extra => {
  const pending = deferred<any>(); mockLoad.mockReturnValueOnce(pending.promise); await act(async () => { tree = create(render()); }); await act(async () => button().props.onPress());
  await act(async () => tree.update(render(extra))); await act(async () => pending.resolve('/community-thread/old')); expect(mockRead).not.toHaveBeenCalled(); expect(mockPush).not.toHaveBeenCalled();
});
it('ignores a completed read after the visit closes', async () => {
  const pending = deferred<any>(); mockRead.mockReturnValueOnce(pending.promise); await act(async () => { tree = create(render()); }); await act(async () => button().props.onPress()); await act(async () => tree.update(render({ visible: false }))); await act(async () => pending.resolve(undefined)); expect(mockPush).not.toHaveBeenCalled(); expect(mockRefresh).not.toHaveBeenCalled();
});
it('dismisses once with confirmed read receipt and never navigates', async () => {
  await act(async () => { tree = create(render()); }); const press = button('Dismiss notification').props.onPress; await act(async () => { press(); press(); }); expect(mockRead).toHaveBeenCalledTimes(1); expect(mockRefresh).toHaveBeenCalledTimes(1); expect(mockPush).not.toHaveBeenCalled(); expect(mockLoad).not.toHaveBeenCalled();
});
it('retains a failed dismissal for retry', async () => {
  mockRead.mockRejectedValueOnce(Error('Could not dismiss. Try again.')); await act(async () => { tree = create(render()); }); await act(async () => button('Dismiss notification').props.onPress()); expect(mockRefresh).not.toHaveBeenCalled(); await act(async () => button('Dismiss notification').props.onPress()); expect(mockRefresh).toHaveBeenCalledTimes(1);
});
it('uses the existing Chats fallback when community entry is disabled', async () => {
  await act(async () => { tree = create(render({ enabled: false })); }); await act(async () => button().props.onPress()); expect(mockPush).toHaveBeenCalledWith('/(tabs)/chats'); expect(mockLoad).not.toHaveBeenCalled(); expect(mockRead).not.toHaveBeenCalled();
});
it('never revives a previous visible visit when reopened', async () => {
  const pending = deferred<any>(); mockLoad.mockReturnValueOnce(pending.promise); await act(async () => { tree = create(render()); }); await act(async () => button().props.onPress()); await act(async () => tree.update(render({ visible: false }))); await act(async () => tree.update(render())); await act(async () => pending.resolve('/community-thread/old')); expect(mockPush).not.toHaveBeenCalled(); await act(async () => button().props.onPress()); expect(mockPush).toHaveBeenCalledTimes(1);
});
