import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

let mockRoster: any, mockRemoved: any, mockAnswers: any, mockAlert: any;
const mockReview = jest.fn(), mockRemove = jest.fn(), mockRestore = jest.fn();
const mockPush = jest.fn();
const mockQueries = new Map<string, any>();
const mockReadMembers = jest.fn(), mockReadRemoved = jest.fn(), mockReadAnswers = jest.fn();
jest.mock('@tanstack/react-query', () => ({
  useQuery: (query: any) => { const { queryKey } = query; mockQueries.set(queryKey[0], query); return queryKey[0] === 'creator-members' ? mockRoster
    : queryKey[0] === 'creator-members-removed' ? mockRemoved
      : queryKey[0] === 'join-answer-cards' ? mockAnswers : { data: {} }; },
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }), Redirect: () => null }));
jest.mock('../../../lib/selectedCommunity', () => ({ useLedCommunity: () => ({ id: 'club', name: 'Local Club' }) }));
jest.mock('../../../lib/creatorMode', () => ({
  isLeaderAccess: () => true, canManageMembers: () => true,
  coCreatorRoleTag: () => '',
  getCommunityMembers: (...args: any[]) => mockReadMembers(...args),
  getRemovedCommunityMembers: (...args: any[]) => mockReadRemoved(...args),
  getJoinAnswerCards: (...args: any[]) => mockReadAnswers(...args),
  reviewJoinRequest: (...args: any[]) => mockReview(...args),
  removeMember: (...args: any[]) => mockRemove(...args),
  removeMemberWithReason: (...args: any[]) => mockRemove(...args),
  restoreMember: (...args: any[]) => mockRestore(...args),
}));
jest.mock('../../../constants/FeatureFlags', () => ({
  CO_CREATOR_INVITES_ENABLED: true, MEMBER_INVITES_ENABLED: true, MEMBER_REMOVAL_REASON_ENABLED: true,
}));
jest.mock('../../../lib/haptics', () => ({ hapticLight: jest.fn(), hapticSuccess: jest.fn() }));
jest.mock('../../BrandedAlert', () => ({ BrandedAlert: (props: any) => { mockAlert = props; return null; } }));
jest.mock('../MemberRemovalReasonModal', () => ({ MemberRemovalReasonModal: () => null }));
import Screen from '../../../app/(creator)/members';

let tree: ReactTestRenderer;
const text = (node: any): string => typeof node === 'string' ? node
  : Array.isArray(node) ? node.map(text).join('') : (node?.children ?? []).map(text).join('');
const button = (label: string) => tree.root.findAll(n => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function')[0];
const state = (data: any) => ({ data, isLoading: false, isPending: false, isError: false, isFetching: false, isRefetching: false, refetch: jest.fn(async () => ({})) });
const member = (status = 'active') => ({ id: 'one', user_id: 'person', name: 'Jamie', role: 'member', status, created_at: '2026-10-01T10:00:00Z', joined_at: '2026-10-02T10:00:00Z' });
async function render() { await act(async () => { tree = create(<Screen />); }); }
beforeEach(() => { jest.clearAllMocks(); mockQueries.clear(); mockRoster = state([]); mockRemoved = state([]); mockAnswers = state(new Map()); mockAlert = null; });
afterEach(() => { act(() => tree?.unmount()); jest.useRealTimers(); });

it('shows a failed roster read without claiming an empty community and retries that read', async () => {
  mockRoster = { ...state(undefined), isError: true }; await render();
  expect(text(tree.toJSON())).toContain('Members didn’t load');
  expect(text(tree.toJSON())).not.toContain('first faces');
  expect(text(tree.toJSON())).not.toContain('in the community (0)');
  await act(async () => button('Retry members').props.onPress());
  expect(mockRoster.refetch).toHaveBeenCalledTimes(1);
  expect(mockRemoved.refetch).not.toHaveBeenCalled();
  expect(button('Invite members')).toBeDefined();
});

it('keeps cached members visible after refresh failure but requires recovery before removal', async () => {
  mockRoster = { ...state([member()]), isError: true }; await render();
  expect(text(tree.toJSON())).toContain('Jamie');
  expect(text(tree.toJSON())).toContain('Showing previously loaded members');
  expect(button('Remove Jamie').props.disabled).toBe(true);
  expect(button('Export the member list').props.disabled).toBe(true);
  mockRoster.isError = false; await act(async () => tree.update(<Screen />));
  expect(button('Remove Jamie').props.disabled).toBe(false);
});

it('keeps unavailable request answers distinct from an unanswered request', async () => {
  mockRoster.data = [member('pending')]; mockAnswers = { ...state(undefined), isError: true }; await render();
  expect(text(tree.toJSON())).toContain('Request answers didn’t load');
  expect(button('Approve Jamie').props.disabled).toBe(true);
  await act(async () => button('Retry request answers').props.onPress());
  expect(mockAnswers.refetch).toHaveBeenCalledTimes(1);
  expect(mockRoster.refetch).not.toHaveBeenCalled();
});

it('does not hide a removed-member read error behind an empty list', async () => {
  mockRemoved = { ...state(undefined), isError: true }; await render();
  expect(text(tree.toJSON())).toContain('Removed members didn’t load');
  await act(async () => button('Retry removed members').props.onPress());
  expect(mockRemoved.refetch).toHaveBeenCalledTimes(1);
});

it('refreshes roster, removed members and request answers together', async () => {
  await render(); const refresh = tree.root.findAll(n => n.props.refreshControl)[0].props.refreshControl;
  await act(async () => refresh.props.onRefresh());
  expect(mockRoster.refetch).toHaveBeenCalledTimes(1);
  expect(mockRemoved.refetch).toHaveBeenCalledTimes(1);
  expect(mockAnswers.refetch).toHaveBeenCalledTimes(1);
});

it('does not approve from an already-open confirmation after a roster refresh fails', async () => {
  mockRoster.data = [member('pending')]; await render();
  act(() => button('Approve Jamie').props.onPress());
  const confirm = mockAlert.buttons.find((item: any) => item.text === 'Approve').onPress;
  mockRoster.isError = true; await act(async () => tree.update(<Screen />));
  await act(async () => confirm());
  expect(mockReview).not.toHaveBeenCalled();
});

it.each(['creator-members', 'creator-members-removed', 'join-answer-cards'])('bounds a stalled %s read so retry can become available', async key => {
  jest.useFakeTimers(); await render();
  const read = key === 'creator-members' ? mockReadMembers : key === 'creator-members-removed' ? mockReadRemoved : mockReadAnswers;
  read.mockImplementationOnce(() => new Promise(() => {}));
  const pending = mockQueries.get(key).queryFn();
  const outcome = expect(pending).rejects.toMatchObject({ name: 'RequestDeadlineError' });
  await act(async () => jest.advanceTimersByTime(12_000));
  await outcome;
  expect(read).toHaveBeenCalledWith('club');
});

it('does not dispatch the same confirmed member decision twice', async () => {
  mockRoster.data = [member('pending')]; let finish!: () => void;
  mockReview.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  await render(); act(() => button('Approve Jamie').props.onPress());
  const confirm = mockAlert.buttons.find((item: any) => item.text === 'Approve').onPress;
  let first: Promise<void>;
  await act(async () => { first = confirm(); await confirm(); });
  expect(mockReview).toHaveBeenCalledTimes(1);
  await act(async () => { finish(); await first; });
});
