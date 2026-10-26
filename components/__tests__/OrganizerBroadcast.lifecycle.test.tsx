import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { TextInput, TouchableOpacity } from 'react-native';
import Screen from '../../app/(creator)/organizer-broadcast';

const mockSend = jest.fn(), mockTest = jest.fn(), mockBack = jest.fn();
let mockCurrent = true;
let mockEpoch = 1;
const mockScope = { userId: 'local-user', isCurrent: () => mockCurrent };
jest.mock('../../hooks/useCreatorPageScope', () => ({ useCreatorPageScope: () => ({
  scope: mockScope, account: { viewerId: 'local-user', epoch: mockEpoch, isLoading: false, error: null },
}) }));
jest.mock('../../constants/FeatureFlags', () => ({ MESSAGE_TEST_SEND_ENABLED: true }));
jest.mock('expo-router', () => ({ useRouter: () => ({ back: mockBack }) }));
jest.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: 3 }) }));
jest.mock('../../lib/organizerFollows', () => ({ getFollowerCount: jest.fn() }));
jest.mock('../../lib/followerBroadcasts', () => ({
  sendFollowerBroadcast: (...args: any[]) => mockSend(...args),
  sendFollowerBroadcastTestToSelf: (...args: any[]) => mockTest(...args),
}));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: require('react-native').View }));
let tree: ReactTestRenderer | null = null;
const button = (label: string) => tree!.root.findAllByType(TouchableOpacity).find(n => n.props.accessibilityLabel === label)!;
const send = () => button('Send update');
beforeEach(() => {
  jest.useFakeTimers(); jest.resetAllMocks(); mockCurrent = true; mockEpoch = 1;
  act(() => { tree = create(<Screen />); });
  act(() => tree!.root.findByType(TextInput).props.onChangeText('Fictional audit only'));
});
afterEach(() => {
  if (tree) act(() => tree!.unmount());
  tree = null; jest.clearAllTimers(); jest.useRealTimers();
});
it('dispatches only once when pressed twice before rerender', () => {
  mockSend.mockImplementation(() => new Promise(() => {}));
  const press = send().props.onPress;
  act(() => { void press(); void press(); });
  expect(mockSend).toHaveBeenCalledTimes(1);
});
it('locks both actions after a confirmed send, including a retained callback', async () => {
  mockSend.mockResolvedValue(undefined);
  const press = send().props.onPress;
  await act(async () => press());
  expect(send().props.disabled).toBe(true);
  expect(button('send a test to yourself').props.disabled).toBe(true);
  await act(async () => press());
  expect(mockSend).toHaveBeenCalledTimes(1);
});
it('never overlaps test and follower dispatches', () => {
  mockTest.mockImplementation(() => new Promise(() => {}));
  const press = send().props.onPress;
  act(() => { void button('send a test to yourself').props.onPress(); void press(); });
  expect(mockTest).toHaveBeenCalledTimes(1);
  expect(mockSend).not.toHaveBeenCalled();
  expect(tree!.root.findByType(TextInput).props.editable).toBe(false);
});
it('does not navigate after the sending screen unmounts', async () => {
  mockSend.mockResolvedValue(undefined);
  await act(async () => send().props.onPress());
  act(() => tree!.unmount()); tree = null;
  act(() => jest.advanceTimersByTime(1000));
  expect(mockBack).not.toHaveBeenCalled();
});
it('does not navigate after the visit loses focus', async () => {
  mockSend.mockResolvedValue(undefined);
  await act(async () => send().props.onPress());
  mockCurrent = false;
  act(() => jest.advanceTimersByTime(1000));
  expect(mockBack).not.toHaveBeenCalled();
});
it('Back cancels a successful send’s automatic exit immediately', async () => {
  mockSend.mockResolvedValue(undefined);
  await act(async () => send().props.onPress());
  act(() => button('Back').props.onPress());
  act(() => jest.advanceTimersByTime(1000));
  expect(mockBack).toHaveBeenCalledTimes(1);
});
it('does not schedule navigation if a send resolves after Back', async () => {
  let finish!: () => void;
  mockSend.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  act(() => { void send().props.onPress(); });
  act(() => button('Back').props.onPress());
  await act(async () => finish());
  act(() => jest.advanceTimersByTime(1000));
  expect(mockBack).toHaveBeenCalledTimes(1);
  expect(mockSend.mock.calls[0][2].isCurrent()).toBe(false);
});
it('retires drafts and delayed exits when the account changes', async () => {
  mockSend.mockResolvedValue(undefined);
  await act(async () => send().props.onPress());
  mockEpoch++;
  act(() => tree!.update(<Screen />));
  expect(tree!.root.findByType(TextInput).props.value).toBe('');
  act(() => jest.advanceTimersByTime(1000));
  expect(mockBack).not.toHaveBeenCalled();
});
it('keeps a failed draft and permits an explicit retry', async () => {
  mockSend.mockRejectedValueOnce(new Error('Rejected')).mockResolvedValueOnce(undefined);
  await act(async () => send().props.onPress());
  expect(tree!.root.findByType(TextInput).props.value).toBe('Fictional audit only');
  expect(send().props.disabled).toBe(false);
  await act(async () => send().props.onPress());
  act(() => jest.advanceTimersByTime(1000));
  expect(mockBack).toHaveBeenCalledTimes(1);
});
