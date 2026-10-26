import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { Modal, Platform, Pressable, TouchableOpacity } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ProfileButton from '../ProfileButton';
const mockPush = jest.fn();
let mockFocused = true;
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => mockFocused }));
jest.mock('@tanstack/react-query', () => ({ useQuery: ({ queryKey }: any) => ({
  data: queryKey[0] === 'profile-photo' ? 'https://example.test/photo.jpg' : queryKey[0] === 'inbox-count' ? 0 : 'viewer', refetch: jest.fn(),
}) }));
jest.mock('expo-router', () => ({ router: { push: (...args: any[]) => mockPush(...args) } }));
jest.mock('../../lib/supabase', () => ({ supabase: {} }));
jest.mock('../InboxModal', () => () => null);
jest.mock('../../hooks/useAfterglowFonts', () => ({ useAfterglowFonts: () => ({ fonts: jest.requireActual('../../constants/Typography').AfterglowFonts }) }));
let tree: ReactTestRenderer | null;
const button = (label: string) => tree!.root.findAllByType(TouchableOpacity).find(n => n.props.accessibilityLabel === label)!;
const confirm = () => tree!.root.findAllByType(TouchableOpacity).find(n => n.props.activeOpacity === 0.8)!;
const modal = () => tree!.root.findByType(Modal);
beforeEach(() => {
  jest.clearAllMocks(); mockFocused = true; Platform.OS = 'ios';
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
  act(() => { tree = create(<ProfileButton />); });
});
afterEach(() => { if (tree) act(() => tree!.unmount()); tree = null; });
it('waits for native dismissal before opening edit and completes once', async () => {
  await act(async () => button('Profile').props.onPress());
  const press = confirm().props.onPress;
  act(() => { press(); press(); });
  expect(mockPush).not.toHaveBeenCalled();
  act(() => { modal().props.onDismiss(); modal().props.onDismiss(); });
  expect(mockPush).toHaveBeenCalledTimes(1);
  expect(mockPush).toHaveBeenCalledWith('/(tabs)/profile?openEdit=true');
});
it('retires a slow storage read when the header unmounts', async () => {
  let resolve!: (value: string) => void;
  (AsyncStorage.getItem as jest.Mock).mockImplementation(() => new Promise(r => { resolve = r; }));
  act(() => { void button('Profile').props.onPress(); });
  act(() => tree!.unmount()); tree = null;
  await act(async () => resolve('true'));
  expect(mockPush).not.toHaveBeenCalled();
});
it('coalesces rapid Profile taps while checking storage', async () => {
  let resolve!: (value: string) => void;
  (AsyncStorage.getItem as jest.Mock).mockImplementation(() => new Promise(r => { resolve = r; }));
  const press = button('Profile').props.onPress;
  act(() => { void press(); void press(); });
  expect(AsyncStorage.getItem).toHaveBeenCalledTimes(1);
  await act(async () => resolve('true'));
  expect(mockPush).toHaveBeenCalledTimes(1);
});
it('retires delayed navigation after a different tab is selected', async () => {
  await act(async () => button('Profile').props.onPress());
  act(() => confirm().props.onPress());
  const onDismiss = modal().props.onDismiss;
  mockFocused = false;
  act(() => tree!.update(<ProfileButton />));
  act(() => onDismiss());
  expect(mockPush).not.toHaveBeenCalled();
});
it('exposes the prompt action separately from the backdrop', async () => {
  await act(async () => button('Profile').props.onPress());
  expect(confirm().props.accessibilityRole).toBe('button');
  expect(confirm().props.accessibilityLabel).toBe("Let's do it");
  for (const p of modal().findAllByType(Pressable)) expect(p.props.accessible).toBe(false);
});
it('opens edit on Android without waiting for an iOS dismissal event', async () => {
  Platform.OS = 'android';
  await act(async () => button('Profile').props.onPress());
  act(() => confirm().props.onPress());
  expect(mockPush).toHaveBeenCalledTimes(1);
});
