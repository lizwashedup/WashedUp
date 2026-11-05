import React from 'react';
import { Dimensions, ScrollView, StyleSheet, Text, View } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const mockNavigate = jest.fn();
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, router: { navigate: (...args: unknown[]) => mockNavigate(...args) } }));
jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));
jest.mock('../../../hooks/useObservedUser', () => ({ useObservedUser: () => ({ viewerId: 'creator', error: null, isLoading: false }) }));
jest.mock('../../../hooks/useAfterglowFonts', () => ({ useAfterglowFonts: () => ({ fonts: require('../../../constants/Typography').AfterglowFallbackFonts }) }));
jest.mock('../../ProfileButton', () => () => require('react').createElement(require('react-native').Pressable, { accessibilityLabel: 'Open profile', onPress: jest.fn() }));
jest.mock('../pages/CreatorSpaceEntry', () => ({ CreatorSpaceEntry: () => require('react').createElement(require('react-native').View, { testID: 'creator-entries' }) }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: require('react-native').View }));
import ManagementDirectoryScreen from '../ManagementDirectoryScreen';

it('moves the large title into the existing scroller while preserving content, Back and Profile across text-size changes', () => {
  const previous = Dimensions.get('window'); let tree: ReactTestRenderer | undefined;
  try {
    act(() => Dimensions.set({ window: { ...previous, width: 320, height: 568, fontScale: 1 } }));
    act(() => { tree = create(<ManagementDirectoryScreen />); });
    const scroll = tree!.root.findByType(ScrollView);
    const entries = tree!.root.findAllByType(View).find(node => node.props.testID === 'creator-entries');
    const title = () => tree!.root.findAllByType(Text).find(node => node.props.children === 'You manage')!;
    expect(scroll.findAllByType(Text)).not.toContain(title());
    act(() => Dimensions.set({ window: { ...previous, width: 320, height: 568, fontScale: 3.2 } }));
    expect(tree!.root.findByType(ScrollView)).toBe(scroll);
    expect(tree!.root.findAllByType(View).find(node => node.props.testID === 'creator-entries')).toBe(entries);
    expect(scroll.findAllByType(Text)).toContain(title());
    expect(title().props.numberOfLines).toBeUndefined(); expect(title().props.allowFontScaling).not.toBe(false);
    expect(StyleSheet.flatten(scroll.props.style).flex).toBe(1);
    expect(tree!.root.findAll(node => node.props.accessibilityLabel === 'Open profile')).not.toHaveLength(0);
    const back = tree!.root.findAll(node => node.props.accessibilityLabel === 'Back' && node.props.onPress)[0];
    act(() => back.props.onPress()); expect(mockNavigate).toHaveBeenCalledWith('/(tabs)/friends');
    act(() => Dimensions.set({ window: { ...previous, width: 320, height: 568, fontScale: 1 } }));
    expect(tree!.root.findByType(ScrollView)).toBe(scroll);
    expect(tree!.root.findAllByType(View).find(node => node.props.testID === 'creator-entries')).toBe(entries);
    expect(scroll.findAllByType(Text)).not.toContain(title());
  } finally { act(() => { tree?.unmount(); Dimensions.set({ window: previous }); }); }
});
