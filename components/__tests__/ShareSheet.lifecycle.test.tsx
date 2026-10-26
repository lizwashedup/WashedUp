import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { Alert, Modal, Platform, Share, TouchableOpacity } from 'react-native';
import { ShareSheet } from '../ShareSheet';
const mockPush = jest.fn(), mockClose = jest.fn();
let mockFocused = true;
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => mockFocused }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('../../lib/haptics', () => ({ hapticLight: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
const props = { visible: true, planId: 'fictional-plan', planTitle: 'Local test', slug: 'local-test', onClose: mockClose };
let tree: ReactTestRenderer | null;
const action = (index: number) => tree!.root.findAllByType(TouchableOpacity)[index].props.onPress;
const modal = () => tree!.root.findByType(Modal);
beforeEach(() => {
  jest.clearAllMocks(); jest.useFakeTimers(); mockFocused = true; Platform.OS = 'ios';
  jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.dismissedAction });
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  act(() => { tree = create(<ShareSheet {...props} />); });
});
afterEach(() => { if (tree) act(() => tree!.unmount()); tree = null; jest.useRealTimers(); jest.restoreAllMocks(); });
it('waits for native dismissal before People navigation and only navigates once', () => {
  const press = action(0);
  act(() => { press(); press(); });
  expect(mockPush).not.toHaveBeenCalled();
  expect(modal().props.visible).toBe(false);
  act(() => { modal().props.onDismiss(); modal().props.onDismiss(); });
  expect(mockPush).toHaveBeenCalledTimes(1);
  expect(mockPush).toHaveBeenCalledWith('/(tabs)/friends?tab=people');
  expect(mockClose).toHaveBeenCalledTimes(1);
});
it('opens native sharing after dismissal rather than an arbitrary delay', async () => {
  act(() => { void action(2)(); });
  act(() => jest.advanceTimersByTime(1000));
  expect(Share.share).not.toHaveBeenCalled();
  await act(async () => modal().props.onDismiss());
  expect(Share.share).toHaveBeenCalledWith({ message: 'Local test\nhttps://washedup.app/plans/local-test' });
});
it('sequences the existing link-only share fallback after dismissal too', async () => {
  act(() => { void action(1)(); });
  expect(Share.share).not.toHaveBeenCalled();
  await act(async () => modal().props.onDismiss());
  expect(Share.share).toHaveBeenCalledWith({ message: 'https://washedup.app/plans/local-test' });
});
it('retires a pending action when its screen blurs', () => {
  act(() => { void action(0)(); });
  const dismiss = modal().props.onDismiss;
  mockFocused = false;
  act(() => tree!.update(<ShareSheet {...props} />));
  act(() => dismiss());
  expect(mockPush).not.toHaveBeenCalled();
});
it('does not launch a delayed share after unmount', () => {
  act(() => { void action(2)(); });
  act(() => tree!.unmount()); tree = null;
  act(() => jest.advanceTimersByTime(1000));
  expect(Share.share).not.toHaveBeenCalled();
});
it('catches native sharing failure and gives retry guidance', async () => {
  (Share.share as jest.Mock).mockRejectedValueOnce(new Error('unavailable'));
  act(() => { void action(2)(); });
  await act(async () => modal().props.onDismiss());
  expect(Alert.alert).toHaveBeenCalledWith('Couldn’t share', 'Please open Share and try again.');
});
it('does not wait for an iOS-only event on Android', () => {
  Platform.OS = 'android';
  act(() => { void action(0)(); });
  expect(mockPush).toHaveBeenCalledTimes(1);
  expect(mockPush).toHaveBeenCalledWith('/(tabs)/friends?tab=people');
});
